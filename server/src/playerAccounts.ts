import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getServerDataFilePath, migrateServerDataFile, PersistenceError } from "./config.ts";

/** CPU 友好的同步等待：挂起线程让出 CPU，避免忙等占满一个核心。 */
function sleepSync(ms: number): void {
    if (typeof Atomics !== "undefined" && typeof SharedArrayBuffer !== "undefined") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } else {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            // fallback
        }
    }
}

/**
 * Player account store: username + password (scrypt hash + per-user salt) with
 * opaque session tokens. Persisted to survivio-player-accounts.json next to
 * the server config. The file never stores plain-text passwords and is only
 * ever written by the API process.
 */

export class PlayerAccountError extends Error {}

interface StoredPlayer {
    salt: string;
    hash: string;
    displayName: string;
    createdAt: number;
}

interface PlayerSession {
    username: string;
    expiresAt: number;
}

interface AccountsFile {
    users: Record<string, StoredPlayer>;
    sessions: Record<string, PlayerSession>;
}

export interface PlayerProfile {
    username: string;
    displayName: string;
}

export const PLAYER_ACCOUNTS_FILE = "survivio-player-accounts.json";
export const PLAYER_ACCOUNT_SESSION_COOKIE = "surviv_player_session";

const USERNAME_MIN = 2;
const USERNAME_MAX = 16;
// 默认初始密码允许 4 位（1234），玩家登录后可自行修改。
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 64;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const SESSION_TOKEN_BYTES = 24;
const SESSION_DAYS = 30;
export const PLAYER_ACCOUNT_SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

function validateUsername(value: unknown): string {
    if (typeof value !== "string") throw new PlayerAccountError("用户名无效");
    const name = normalizeUsername(value);
    if (name.length < USERNAME_MIN) {
        throw new PlayerAccountError(`用户名至少需要 ${USERNAME_MIN} 个字符`);
    }
    if (name.length > USERNAME_MAX) {
        throw new PlayerAccountError(`用户名不能超过 ${USERNAME_MAX} 个字符`);
    }
    if (!/^[a-z0-9_\u4e00-\u9fa5 ]+$/.test(name)) {
        throw new PlayerAccountError("用户名只能包含字母、数字、下划线、空格或中文");
    }
    return name;
}

function validatePassword(value: unknown): string {
    if (typeof value !== "string") throw new PlayerAccountError("密码无效");
    if (value.length < PASSWORD_MIN) {
        throw new PlayerAccountError(`密码至少需要 ${PASSWORD_MIN} 个字符`);
    }
    if (value.length > PASSWORD_MAX) {
        throw new PlayerAccountError(`密码不能超过 ${PASSWORD_MAX} 个字符`);
    }
    return value;
}

function deriveHash(password: string, salt: string): string {
    return scryptSync(password, Buffer.from(salt, "base64"), HASH_BYTES, {
        N: 16384,
        r: 8,
        p: 1,
    }).toString("base64");
}

