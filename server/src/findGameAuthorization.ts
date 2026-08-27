export interface AccountProfileLookup {
    profile(token: unknown): unknown;
}

/**
 * Integrated servers receive a second /api/find_game request from Region.fetch.
 * That internal hop no longer contains the player's session token, so it must
 * be recognized by the server-only region API key instead of re-authenticating
 * it as though it came directly from a browser.
 */
export function isFindGameRequestAuthorized(
    requiresLogin: boolean,
    body: { accountToken?: unknown; apiKey?: unknown },
    configuredApiKey: string,
    accounts: AccountProfileLookup,
    requestIsLoopback = false,
): boolean {
    if (!requiresLogin) return true;

    const trustedRegionHop = requestIsLoopback
        && configuredApiKey.length >= 16
        && typeof body.apiKey === "string"
        && body.apiKey === configuredApiKey;
    return trustedRegionHop || Boolean(accounts.profile(body.accountToken));
}
