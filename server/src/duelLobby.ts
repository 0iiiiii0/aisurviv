import { randomBytes } from "node:crypto";
import { Config } from "./config.ts";
import {
    type DuelAiDifficulty,
    type DuelArmorLevel,
    type DuelScope,
    type DuelThrowables,
    getDuelThrowableCatalog,
    isDuelAiDifficulty,
    isDuelArmorLevel,
    isDuelBoost,
    isDuelScope,
    isDuelThrowables,
    normalizeDuelThrowables,
} from "./duelLoadout.ts";
import {
    cloneDuelPlayerWeapons,
    type DuelPlayerWeapons,
    type DuelWeaponSelectionMode,
    isDuelWeaponSelectionMode,
} from "./duelMatchTypes.ts";
import { getDuelWeaponCatalog, isDuelWeapon } from "./duelWeapons.ts";
import type { GameData } from "./game/gameManager.ts";

const LOBBY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_CODE_LENGTH = 6;
const WAITING_LOBBY_TTL = 30 * 60 * 1000;
const ACTIVE_LOBBY_TTL = 2 * 60 * 60 * 1000;

export interface DuelLobbyMatchData {
    zone: string;
    gameId: string;
    useHttps: boolean;
    hosts: string[];
    addrs: string[];
    data: string;
    /** Public, per-match observer code. It expires when this game ends. */
    spectatorShareCode?: string;
}

export interface DuelLobbyLoadout {
    /** Legacy/shared pair. Used by mirrored mode and by the AI opponent. */
    weapons: [string, string];
    weaponSelectionMode: DuelWeaponSelectionMode;
    adrenalineEnabled: boolean;
    boost: number;
    helmetLevel: DuelArmorLevel;
    chestLevel: DuelArmorLevel;
    scope: DuelScope;
    throwables: DuelThrowables;
    aiEnabled: boolean;
    aiDifficulty: DuelAiDifficulty;
}

export interface DuelLobbyMatchRequest {
    loadout: DuelLobbyLoadout;
    contestantLoadouts: [DuelPlayerWeapons, DuelPlayerWeapons];
    /** True only when every effective match setting equals the current server default. */
    defaultLoadout: boolean;
}

type DuelLobbyStatus = "waiting" | "starting" | "playing";

interface DuelLobbyMember extends DuelPlayerWeapons {
    token: string;
    name: string;
    host: boolean;
    joinedAt: number;
    lastSeenAt: number;
    throwables: DuelThrowables;
}

interface DuelLobby {
    code: string;
    status: DuelLobbyStatus;
    members: DuelLobbyMember[];
    loadout: DuelLobbyLoadout;
    createdAt: number;
    updatedAt: number;
    /** Monotonic state version. Polling/clock collisions cannot roll forms back. */
    revision: number;
    matchGameId?: string;
    spectatorShareCode?: string;
    matchDataByMember: Map<string, DuelLobbyMatchData>;
    awaitingReturns: boolean;
    returnedMemberTokens: Set<string>;
}

export class DuelLobbyError extends Error {}

export interface CreatedDuelLobbyMatch {
    gameId: string;
    matches: DuelLobbyMatchData[];
    spectatorShareCode?: string;
}

export class DuelLobbyService {
    private readonly lobbies = new Map<string, DuelLobby>();

    constructor(
        private readonly createMatch: (
            request: DuelLobbyMatchRequest,
        ) => Promise<CreatedDuelLobbyMatch>,
        private readonly getGame: (gameId: string) => GameData | undefined,
        private readonly stopGame?: (gameId: string) => boolean,
    ) {}

    create(name: unknown) {
        this.cleanup();
        const now = Date.now();
        const member = this.createMember(name, true, now);
        const lobby: DuelLobby = {
            code: this.createCode(),
            status: "waiting",
            members: [member],
            loadout: this.defaultLoadout(),
            createdAt: now,
            updatedAt: now,
            revision: 1,
            matchDataByMember: new Map(),
            awaitingReturns: false,
            returnedMemberTokens: new Set(),
        };
        this.lobbies.set(lobby.code, lobby);
        return { memberToken: member.token, lobby: this.snapshot(lobby, member) };
    }

