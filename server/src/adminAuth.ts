import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { Config, getServerDataFilePath, migrateServerDataFile } from "./config.ts";

interface LegacyHashedAdminCredential {
    version: 1;
    salt: string;
    hash: string;
}

interface PlainTextAdminCredential {
    version: 2;
    /**
     * Intentionally stored in plain text at the server owner's request.
     * The file stays outside the web root and is never returned by an API.
     */
    password: string;
}

type StoredAdminCredential = LegacyHashedAdminCredential | PlainTextAdminCredential;

interface AdminSession {
    expiresAt: number;
}

export interface AdminLoginResult {
    sessionToken: string;
    expiresAt: string;
}

export class AdminAuthError extends Error {}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_HASH_BYTES = 32;

export class AdminAuthManager {
    private credential: StoredAdminCredential;
    private readonly sessions = new Map<string, AdminSession>();
    private readonly credentialPath: string;

    constructor() {
        // 管理员凭据也放入独立数据目录，避免全量更新/误删项目根目录时丢失。
        migrateServerDataFile(
            Config.admin.credentialFile || "survivio-admin-auth.json",
        );
        this.credentialPath = getServerDataFilePath(
            Config.admin.credentialFile || "survivio-admin-auth.json",
        );
        this.credential = this.loadOrCreateCredential();
        setInterval(() => this.pruneSessions(), 10 * 60 * 1000).unref?.();
    }

    login(password: unknown): AdminLoginResult {
        if (typeof password !== "string" || !this.verifyPassword(password)) {
            throw new AdminAuthError("管理员密码错误");
        }

        // Transparently migrate V15-V19 salted credentials after the first
        // successful login. The entered password is already known here, so no
        // password reset is required when upgrading.
        if (this.credential.version === 1) {
            this.credential = createPlainCredential(password);
            writeCredential(this.credentialPath, this.credential);
        }

        const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
        const expiresAt = Date.now() + Math.max(1, Config.admin.sessionHours) * 60 * 60 * 1000;
        this.sessions.set(sessionToken, { expiresAt });
        return { sessionToken, expiresAt: new Date(expiresAt).toISOString() };
    }

    authorize(sessionToken: string): boolean {
        if (!sessionToken) return false;
        const session = this.sessions.get(sessionToken);
        if (!session) return false;
        const now = Date.now();
        if (session.expiresAt <= now) {
            this.sessions.delete(sessionToken);
            return false;
        }
        // Sliding expiry: an actively used dashboard must not suddenly stop after
        // sessionHours. Inactive tabs still expire normally and are pruned.
        session.expiresAt = now + Math.max(1, Config.admin.sessionHours) * 60 * 60 * 1000;
        return true;
    }

    logout(sessionToken: string): void {
        if (sessionToken) this.sessions.delete(sessionToken);
    }

    changePassword(currentPassword: unknown, nextPassword: unknown): void {
        if (typeof currentPassword !== "string" || !this.verifyPassword(currentPassword)) {
            throw new AdminAuthError("当前管理员密码错误");
        }
        const normalized = validatePassword(nextPassword);
        this.credential = createPlainCredential(normalized);
        writeCredential(this.credentialPath, this.credential);
        this.sessions.clear();
    }

    private verifyPassword(password: string): boolean {
        if (password.length > PASSWORD_MAX_LENGTH) return false;
        if (this.credential.version === 1) {
            const expected = Buffer.from(this.credential.hash, "base64");
            const actual = derivePasswordHash(password, this.credential.salt);
            return expected.length === actual.length && timingSafeEqual(expected, actual);
        }

        // Compare fixed-length digests so that a plain-text credential file does
        // not also require a variable-time string comparison.
        const expected = createHash("sha256").update(this.credential.password).digest();
        const actual = createHash("sha256").update(password).digest();
        return timingSafeEqual(expected, actual);
    }

    private loadOrCreateCredential(): StoredAdminCredential {
        if (fs.existsSync(this.credentialPath)) {
            const parsed = JSON.parse(fs.readFileSync(this.credentialPath, "utf8"));
            if (
                parsed?.version === 2
                && typeof parsed.password === "string"
                && parsed.password.length >= PASSWORD_MIN_LENGTH
                && parsed.password.length <= PASSWORD_MAX_LENGTH
            ) {
                return parsed as PlainTextAdminCredential;
            }
            if (
                parsed?.version === 1
                && typeof parsed.salt === "string"
                && typeof parsed.hash === "string"
            ) {
                return parsed as LegacyHashedAdminCredential;
            }
            throw new Error(`管理员密码文件格式无效: ${this.credentialPath}`);
        }

        const configured = process.env["SURVIV_ADMIN_PASSWORD"];
        const generated = configured ? undefined : randomBytes(15).toString("base64url");
        const password = validatePassword(configured ?? generated);
        const credential = createPlainCredential(password);
        writeCredential(this.credentialPath, credential);

        if (generated) {
            console.warn("============================================================");
            console.warn("[Admin] 已生成后台初始密码:");
            console.warn(`[Admin] ${generated}`);
            console.warn(`[Admin] 密码以明文保存在: ${this.credentialPath}`);
            console.warn("[Admin] 登录后可在后台修改，也可在首次启动前设置 SURVIV_ADMIN_PASSWORD。");
            console.warn("============================================================");
        }
        return credential;
    }

    private pruneSessions(): void {
        const now = Date.now();
        for (const [token, session] of this.sessions) {
            if (session.expiresAt <= now) this.sessions.delete(token);
        }
    }
}

function validatePassword(value: unknown): string {
    if (typeof value !== "string") throw new AdminAuthError("管理员密码无效");
    if (value.length < PASSWORD_MIN_LENGTH) {
        throw new AdminAuthError(`管理员密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`);
    }
    if (value.length > PASSWORD_MAX_LENGTH) {
        throw new AdminAuthError(`管理员密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符`);
    }
    return value;
}

function createPlainCredential(password: string): PlainTextAdminCredential {
    return {
        version: 2,
        password,
    };
}

function derivePasswordHash(password: string, salt: string): Buffer {
    return scryptSync(password, Buffer.from(salt, "base64"), PASSWORD_HASH_BYTES, {
        N: 16384,
        r: 8,
        p: 1,
    });
}

function writeCredential(filePath: string, credential: StoredAdminCredential): void {
    fs.writeFileSync(filePath, `${JSON.stringify(credential, null, 4)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        // Windows does not implement POSIX mode bits; the file remains outside web roots.
    }
}
