import fs from "node:fs";
import path from "node:path";
import { configPath } from "../config.ts";

const isProduction = process.env["NODE_ENV"] === "production";

function crashLogDir(): string {
    const dir = path.join(configPath, "crash-logs");
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch { /* */ }
    return dir;
}

/** 把异常/退出信息追加到 crash-logs/server-crash.log，便于离线排查炸服原因。 */
export function appendCrash(kind: string, detail: unknown): void {
    try {
        const file = path.join(crashLogDir(), "server-crash.log");
        const stack = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
        fs.appendFileSync(file, `\n[${new Date().toISOString()}] ${kind}\n${stack}\n`);
    } catch {
        // 记录日志绝不能掩盖原始错误
    }
}

function writeStructuredCrash(kind: string, detail: unknown): void {
    if (!isProduction) return;
    try {
        const fileName = `crash-${kind}-${Date.now()}.json`;
        const filePath = path.join(crashLogDir(), fileName);
        const report = {
            ts: new Date().toISOString(),
            kind,
            pid: process.pid,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            message: detail instanceof Error ? detail.message : String(detail),
            stack: detail instanceof Error ? detail.stack : undefined,
        };
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + "\n", "utf8");
    } catch {
        // best-effort
    }
}

/**
 * 进程级兜底（生产 apiServer/gameServer 与 devServer 共用）：
 * - 管道断开时 console 写 stdout/stderr 抛 EPIPE：挂 error 处理器 + 忽略，
 *   避免"日志管道一断整个服务器进程崩溃、整局对局被销毁"。
 * - 未捕获异常：写入 crash-logs 后退出（由启动器自动重启），保证可诊断。
 * - 未处理拒绝：只写日志不退出。
 * - 非零退出码/信号：写日志，便于区分 JS 异常与外部强杀/内存致命错误。
 */
export function installCrashHandlers(): void {
    process.stdout.on("error", () => {});
    process.stderr.on("error", () => {});
    process.on("uncaughtException", (error) => {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EPIPE") {
            return;
        }
        appendCrash("uncaughtException", error);
        writeStructuredCrash("uncaughtException", error);
        console.error(error);
        process.exit(1);
    });
    process.on("unhandledRejection", (reason) => {
        appendCrash("unhandledRejection", reason);
        writeStructuredCrash("unhandledRejection", reason);
        console.error(reason);
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(signal, () => {
            appendCrash(`signal-${signal}`, "received; exiting");
            process.exit(128 + 15);
        });
    }
    process.on("exit", (code) => {
        if (code !== 0) appendCrash(`process-exit-${code}`, "non-zero exit");
    });
}