    join(code: unknown, name: unknown) {
        this.cleanup();
        const lobby = this.requireLobby(code);
        this.refreshMatchState(lobby);
        if (lobby.status !== "waiting") throw new DuelLobbyError("这间1v1大厅正在对局中");
        if (lobby.loadout.aiEnabled) throw new DuelLobbyError("房主已启用 AI 对手，不能再加入真人玩家");
        if (lobby.members.length >= 2) throw new DuelLobbyError("这间1v1大厅已经满员");
        const member = this.createMember(name, false, Date.now());
        lobby.members.push(member);
        this.touch(lobby);
        return { memberToken: member.token, lobby: this.snapshot(lobby, member) };
    }

    status(code: unknown, memberToken: unknown) {
        this.cleanup();
        const { lobby, member } = this.requireMember(code, memberToken);
        this.refreshMatchState(lobby);
        let changed = false;
        if (lobby.awaitingReturns && !lobby.returnedMemberTokens.has(member.token)) {
            lobby.returnedMemberTokens.add(member.token);
            changed = true;
            if (lobby.members.every((candidate) => lobby.returnedMemberTokens.has(candidate.token))) {
                lobby.awaitingReturns = false;
            }
        }
        member.lastSeenAt = Date.now();
        if (changed) this.touch(lobby);
        return { lobby: this.snapshot(lobby, member) };
    }

    updateWeapons(code: unknown, memberToken: unknown, weapons: unknown) {
        const { lobby, member } = this.requireMember(code, memberToken);
        this.assertEditable(lobby);
        const previousWeapons = cloneDuelPlayerWeapons(member).weapons;
        const previousLoadout = this.cloneLoadout(lobby.loadout);
        member.weapons = this.validateWeapons(weapons);
        if (lobby.loadout.aiEnabled && member.host) {
            // Human-vs-AI is always a true mirrored duel. Keep the server copy
            // synchronized transactionally so stale/malicious client payloads
            // cannot give the bot a different pair.
            lobby.loadout.weaponSelectionMode = "mirrored";
            lobby.loadout.weapons = [...member.weapons];
        }
        try {
            this.validateExclusiveSelection(lobby, false);
        } catch (error) {
            member.weapons = previousWeapons;
            lobby.loadout = previousLoadout;
            throw error;
        }
        this.touch(lobby);
        return { lobby: this.snapshot(lobby, member) };
    }

    updateThrowables(code: unknown, memberToken: unknown, throwables: unknown) {
        const { lobby, member } = this.requireMember(code, memberToken);
        this.assertEditable(lobby);
        if (!isDuelThrowables(throwables)) {
            throw new DuelLobbyError("投掷物配置无效");
        }
        member.throwables = normalizeDuelThrowables(throwables);
        if (lobby.loadout.aiEnabled && member.host) {
            // Human-vs-AI mirrors throwables exactly like it mirrors weapons.
            lobby.loadout.throwables = { ...member.throwables };
        }
        this.touch(lobby);
        return { lobby: this.snapshot(lobby, member) };
    }

    updateLoadout(code: unknown, memberToken: unknown, loadout: unknown) {
        const { lobby, member } = this.requireMember(code, memberToken);
        if (!member.host) throw new DuelLobbyError("只有房主可以修改公共规则和 AI 配置");
        this.assertEditable(lobby);
        const validated = this.validateLoadout(loadout);
        if (validated.aiEnabled && lobby.members.length > 1) {
            throw new DuelLobbyError("已有真人玩家加入，不能启用 AI 对手");
        }
        const previousLoadout = this.cloneLoadout(lobby.loadout);
        if (validated.aiEnabled) {
            validated.weaponSelectionMode = "mirrored";
            validated.weapons = [...member.weapons];
        }
        lobby.loadout = validated;
        try {
            this.validateExclusiveSelection(lobby, true);
        } catch (error) {
            lobby.loadout = previousLoadout;
            throw error;
        }
        this.touch(lobby);
        return { lobby: this.snapshot(lobby, member) };
    }

