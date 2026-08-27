function stripIpv6Brackets(hostname: string): string {
    const trimmed = hostname.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]")
        ? trimmed.slice(1, -1)
        : trimmed;
}

export function formatHostPort(hostname: string, port: number | string): string {
    const bareHostname = stripIpv6Brackets(hostname);
    const formattedHostname = bareHostname.includes(":")
        ? `[${bareHostname}]`
        : bareHostname;
    return `${formattedHostname}:${port}`;
}

export function isLocalNetworkAddress(hostname: string): boolean {
    const normalized = stripIpv6Brackets(hostname).toLowerCase();
    return (
        normalized === "localhost"
        || normalized === "0.0.0.0"
        || normalized.startsWith("127.")
        || normalized === "::"
        || normalized === "::1"
        || normalized.startsWith("::ffff:127.")
    );
}

/**
 * Development servers advertise a loopback address. Replace it with the host
 * used to open the web client so another LAN/IPv6 device connects to the game
 * server instead of its own loopback interface.
 */
export function resolveAdvertisedAddress(
    advertisedAddress: string,
    pageHostname: string,
): string {
    try {
        const parsed = new URL(`http://${advertisedAddress}`);
        if (!isLocalNetworkAddress(parsed.hostname)) return advertisedAddress;

        const port = parsed.port;
        if (!port || !pageHostname) return advertisedAddress;
        return formatHostPort(pageHostname, port);
    } catch {
        return advertisedAddress;
    }
}

/**
 * Replace a loopback host in a server-advertised URL while preserving its
 * protocol, room port, path and query string. This lets a remotely opened web
 * client use the deployment server's hostname for direct room connections.
 */
export function resolveAdvertisedUrl(
    advertisedUrl: string,
    pageHostname: string,
): string {
    try {
        const parsed = new URL(advertisedUrl);
        parsed.host = resolveAdvertisedAddress(parsed.host, pageHostname);
        return parsed.toString();
    } catch {
        return advertisedUrl;
    }
}
