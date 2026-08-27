import os from "node:os";

interface CpuTimesSnapshot {
    idle: number;
    total: number;
}

function readCpuTimes(): CpuTimesSnapshot {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        idle += Number(cpu.times.idle) || 0;
        total += (Number(cpu.times.user) || 0)
            + (Number(cpu.times.nice) || 0)
            + (Number(cpu.times.sys) || 0)
            + (Number(cpu.times.idle) || 0)
            + (Number(cpu.times.irq) || 0);
    }
    return { idle, total };
}

/**
 * Lightweight whole-system CPU sampler. It works on Windows because it derives
 * utilization from os.cpus() time deltas rather than Unix load averages.
 */
export class SystemCpuMonitor {
    private previous = readCpuTimes();
    private smoothedPercent = 0;
    private initialized = false;

    sample(): number {
        const current = readCpuTimes();
        const totalDelta = Math.max(0, current.total - this.previous.total);
        const idleDelta = Math.max(0, current.idle - this.previous.idle);
        this.previous = current;

        if (totalDelta <= 0) return this.smoothedPercent;
        const instant = Math.max(
            0,
            Math.min(100, ((totalDelta - Math.min(totalDelta, idleDelta)) / totalDelta) * 100),
        );
        if (!this.initialized) {
            this.initialized = true;
            this.smoothedPercent = instant;
        } else {
            // Short spikes matter for spawn protection, but smoothing avoids
            // oscillating the bot cadence every second.
            this.smoothedPercent = this.smoothedPercent * 0.62 + instant * 0.38;
        }
        return this.smoothedPercent;
    }

    get percent(): number {
        return this.smoothedPercent;
    }
}

export function normalizeCpuLimits(
    softLimit: number,
    hardLimit: number,
): { softLimit: number; hardLimit: number } {
    const hard = Math.max(45, Math.min(95, Number(hardLimit) || 80));
    const soft = Math.max(25, Math.min(hard - 3, Number(softLimit) || 70));
    return { softLimit: soft, hardLimit: hard };
}

/**
 * CPU load limits are disabled by default (SURVIV_CPU_LIMIT_ENABLED unset).
 * Set SURVIV_CPU_LIMIT_ENABLED=1 (or "true") to restore the soft/hard
 * throttling controlled by SURVIV_CPU_SOFT_LIMIT / SURVIV_CPU_HARD_LIMIT.
 */
export function cpuLimitEnabledFromEnv(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const value = env.SURVIV_CPU_LIMIT_ENABLED;
    return value === "1" || value === "true";
}

/**
 * Multiplier for bot thinking/tick intervals. 1 means normal cadence. The
 * multiplier rises before the hard target and becomes aggressive above it.
 */
export function cpuThrottleScale(
    cpuPercent: number,
    softLimit = 70,
    hardLimit = 80,
    enabled = true,
): number {
    if (!enabled) return 1;
    const limits = normalizeCpuLimits(softLimit, hardLimit);
    const usage = Math.max(0, Number(cpuPercent) || 0);
    if (usage < limits.softLimit) return 1;
    if (usage < limits.hardLimit) {
        const t = (usage - limits.softLimit) / (limits.hardLimit - limits.softLimit);
        return 1.2 + t * 1.35;
    }
    const over = Math.min(20, usage - limits.hardLimit);
    return Math.min(4.5, 2.8 + over * 0.085);
}

/**
 * Adaptive connection delay. Above the hard target new AI creation is paused;
 * the caller can retry after the returned delay.
 */
export function adaptiveBotJoinDelay(
    baseDelayMs: number,
    cpuPercent: number,
    softLimit = 70,
    hardLimit = 80,
    enabled = true,
): { delayMs: number; pause: boolean } {
    if (!enabled) {
        return { delayMs: baseDelayMs, pause: false };
    }
    const limits = normalizeCpuLimits(softLimit, hardLimit);
    const base = Math.max(500, Math.min(60_000, Math.round(baseDelayMs) || 2000));
    const usage = Math.max(0, Number(cpuPercent) || 0);
    if (usage >= limits.hardLimit) {
        return {
            delayMs: Math.max(5000, Math.round(base * 3)),
            pause: true,
        };
    }
    if (usage < limits.softLimit) return { delayMs: base, pause: false };
    const t = (usage - limits.softLimit) / (limits.hardLimit - limits.softLimit);
    return {
        delayMs: Math.round(base * (1.45 + t * 1.8)),
        pause: false,
    };
}
