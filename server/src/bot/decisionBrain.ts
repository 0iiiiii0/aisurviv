export type BotState =
    | "waiting"
    | "combat"
    | "counterfire"
    | "retreat"
    | "heal"
    | "gas"
    | "airstrike"
    | "special"
    | "revive"
    | "cover"
    | "regroup"
    | "training-target"
    | "loot"
    | "break-crate"
    | "hide"
    | "flush"
    | "explore";

export type BotIntentKind =
    | "waiting"
    | "hold-revive"
    | "hold-heal"
    | "continue-special"
    | "special-role"
    | "evade-airstrike"
    | "escape-gas"
    | "post-revive-retreat"
    | "revive"
    | "heal-in-cover"
    | "heal"
    | "urgent-loot"
    | "vault-panel"
    | "puzzle"
    | "urgent-crate"
    | "weapon-search"
    | "duel-throwable"
    | "duel-cover-shot"
    | "tactical-shot"
    | "change-floor"
    | "formation-change-floor"
    | "combat"
    | "blindfire"
    | "counterfire"
    | "flush"
    | "hide"
    | "cover-rescue"
    | "human-escort"
    | "faction-order"
    | "formation"
    | "duel-position"
    | "enemy-search"
    | "late-ring"
    | "loot"
    | "strobe-barrage"
    | "break-crate"
    | "regroup"
    | "explore";

/**
 * Coarse priority bands. Utility is only compared inside a band; a higher band
 * always wins unless state commitment is still active and the new intent is not
 * marked critical.
 */
export const IntentTier = {
    idle: 1,
    strategic: 2,
    resource: 3,
    support: 4,
    combat: 5,
    emergency: 6,
    critical: 7,
} as const;

export interface BotIntentCandidate {
    kind: BotIntentKind;
    state: BotState;
    tier: number;
    utility: number;
    /** Stable identity for target-specific commitment, e.g. `loot:123`. */
    targetKey?: string;
    /** Minimum time to keep the intent unless a critical intent appears. */
    commitMs?: number;
    /** Critical intents may interrupt an active commitment immediately. */
    critical?: boolean;
    reason?: string;
}

export interface BotIntentDecision extends BotIntentCandidate {
    selectedAt: number;
    retained: boolean;
}

export interface TacticalDecisionBrainOptions {
    switchMargin?: number;
    defaultCommitMs?: Partial<Record<BotIntentKind, number>>;
    /**
     * A candidate generator may miss one or two frames while object snapshots are
     * being updated. Keep the existing task alive briefly instead of treating a
     * single missing candidate as proof that the task became invalid.
     */
    candidateGraceMs?: number;
    /** A same-tier challenger must remain better for this long before takeover. */
    challengerConfirmMs?: number;
    /** Extra cost for switching target while keeping the same intent kind. */
    sameKindTargetSwitchMargin?: number;
    /** EMA weight applied to the newest utility sample. 1 disables smoothing. */
    utilitySmoothingAlpha?: number;
}

const DEFAULT_COMMIT_MS: Record<BotIntentKind, number> = {
    waiting: 0,
    "hold-revive": 180,
    "hold-heal": 180,
    "continue-special": 220,
    "special-role": 360,
    "evade-airstrike": 420,
    "escape-gas": 520,
    "post-revive-retreat": 720,
    revive: 520,
    "heal-in-cover": 650,
    heal: 500,
    "urgent-loot": 900,
    "vault-panel": 1050,
    puzzle: 1300,
    "urgent-crate": 1200,
    "weapon-search": 1650,
    "duel-throwable": 520,
    "duel-cover-shot": 380,
    "strobe-barrage": 520,
    "tactical-shot": 320,
    "change-floor": 1050,
    "formation-change-floor": 1200,
    combat: 470,
    blindfire: 320,
    counterfire: 340,
    flush: 500,
    hide: 720,
    "cover-rescue": 620,
    "human-escort": 820,
    "faction-order": 700,
    formation: 760,
    "duel-position": 720,
    "enemy-search": 900,
    "late-ring": 800,
    loot: 760,
    "break-crate": 1000,
    regroup: 620,
    explore: 760,
};

