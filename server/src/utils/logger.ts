import { Logger as SharedLogger } from "../../../shared/utils/logger.ts";
import { Config } from "../config.ts";

export async function logErrorToWebhook(from: "server" | "client", ...messages: unknown[]) {
    const url = from === "server" ? Config.errorLoggingWebhook : Config.clientErrorLoggingWebhook;
    if (!url) return;

    try {
        const msg = messages
            .map((message) => {
                if (message instanceof Error) {
                    return `\`\`\`${message.cause ?? ""}\n${message.stack ?? message.message}\`\`\``;
                }
                if (typeof message === "object") {
                    return `\`\`\`json\n${JSON.stringify(message, null, 2).replaceAll("`", "\\`")}\n\`\`\``;
                }
                return String(message);
            })
            .join("\n");

        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    color: 0xff0000,
                    title: `${from} error`,
                    timestamp: new Date().toISOString(),
                    description: msg,
                    footer: { text: `Region: ${Config.gameServer.thisRegion}` },
                }],
            }),
        });
    } catch (error) {
        // Avoid recursively invoking the webhook logger.
        console.error("Failed to log error to webhook", error);
    }
}

const logConfig = Config.logging;

export class ServerLogger extends SharedLogger {
    constructor(prefix: string) {
        super(logConfig, prefix);
    }

    override error(...message: unknown[]): void {
        super.error(...message);
        if (this.config.errorLogs) void logErrorToWebhook("server", ...message);
    }
}

/** Compatibility facade for services that still construct Logger(prefix). */
export class Logger {
    readonly config = logConfig;
    readonly prefix: string;
    private readonly delegate: ServerLogger;

    constructor(prefix: string) {
        this.prefix = prefix;
        this.delegate = new ServerLogger(prefix);
    }

    log(...message: unknown[]): void {
        this.delegate.info(...message);
    }

    info(...message: unknown[]): void {
        this.delegate.info(...message);
    }

    debug(...message: unknown[]): void {
        this.delegate.debug(...message);
    }

    warn(...message: unknown[]): void {
        this.delegate.warn(...message);
    }

    error(...message: unknown[]): void {
        this.delegate.error(...message);
    }

    struct(level: "info" | "warn" | "error", data: Record<string, unknown>, ...message: unknown[]): void {
        this[level](...message, data);
    }

    exception(error: Error, context?: Record<string, unknown>): void {
        this.error(error, context ?? {});
    }
}

export const defaultLogger = new ServerLogger("Generic");
