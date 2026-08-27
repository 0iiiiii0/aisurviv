/**
 * Player username + password login.
 *
 * The session token is kept in localStorage so a page refresh stays logged in.
 * The API endpoints live under /api/account/* on the API server and the
 * password is only ever sent over the network for login/register; it is never
 * stored client-side.
 */

const ACCOUNT_TOKEN_KEY = "surviv_player_session";
const ACCOUNT_NAME_KEY = "surviv_player_display_name";

interface AccountResponse {
    ok?: boolean;
    err?: string;
    token?: string;
    username?: string;
    displayName?: string;
}

class PlayerAccountRequestError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "PlayerAccountRequestError";
    }
}

export class PlayerAccount {
    token: string | null = null;
    username = "";
    displayName = "";

    constructor() {
        this.token = localStorage.getItem(ACCOUNT_TOKEN_KEY);
        this.displayName = localStorage.getItem(ACCOUNT_NAME_KEY) || "";
    }

    get loggedIn(): boolean {
        return Boolean(this.token);
    }

    /**
     * 仓库身份（stash identity）通道：随 JoinMsg.loadoutPriv 发送给服务器。
     * 登录玩家的仓库/配装始终绑定账号显示名（不受对局内昵称影响），服务器据此
     * 发放/结算搜打撤配装，避免"起了装备进绝密却空手"的偶发问题。
     * 未登录时为空字符串，服务器回退到对局内昵称（与原行为一致）。
     */
    get loadoutPriv(): string {
        return this.displayName || this.username || "";
    }

    private async request(
        path: string,
        body: Record<string, unknown>,
    ): Promise<AccountResponse> {
        const response = await fetch(path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(body),
        });
        let result: AccountResponse;
        try {
            result = (await response.json()) as AccountResponse;
        } catch {
            throw new PlayerAccountRequestError(
                response.ok ? "账号服务响应格式无效" : `请求失败（${response.status}）`,
                response.status,
            );
        }
        if (!response.ok) {
            throw new PlayerAccountRequestError(
                result.err || `请求失败（${response.status}）`,
                response.status,
            );
        }
        return result;
    }

    /**
     * Revalidate the current player session against the authoritative account API.
     *
     * Team-room creation needs this even when `loggedIn` is already true: the
     * browser only knows that a token exists locally, while `/team_v2` validates
     * that token against the server. Confirming it immediately before opening an
     * extraction room prevents the UI from saying "logged in" and then having the
     * team socket reject the same player as a guest.
     */
    async validateSession(): Promise<boolean> {
        const restoredToken = this.token;
        if (!restoredToken) return false;
        try {
            const result = await this.request("/api/account/profile", {
                token: restoredToken,
            });
            // A login/logout may finish while the profile request is in flight.
            // Never let that stale response overwrite or clear the newer session.
            if (this.token !== restoredToken) return this.loggedIn;
            if (result.ok) {
                this.username = String(result.username ?? "");
                this.displayName = String(result.displayName ?? this.displayName);
                localStorage.setItem(ACCOUNT_NAME_KEY, this.displayName);
                return true;
            }
            // The server explicitly rejected the token (expired / logged out).
            this.clearSession();
        } catch (error) {
            if (
                error instanceof PlayerAccountRequestError
                && (error.status === 401 || error.status === 403)
                && this.token === restoredToken
            ) {
                // The account API authoritatively rejected this session. Clear
                // it so extraction opens the login dialog instead of retrying a
                // permanently invalid token forever.
                this.clearSession();
            }
            // Network/5xx failures keep the local token so a temporary outage
            // does not sign the player out. The caller can retry validation.
        }
        return false;
    }

    /** Validates a previously stored session token; safe to call on load. */
    async restoreSession(): Promise<boolean> {
        return this.validateSession();
    }

    async login(username: string, password: string): Promise<void> {
        const result = await this.request("/api/account/login", { username, password });
        if (!result.ok || !result.token) {
            throw new Error(result.err || "登录失败");
        }
        this.token = result.token;
        this.username = String(result.username ?? "");
        this.displayName = String(result.displayName ?? this.username);
        localStorage.setItem(ACCOUNT_TOKEN_KEY, this.token);
        localStorage.setItem(ACCOUNT_NAME_KEY, this.displayName);
    }

    async register(username: string, password: string): Promise<void> {
        const result = await this.request("/api/account/register", { username, password });
        if (!result.ok) {
            throw new Error(result.err || "注册失败");
        }
        // Registering with a known password also signs the player in.
        await this.login(username, password);
    }

    async logout(): Promise<void> {
        if (this.token) {
            try {
                await this.request("/api/account/logout", { token: this.token });
            } catch {
                // Best effort; the local session is cleared regardless.
            }
        }
        this.clearSession();
    }

    async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
        if (!this.token) throw new Error("请先登录");
        const result = await this.request("/api/account/change_password", {
            token: this.token,
            currentPassword,
            nextPassword,
        });
        if (!result.ok) {
            throw new Error(result.err || "修改密码失败");
        }
    }

    private clearSession(): void {
        this.token = null;
        this.username = "";
        this.displayName = "";
        localStorage.removeItem(ACCOUNT_TOKEN_KEY);
        localStorage.removeItem(ACCOUNT_NAME_KEY);
    }
}