const identity = (candidate: BotIntentCandidate): string => `${candidate.kind}|${candidate.targetKey ?? ""}`;

const rank = (candidate: BotIntentCandidate): number => candidate.tier * 10_000 + candidate.utility;

interface SmoothedUtility {
    value: number;
    updatedAt: number;
}

/**
 * High-level intent arbitration with commitment, candidate leases and score
 * hysteresis. A network/object-pool frame is allowed to omit the active target
 * briefly without collapsing the whole task, while real emergency tiers still
 * interrupt immediately.
 */
export class TacticalDecisionBrain {
    private readonly switchMargin: number;
    private readonly commitMs: Record<BotIntentKind, number>;
    private readonly candidateGraceMs: number;
    private readonly challengerConfirmMs: number;
    private readonly sameKindTargetSwitchMargin: number;
    private readonly utilitySmoothingAlpha: number;
    private current: BotIntentDecision | null = null;
    private lockUntil = 0;
    private currentLastSeenAt = 0;
    private pendingChallengerIdentity = "";
    private pendingChallengerSince = 0;
    private readonly smoothedUtilities = new Map<string, SmoothedUtility>();

    constructor(options: TacticalDecisionBrainOptions = {}) {
        this.switchMargin = options.switchMargin ?? 18;
        this.commitMs = {
            ...DEFAULT_COMMIT_MS,
            ...options.defaultCommitMs,
        };
        this.candidateGraceMs = Math.max(0, options.candidateGraceMs ?? 420);
        this.challengerConfirmMs = Math.max(0, options.challengerConfirmMs ?? 120);
        this.sameKindTargetSwitchMargin = Math.max(
            0,
            options.sameKindTargetSwitchMargin ?? 55,
        );
        this.utilitySmoothingAlpha = Math.max(
            0.05,
            Math.min(1, options.utilitySmoothingAlpha ?? 0.55),
        );
    }

    reset(): void {
        this.current = null;
        this.lockUntil = 0;
        this.currentLastSeenAt = 0;
        this.clearPendingChallenger();
        this.smoothedUtilities.clear();
    }

    currentDecision(): BotIntentDecision | null {
        return this.current ? { ...this.current } : null;
    }

    choose(candidates: readonly BotIntentCandidate[], timestamp: number): BotIntentDecision {
        const prepared = this.prepareCandidates(candidates, timestamp);
        if (prepared.length === 0) {
            if (
                this.current
                && timestamp - this.currentLastSeenAt <= this.candidateGraceMs
            ) {
                return this.retainShadow(timestamp, "candidate-grace:no-candidate");
            }
            const fallback: BotIntentCandidate = {
                kind: "waiting",
                state: "waiting",
                tier: IntentTier.idle,
                utility: 0,
                reason: "no-candidate",
            };
            return this.accept(fallback, timestamp, false);
        }

        const sorted = [...prepared].sort((a, b) => rank(b) - rank(a));
        const best = sorted[0];
        const currentIdentity = this.current ? identity(this.current) : "";
        const currentCandidate = currentIdentity
            ? sorted.find((candidate) => identity(candidate) === currentIdentity) ?? null
            : null;

        if (this.current && !currentCandidate) {
            const canHardInterrupt = Boolean(best.critical) || best.tier > this.current.tier;
            if (
                !canHardInterrupt
                && timestamp - this.currentLastSeenAt <= this.candidateGraceMs
            ) {
                return this.retainShadow(timestamp, "candidate-grace:temporarily-missing");
            }
        }

        if (this.current && currentCandidate) {
            this.currentLastSeenAt = timestamp;
            const bestIsCurrent = identity(best) === currentIdentity;
            if (bestIsCurrent) {
                this.clearPendingChallenger();
                return this.retain(currentCandidate, timestamp);
            }

            const canHardInterrupt = Boolean(best.critical) || best.tier > currentCandidate.tier;
            if (timestamp < this.lockUntil && !canHardInterrupt) {
                return this.retain(currentCandidate, timestamp);
            }

            const sameKindTargetSwitch = best.kind === currentCandidate.kind
                && identity(best) !== identity(currentCandidate);
            const requiredMargin = this.switchMargin
                + (sameKindTargetSwitch ? this.sameKindTargetSwitchMargin : 0);
            if (
                !canHardInterrupt
                && rank(best) < rank(currentCandidate) + requiredMargin
            ) {
                this.clearPendingChallenger();
                return this.retain(currentCandidate, timestamp);
            }

            if (
                !canHardInterrupt
                && this.challengerConfirmMs > 0
                && best.tier === currentCandidate.tier
            ) {
                const bestIdentity = identity(best);
                if (this.pendingChallengerIdentity !== bestIdentity) {
                    this.pendingChallengerIdentity = bestIdentity;
                    this.pendingChallengerSince = timestamp;
                    return this.retain(currentCandidate, timestamp);
                }
                if (timestamp - this.pendingChallengerSince < this.challengerConfirmMs) {
                    return this.retain(currentCandidate, timestamp);
                }
            }
        }

        return this.accept(best, timestamp, false);
    }

