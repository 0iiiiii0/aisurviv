import type { TemplatedApp } from "uWebSockets.js";

export function getListenHosts(
    ipv4Host: string,
    ipv6Enabled: boolean,
    ipv6Host: string,
): string[] {
    return [...new Set(ipv6Enabled ? [ipv6Host, ipv4Host] : [ipv4Host])];
}

export function listenOnHosts(
    app: TemplatedApp,
    hosts: string[],
    port: number,
    onListening: (host: string) => void,
    onFailure: () => void,
): void {
    let pending = hosts.length;
    let successful = 0;

    const complete = () => {
        pending--;
        if (pending === 0 && successful === 0) onFailure();
    };

    for (const host of hosts) {
        try {
            app.listen(host, port, (token) => {
                if (token) {
                    successful++;
                    onListening(host);
                }
                complete();
            });
        } catch {
            complete();
        }
    }
}