    async start(code: unknown, memberToken: unknown) {
        const { lobby, member } = this.requireMember(code, memberToken);
        this.refreshMatchState(lobby);
        if (!member.host) throw new DuelLobbyError("只有房主可以开始对局");
        if (lobby.status !== "waiting") throw new DuelLobbyError("这间大厅已经开始对局");
        const requiredHumans = lobby.loadout.aiEnabled ? 1 : 2;
        if (lobby.members.length !== requiredHumans) {
            throw new DuelLobbyError(
                lobby.loadout.aiEnabled ? "AI 对局只需要房主一名真人玩家" : "需要两名玩家到齐后才能开始",
            );
        }
        if (lobby.awaitingReturns) throw new DuelLobbyError("需要双方确认返回大厅后才能再开一局");

        const contestantLoadouts = this.resolveContestantLoadouts(lobby);
        lobby.status = "starting";
        lobby.returnedMemberTokens.clear();
        this.touch(lobby);
        try {
            const created = await this.createMatch({
                loadout: this.cloneLoadout(lobby.loadout),
                contestantLoadouts,
                defaultLoadout: this.isDefaultLoadout(lobby, contestantLoadouts),
            });
            if (created.matches.length !== lobby.members.length) {
                throw new Error("Private duel did not return enough join credentials");
            }
            lobby.matchGameId = created.gameId;
            lobby.spectatorShareCode = created.spectatorShareCode;
            lobby.matchDataByMember.clear();
            for (let index = 0; index < lobby.members.length; index++) {
                lobby.matchDataByMember.set(lobby.members[index].token, created.matches[index]);
            }
            lobby.status = "playing";
            this.touch(lobby);
            return { lobby: this.snapshot(lobby, member) };
        } catch (error) {
            lobby.status = "waiting";
            lobby.matchGameId = undefined;
            lobby.spectatorShareCode = undefined;
            lobby.matchDataByMember.clear();
            this.touch(lobby);
            throw error;
        }
    }

    leave(code: unknown, memberToken: unknown) {
        const { lobby, member } = this.requireMember(code, memberToken);
        if (lobby.matchGameId) this.stopGame?.(lobby.matchGameId);
        if (member.host) {
            this.lobbies.delete(lobby.code);
            return { closed: true };
        }
        lobby.members = lobby.members.filter((candidate) => candidate !== member);
        lobby.status = "waiting";
        lobby.matchGameId = undefined;
        lobby.spectatorShareCode = undefined;
        lobby.matchDataByMember.clear();
        lobby.awaitingReturns = false;
        lobby.returnedMemberTokens.clear();
        this.touch(lobby);
        return { closed: false };
    }

    private resolveContestantLoadouts(lobby: DuelLobby): [DuelPlayerWeapons, DuelPlayerWeapons] {
        const host = lobby.members[0];
        if (!host) throw new DuelLobbyError("大厅中没有房主");
        const opponent = lobby.loadout.aiEnabled
            ? cloneDuelPlayerWeapons(host)
            : lobby.members[1];
        if (!opponent) throw new DuelLobbyError("第二名玩家尚未加入");

        let result: [DuelPlayerWeapons, DuelPlayerWeapons];
        if (lobby.loadout.aiEnabled || lobby.loadout.weaponSelectionMode === "mirrored") {
            const pair = cloneDuelPlayerWeapons(host);
            result = [pair, cloneDuelPlayerWeapons(pair)];
        } else {
            result = [cloneDuelPlayerWeapons(host), cloneDuelPlayerWeapons(opponent)];
        }
        if (lobby.loadout.weaponSelectionMode === "exclusive") {
            const left = new Set(result[0].weapons);
            if (result[1].weapons.some((weapon) => left.has(weapon))) {
                throw new DuelLobbyError("独占武器模式下双方不能选择相同武器");
            }
        }
        return result;
    }

    private snapshot(lobby: DuelLobby, member: DuelLobbyMember) {
        return {
            code: lobby.code,
            status: lobby.status,
            isHost: member.host,
            players: [
                ...lobby.members.map((player) => ({
                    name: player.name,
                    host: player.host,
                    ai: false,
                    self: player === member,
                    weapons: [...player.weapons] as [string, string],
                    throwables: { ...player.throwables },
                })),
                ...(lobby.loadout.aiEnabled
                    ? [{
                        name: `AI 对手（${this.aiDifficultyName(lobby.loadout.aiDifficulty)}）`,
                        host: false,
                        ai: true,
                        self: false,
                        weapons: [...lobby.members[0].weapons] as [string, string],
                        throwables: { ...lobby.members[0].throwables },
                    }]
                    : []),
            ],
            myWeapons: [...member.weapons] as [string, string],
            myThrowables: { ...member.throwables },
            loadout: this.cloneLoadout(lobby.loadout),
            canStart: member.host
                && lobby.status === "waiting"
                && !lobby.awaitingReturns
                && lobby.members.length === (lobby.loadout.aiEnabled ? 1 : 2),
            awaitingReturns: lobby.awaitingReturns,
            returnedCount: lobby.returnedMemberTokens.size,
            matchId: lobby.matchGameId ?? null,
            spectatorShareCode: lobby.spectatorShareCode ?? null,
            matchData: lobby.matchDataByMember.get(member.token) ?? null,
            catalog: getDuelWeaponCatalog(),
            throwableCatalog: getDuelThrowableCatalog(),
            revision: lobby.revision,
            updatedAt: lobby.updatedAt,
        };
    }

