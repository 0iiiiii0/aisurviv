export const GAME_PROCESS_HEARTBEAT_WARN_MS = 12_000;
export const GAME_PROCESS_HEARTBEAT_KILL_MS = 30_000;

export interface FaultDecision {
    consecutive: number;
    recent: number;
    pauseMs: number;
    fatal: boolean;
}

/**
 * Keeps a recoverable exception in one room tick from terminating the isolated
 * game child process. Repeated failures are rate-limited; only a sustained
 * fault storm is treated as fatal.
 */
export class GameFaultCircuitBreaker {
    private consecutive = 0;
    private recentFailures: number[] = [];

    success(): void {
        this.consecutive = 0;
    }

    failure(now = Date.now()): FaultDecision {
        this.consecutive++;
        this.recentFailures.push(now);
        const cutoff = now - 30_000;
        while (this.recentFailures.length > 0 && this.recentFailures[0] < cutoff) {
            this.recentFailures.shift();
        }
        const recent = this.recentFailures.length;
        return {
            consecutive: this.consecutive,
            recent,
            pauseMs: Math.min(1500, 80 * Math.max(1, this.consecutive)),
            fatal: this.consecutive >= 20 || recent >= 45,
        };
    }
}

export function heartbeatState(
    lastMessageAt: number,
    now = Date.now(),
): "healthy" | "warning" | "terminate" {
    const age = Math.max(0, now - lastMessageAt);
    if (age >= GAME_PROCESS_HEARTBEAT_KILL_MS) return "terminate";
    if (age >= GAME_PROCESS_HEARTBEAT_WARN_MS) return "warning";
    return "healthy";
}