    private prepareCandidates(
        candidates: readonly BotIntentCandidate[],
        timestamp: number,
    ): BotIntentCandidate[] {
        const activeIdentities = new Set<string>();
        const prepared = candidates.map((candidate) => {
            const key = identity(candidate);
            activeIdentities.add(key);
            const previous = this.smoothedUtilities.get(key);
            const rawUtility = Number.isFinite(candidate.utility) ? candidate.utility : 0;
            const value = previous
                ? previous.value
                    + (rawUtility - previous.value) * this.utilitySmoothingAlpha
                : rawUtility;
            this.smoothedUtilities.set(key, { value, updatedAt: timestamp });
            return { ...candidate, utility: value };
        });

        // Avoid an unbounded map when transient target ids are generated for a
        // long-running room. Keep current/pending entries and recent samples.
        if (this.smoothedUtilities.size > 256) {
            const keepCurrent = this.current ? identity(this.current) : "";
            for (const [key, sample] of this.smoothedUtilities) {
                if (
                    !activeIdentities.has(key)
                    && key !== keepCurrent
                    && key !== this.pendingChallengerIdentity
                    && timestamp - sample.updatedAt > 5000
                ) {
                    this.smoothedUtilities.delete(key);
                }
            }
        }
        return prepared;
    }

    private retain(candidate: BotIntentCandidate, timestamp: number): BotIntentDecision {
        const selectedAt = this.current?.selectedAt ?? timestamp;
        this.current = {
            ...candidate,
            selectedAt,
            retained: true,
        };
        return { ...this.current };
    }

    private retainShadow(timestamp: number, reason: string): BotIntentDecision {
        if (!this.current) {
            return this.accept(
                {
                    kind: "waiting",
                    state: "waiting",
                    tier: IntentTier.idle,
                    utility: 0,
                    reason,
                },
                timestamp,
                false,
            );
        }
        this.current = {
            ...this.current,
            retained: true,
            reason: this.current.reason
                ? (this.current.reason.includes(reason)
                    ? this.current.reason
                    : `${this.current.reason}|${reason}`)
                : reason,
        };
        return { ...this.current };
    }

    private accept(
        candidate: BotIntentCandidate,
        timestamp: number,
        retained: boolean,
    ): BotIntentDecision {
        const commitMs = candidate.commitMs ?? this.commitMs[candidate.kind] ?? 0;
        this.current = {
            ...candidate,
            selectedAt: timestamp,
            retained,
        };
        this.lockUntil = timestamp + Math.max(0, commitMs);
        this.currentLastSeenAt = timestamp;
        this.clearPendingChallenger();
        return { ...this.current };
    }

    private clearPendingChallenger(): void {
        this.pendingChallengerIdentity = "";
        this.pendingChallengerSince = 0;
    }
}