function verifyHash(password: string, salt: string, expectedBase64: string): boolean {
    const expected = Buffer.from(expectedBase64, "base64");
    const actual = scryptSync(password, Buffer.from(salt, "base64"), HASH_BYTES, {
        N: 16384,
        r: 8,
        p: 1,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class PlayerAccounts {
    private readonly filePath: string;
    private readonly lockPath: string;
    private data: AccountsFile;
    private persistFailed = false;
    /** 账号文件损坏且无有效备份时进入只读维护，拒绝写操作。 */
    private corrupt = false;
    /** 进程内锁标志：嵌套调用不重复加锁/重载。 */
    private locked = false;

    constructor(fileName = PLAYER_ACCOUNTS_FILE) {
        // 玩家账号数据放在独立数据目录（server-data/），与代码分离；
        // 旧位置文件自动迁移，避免全量更新丢失账号。
        migrateServerDataFile(fileName);
        this.filePath = getServerDataFilePath(fileName);
        this.lockPath = `${this.filePath}.lock`;
        this.data = this.load();
        setInterval(() => {
            try {
                this.pruneSessions();
            } catch (error) {
                // 锁竞争/持久化失败不应让定时清理崩溃整个进程。
                console.error("[player-accounts] session prune failed:", error);
            }
        }, 10 * 60 * 1000).unref?.();
    }

    private acquireLock(): void {
        for (let attempt = 0; attempt < 200; attempt++) {
            try {
                fs.mkdirSync(this.lockPath);
                fs.writeFileSync(
                    path.join(this.lockPath, "owner"),
                    `${process.pid} ${Date.now()}`,
                    "utf8",
                );
                return;
            } catch {
                try {
                    const st = fs.statSync(this.lockPath);
                    const stale = Date.now() - st.mtimeMs > 5000;
                    let ownerAlive = false;
                    if (stale) {
                        try {
                            const ownerRaw = fs.readFileSync(
                                path.join(this.lockPath, "owner"),
                                "utf8",
                            );
                            const pid = Number(ownerRaw.split(/\s+/)[0]);
                            if (Number.isInteger(pid) && pid > 0) {
                                process.kill(pid, 0);
                                ownerAlive = true;
                            }
                        } catch {
                            // owner 文件缺失或 PID 不存在
                        }
                    }
                    if (stale && !ownerAlive) {
                        fs.rmSync(this.lockPath, { recursive: true, force: true });
                        continue;
                    }
                } catch {
                    // 锁目录已被删除，继续尝试
                }
                // CPU 友好等待后重试（避免忙等阻塞事件循环）。
                sleepSync(10);
            }
        }
        throw new Error(`[player-accounts] could not acquire lock: ${this.lockPath}`);
    }

    private releaseLock(): void {
        try {
            fs.rmSync(this.lockPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }

    /** 独占执行：加锁 → 可选从磁盘重载最新 → fn → 可选原子持久化 → 解锁。 */
    private withLockSync<T>(
        fn: () => T,
        opts: { reload?: boolean; persist?: boolean } = { reload: true, persist: true },
    ): T {
        const nested = this.locked;
        if (!nested) {
            this.acquireLock();
            this.locked = true;
        }
        try {
            if (opts.reload && !nested) {
                this.data = this.load();
            }
            const needRollback = opts.persist && !nested;
            const beforeSnapshot = needRollback
                ? JSON.parse(JSON.stringify(this.data))
                : null;
            const result = fn();
            if (needRollback) {
                try {
                    this.persistNow();
                } catch (error) {
                    // 持久化失败：回滚内存到操作前状态，杜绝“内存成功、磁盘失败”。
                    this.data = beforeSnapshot;
                    throw error;
                }
            }
            return result;
        } finally {
            if (!nested) {
                this.locked = false;
                this.releaseLock();
            }
        }
    }

    /** 只读查询：锁内重载最新数据。 */
    private readLatest<T>(fn: () => T): T {
        return this.withLockSync(fn, { reload: true, persist: false });
    }

    /** 写操作：锁内重载 + 原子持久化。 */
    private writeExclusive<T>(fn: () => T): T {
        if (this.corrupt) {
            throw new PersistenceError(
                `[player-accounts] 账号文件处于只读维护状态（数据文件损坏），写操作已拒绝：${this.filePath}`,
            );
        }
        return this.withLockSync(fn, { reload: true, persist: true });
    }

    register(username: unknown, password: unknown): PlayerProfile {
        return this.writeExclusive(() => {
            const name = validateUsername(username);
            const pass = validatePassword(password);
            if (this.data.users[name]) {
                throw new PlayerAccountError("该用户名已被注册");
            }
            const salt = randomBytes(SALT_BYTES).toString("base64");
            this.data.users[name] = {
                salt,
                hash: deriveHash(pass, salt),
                displayName: typeof username === "string" ? username.trim() : name,
                createdAt: Date.now(),
            };
            return { username: name, displayName: this.data.users[name].displayName };
        });
    }

    login(username: unknown, password: unknown): { token: string; profile: PlayerProfile } {
        return this.writeExclusive(() => {
            const name = typeof username === "string" ? normalizeUsername(username) : "";
            const pass = typeof password === "string" ? password : "";
            const user = this.data.users[name];
            if (!user || !verifyHash(pass, user.salt, user.hash)) {
                throw new PlayerAccountError("用户名或密码错误");
            }
            const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
            this.data.sessions[token] = {
                username: name,
                expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
            };
            return { token, profile: { username: name, displayName: user.displayName } };
        });
    }

    logout(token: unknown): void {
        this.writeExclusive(() => {
            const value = typeof token === "string" ? token : "";
            if (value && this.data.sessions[value]) {
                delete this.data.sessions[value];
            }
        });
    }

    profile(token: unknown): PlayerProfile | null {
        return this.readLatest(() => {
            const value = typeof token === "string" ? token : "";
            const session = this.data.sessions[value];
            if (!session) return null;
            if (session.expiresAt <= Date.now()) {
                delete this.data.sessions[value];
                this.persistNow();
                return null;
            }
            const user = this.data.users[session.username];
            if (!user) return null;
            return { username: session.username, displayName: user.displayName };
        });
    }

    /** 修改已登录玩家自己的密码；其它会话失效，当前会话保留。 */
    changePassword(
        token: unknown,
        currentPassword: unknown,
        nextPassword: unknown,
    ): void {
        this.writeExclusive(() => {
            const value = typeof token === "string" ? token : "";
            const session = this.data.sessions[value];
            if (!session || session.expiresAt <= Date.now()) {
                throw new PlayerAccountError("登录已失效，请重新登录");
            }
            const user = this.data.users[session.username];
            if (!user) {
                throw new PlayerAccountError("账号不存在");
            }
            const current = typeof currentPassword === "string" ? currentPassword : "";
            if (!verifyHash(current, user.salt, user.hash)) {
                throw new PlayerAccountError("当前密码错误");
            }
            const next = validatePassword(nextPassword);
            const salt = randomBytes(SALT_BYTES).toString("base64");
            user.salt = salt;
            user.hash = deriveHash(next, salt);
            // 其它登录会话作废，仅保留发起修改的当前会话。
            for (const [sessionToken, candidate] of Object.entries(this.data.sessions)) {
                if (sessionToken !== value && candidate.username === session.username) {
                    delete this.data.sessions[sessionToken];
                }
            }
        });
    }

    /** 后台：列出全部账号（用户名 / 显示名 / 创建时间，按创建时间倒序）。 */
    listAccounts(): Array<{ username: string; displayName: string; createdAt: number }> {
        return this.readLatest(() =>
            Object.entries(this.data.users)
                .map(([username, user]) => ({
                    username,
                    displayName: user.displayName,
                    createdAt: user.createdAt,
                }))
                .sort((a, b) => b.createdAt - a.createdAt)
        );
    }

    /** 后台：删除玩家账号（同时清除该账号全部登录会话）。 */
    deleteAccount(username: unknown): void {
        this.writeExclusive(() => {
            const name = typeof username === "string" ? normalizeUsername(username) : "";
            if (!name || !this.data.users[name]) {
                throw new PlayerAccountError("账号不存在");
            }
            delete this.data.users[name];
            for (const [token, session] of Object.entries(this.data.sessions)) {
                if (session.username === name) {
                    delete this.data.sessions[token];
                }
            }
        });
    }

    private load(): AccountsFile {
        if (!fs.existsSync(this.filePath)) {
            this.corrupt = false;
            return { users: {}, sessions: {} };
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AccountsFile>;
            this.corrupt = false;
            return {
                users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
                sessions: parsed.sessions && typeof parsed.sessions === "object"
                    ? parsed.sessions
                    : {},
            };
        } catch {
            // 损坏：保留损坏副本，尝试 .bak 恢复；无有效备份则进入只读维护，
            // 不再抛错让服务无法启动，但拒绝任何写操作以免清空账号。
            if (!this.corrupt) {
                this.corrupt = true;
                const corruptCopy = `${this.filePath}.corrupt-${Date.now()}`;
                try {
                    fs.copyFileSync(this.filePath, corruptCopy);
                } catch {
                    // ignore
                }
                const bak = `${this.filePath}.bak`;
                if (fs.existsSync(bak)) {
                    try {
                        const bakParsed = JSON.parse(
                            fs.readFileSync(bak, "utf8"),
                        ) as Partial<AccountsFile>;
                        if (
                            bakParsed
                            && typeof bakParsed === "object"
                            && bakParsed.users
                        ) {
                            this.corrupt = false;
                            console.warn(
                                `[player-accounts] ${this.filePath} 损坏，已保存损坏副本 ${corruptCopy} 并从备份恢复。`,
                            );
                            return {
                                users: bakParsed.users && typeof bakParsed.users === "object"
                                    ? bakParsed.users
                                    : {},
                                sessions: bakParsed.sessions
                                        && typeof bakParsed.sessions === "object"
                                    ? bakParsed.sessions
                                    : {},
                            };
                        }
                    } catch {
                        // 备份也无效
                    }
                }
                console.error(
                    `[player-accounts] ${this.filePath} 损坏且无有效备份，进入只读维护（损坏副本 ${corruptCopy}）。写操作将被拒绝。`,
                );
            }
            return { users: {}, sessions: {} };
        }
    }

    private persistNow(): void {
        if (this.corrupt) {
            throw new PersistenceError(
                `[player-accounts] 账号文件只读维护中，拒绝写入：${this.filePath}`,
            );
        }
        const tmp = `${this.filePath}.tmp`;
        try {
            fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
            fs.renameSync(tmp, this.filePath);
            this.persistFailed = false;
        } catch (error) {
            this.persistFailed = true;
            try {
                fs.rmSync(tmp, { force: true });
            } catch {
                // ignore
            }
            console.error("[player-accounts] failed to persist:", error);
            throw new PersistenceError(
                `[player-accounts] 数据保存失败：${this.filePath}（${
                    error instanceof Error ? error.message : String(error)
                }）`,
            );
        }
    }

    private pruneSessions(): void {
        // 必须走 writeExclusive：先加锁再重载磁盘最新数据，清理过期会话后
        // 原子落盘。直接改 this.data + persistNow() 会在多实例（API 进程 +
        // 后台进程）下用旧数据覆盖另一实例刚写入的新账号。
        this.writeExclusive(() => {
            const now = Date.now();
            for (const [token, session] of Object.entries(this.data.sessions)) {
                if (session.expiresAt <= now) {
                    delete this.data.sessions[token];
                }
            }
        });
    }
}