    private refreshMatchState(lobby: DuelLobby): void {
        if (lobby.status !== "playing" || !lobby.matchGameId) return;
        const game = this.getGame(lobby.matchGameId);
        if (game && !game.stopped) return;
        lobby.status = "waiting";
        lobby.matchGameId = undefined;
        lobby.spectatorShareCode = undefined;
        lobby.matchDataByMember.clear();
        lobby.awaitingReturns = true;
        lobby.returnedMemberTokens.clear();
        this.touch(lobby);
    }

    private assertEditable(lobby: DuelLobby): void {
        this.refreshMatchState(lobby);
        if (lobby.status !== "waiting" || lobby.awaitingReturns) {
            throw new DuelLobbyError("等待双方确认返回后再修改配置");
        }
    }

    private validateLoadout(value: unknown): DuelLobbyLoadout {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new DuelLobbyError("1v1装备配置无效");
        }
        const loadout = value as Partial<Record<keyof DuelLobbyLoadout, unknown>>;
        const weapons = this.validateWeapons(loadout.weapons);
        if (!isDuelWeaponSelectionMode(loadout.weaponSelectionMode)) {
            throw new DuelLobbyError("武器选择模式无效");
        }
        if (typeof loadout.adrenalineEnabled !== "boolean") throw new DuelLobbyError("激素开关配置无效");
        if (!isDuelBoost(loadout.boost)) throw new DuelLobbyError("初始肾上腺素必须是0到100的整数");
        if (!isDuelArmorLevel(loadout.helmetLevel)) throw new DuelLobbyError("头盔等级必须是0到3");
        if (!isDuelArmorLevel(loadout.chestLevel)) throw new DuelLobbyError("防弹衣等级必须是0到3");
        if (!isDuelScope(loadout.scope)) throw new DuelLobbyError("倍镜配置无效");
        if (!isDuelThrowables(loadout.throwables)) throw new DuelLobbyError("投掷物配置无效");
        if (typeof loadout.aiEnabled !== "boolean") throw new DuelLobbyError("AI 对手开关配置无效");
        if (!isDuelAiDifficulty(loadout.aiDifficulty)) throw new DuelLobbyError("AI 难度配置无效");
        return {
            weapons,
            weaponSelectionMode: loadout.weaponSelectionMode,
            adrenalineEnabled: loadout.adrenalineEnabled,
            boost: loadout.boost,
            helmetLevel: loadout.helmetLevel,
            chestLevel: loadout.chestLevel,
            scope: loadout.scope,
            throwables: normalizeDuelThrowables(loadout.throwables),
            aiEnabled: loadout.aiEnabled,
            aiDifficulty: loadout.aiDifficulty,
        };
    }

    private validateWeapons(value: unknown): [string, string] {
        if (!Array.isArray(value) || value.length !== 2 || !value.every(isDuelWeapon)) {
            throw new DuelLobbyError("请选择两把有效武器");
        }
        return [value[0], value[1]];
    }

    private validateExclusiveSelection(lobby: DuelLobby, allowIncomplete: boolean): void {
        if (lobby.loadout.aiEnabled || lobby.loadout.weaponSelectionMode !== "exclusive") return;
        const candidates: DuelPlayerWeapons[] = [...lobby.members];
        if (lobby.loadout.aiEnabled) candidates.push({ weapons: lobby.loadout.weapons });
        if (allowIncomplete && candidates.length < 2) return;
        if (candidates.length < 2) return;
        const first = new Set(candidates[0].weapons);
        if (candidates[1].weapons.some((weapon) => first.has(weapon))) {
            throw new DuelLobbyError("独占武器模式下双方不能选择相同武器");
        }
    }

    private defaultLoadout(): DuelLobbyLoadout {
        return {
            weapons: [...Config.duel.weapons],
            weaponSelectionMode: Config.duel.aiEnabled ? "mirrored" : "individual",
            adrenalineEnabled: Config.duel.adrenalineEnabled,
            boost: Config.duel.boost,
            helmetLevel: Config.duel.helmetLevel,
            chestLevel: Config.duel.chestLevel,
            scope: Config.duel.scope,
            throwables: { ...Config.duel.throwables },
            aiEnabled: Config.duel.aiEnabled,
            aiDifficulty: Config.duel.aiDifficulty,
        };
    }

    private cloneLoadout(loadout: DuelLobbyLoadout): DuelLobbyLoadout {
        return {
            ...loadout,
            weapons: [...loadout.weapons],
            throwables: { ...loadout.throwables },
        };
    }

    private isDefaultLoadout(
        lobby: DuelLobby,
        contestants: [DuelPlayerWeapons, DuelPlayerWeapons],
    ): boolean {
        const defaults = this.defaultLoadout();
        if (!lobby.loadout.aiEnabled) return false;
        if (lobby.loadout.adrenalineEnabled !== defaults.adrenalineEnabled) return false;
        if (lobby.loadout.boost !== defaults.boost) return false;
        if (lobby.loadout.helmetLevel !== defaults.helmetLevel) return false;
        if (lobby.loadout.chestLevel !== defaults.chestLevel) return false;
        if (lobby.loadout.scope !== defaults.scope) return false;
        const sameThrowables = Object.keys(defaults.throwables).every(
            (id) =>
                Number(lobby.loadout.throwables[id as keyof DuelThrowables] ?? 0)
                    === Number(defaults.throwables[id as keyof DuelThrowables] ?? 0),
        );
        if (!sameThrowables) return false;
        return contestants.every(
            (contestant) =>
                contestant.weapons[0] === defaults.weapons[0]
                && contestant.weapons[1] === defaults.weapons[1]
                && Object.keys(defaults.throwables).every(
                    (id) =>
                        Number(
                            contestant.throwables?.[
                                id as keyof typeof contestant.throwables
                            ] ?? 0,
                        )
                            === Number(defaults.throwables[id as keyof DuelThrowables] ?? 0),
                ),
        );
    }

    private touch(lobby: DuelLobby): void {
        lobby.revision += 1;
        lobby.updatedAt = Date.now();
    }

    private createMember(name: unknown, host: boolean, now: number): DuelLobbyMember {
        return {
            token: randomBytes(24).toString("hex"),
            name: this.normalizeName(name),
            host,
            joinedAt: now,
            lastSeenAt: now,
            weapons: [...Config.duel.weapons],
            throwables: { ...Config.duel.throwables },
        };
    }

    private requireLobby(code: unknown): DuelLobby {
        const normalized = String(code ?? "").trim().toUpperCase();
        const lobby = this.lobbies.get(normalized);
        if (!lobby) throw new DuelLobbyError("找不到这个1v1大厅");
        return lobby;
    }

    private requireMember(code: unknown, memberToken: unknown) {
        const lobby = this.requireLobby(code);
        const token = String(memberToken ?? "");
        const member = lobby.members.find((candidate) => candidate.token === token);
        if (!member) throw new DuelLobbyError("大厅身份已经失效，请重新加入");
        return { lobby, member };
    }

    private normalizeName(value: unknown): string {
        const clean = Array.from(String(value ?? "Player"), (character) => {
            const code = character.charCodeAt(0);
            return code <= 0x1f || code === 0x7f ? "" : character;
        }).join("").trim();
        return clean.slice(0, 16) || "Player";
    }

    private createCode(): string {
        for (let attempts = 0; attempts < 100; attempts++) {
            let code = "";
            const bytes = randomBytes(LOBBY_CODE_LENGTH);
            for (const value of bytes) code += LOBBY_CODE_ALPHABET[value % LOBBY_CODE_ALPHABET.length];
            if (!this.lobbies.has(code)) return code;
        }
        throw new DuelLobbyError("暂时无法生成大厅房间号，请重试");
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [code, lobby] of this.lobbies) {
            this.refreshMatchState(lobby);
            const ttl = lobby.status === "playing" ? ACTIVE_LOBBY_TTL : WAITING_LOBBY_TTL;
            if (now - lobby.updatedAt > ttl) {
                if (lobby.matchGameId) this.stopGame?.(lobby.matchGameId);
                this.lobbies.delete(code);
            }
        }
    }

    private aiDifficultyName(value: DuelAiDifficulty): string {
        return value === "forbidden"
            ? "HACKER"
            : value === "legit"
            ? "LEGIT"
            : value === "pro"
            ? "Pro"
            : value === "hard"
            ? "困难"
            : "普通";
    }
}
