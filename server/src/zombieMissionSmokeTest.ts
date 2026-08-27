import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import {
    ZOMBIE_MISSION_CARRY_SPEED_MULT,
    ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC,
    ZOMBIE_MISSION_ELEMENT_NAMES,
} from "../../shared/defs/zombieDefs.ts";
import { Config } from "./config.ts";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Client } from "./game/client.ts";
import { qualifiesForZombieNuclearAchievement } from "./game/zombieMode.ts";
import type { Player } from "./game/objects/player.ts";
import { ClientSocket } from "./game/socket.ts";

const previousInitialCount = Config.zombie.initialCount;
const useRealPersistence = Boolean(process.env.SURVIV_DATA_DIR?.trim());
const sentMessages = new WeakMap<Player, ArrayBuffer[]>();

class CapturingSocket extends ClientSocket<Client> {
    readonly sent: ArrayBuffer[] = [];
    private isClosed = false;

    ip(): string {
        return "127.0.0.1";
    }

    closed(): boolean {
        return this.isClosed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        this.sent.push(data.slice().buffer);
    }

    close(): void {
        this.isClosed = true;
    }
}

function joinHuman(game: Game, name: string, account = ""): Player {
    const joinToken = `zombie-mission-${name}-${Date.now()}-${Math.random()}`;
    game.addJoinTokens([{
        joinToken,
        userId: null,
        stashName: account || undefined,
        ip: "127.0.0.1",
    }], true);
    const joinTokenEntry = game.joinTokens.get(joinToken);
    assert.equal(joinTokenEntry?.type, "join", "matchmaking created a join token");
    if (!joinTokenEntry || joinTokenEntry.type !== "join") {
        throw new Error("failed to create zombie mission join token");
    }

    const join = new net.JoinMsg();
    join.protocol = GameConfig.protocolVersion;
    join.matchPriv = joinToken;
    join.name = name;
    // Simulate a client that does not repeat account identity in JoinMsg. The
    // server must rely on the legacy token profile resolved during matchmaking.
    join.loadoutPriv = "";
    const socket = new CapturingSocket();
    game.clientBarn.addClientWithPlayer(socket, joinTokenEntry.data, join, joinToken);
    const player = socket.getUserData()?.player;
    assert.ok(player, `player ${name} joined through the real client path`);
    sentMessages.set(player, socket.sent);
    return player;
}

void (async () => {
    Config.zombie.initialCount = 3;
    assert.deepEqual(
        [...ZOMBIE_MISSION_ELEMENT_NAMES],
        ["铀", "钚", "氚"],
        "three mission elements use the configured nuclear-material names",
    );
    assert.equal(
        qualifiesForZombieNuclearAchievement("hard", TeamMode.Solo),
        true,
        "solo hard qualifies for the nuclear achievement",
    );
    assert.equal(
        qualifiesForZombieNuclearAchievement("hard", TeamMode.Duo),
        false,
        "duo hard does not qualify for the nuclear achievement",
    );
    assert.equal(
        qualifiesForZombieNuclearAchievement("hard", TeamMode.Squad),
        false,
        "squad hard does not qualify for the nuclear achievement",
    );
    assert.equal(
        qualifiesForZombieNuclearAchievement("normal", TeamMode.Solo),
        false,
        "solo normal does not qualify for the nuclear achievement",
    );
    const originalGrantAchievement = stashManager.grantAchievement.bind(stashManager);
    const achievementAwards: Array<{ name: string; id: string }> = [];
    (stashManager as unknown as {
        grantAchievement(name: string, id: typeof AchievementIds.ZombieNuclearHard): {
            ok: boolean;
            awarded: boolean;
            achievements: typeof AchievementIds.ZombieNuclearHard[];
        };
    }).grantAchievement = useRealPersistence
        ? originalGrantAchievement
        : (name, id) => {
            achievementAwards.push({ name, id });
            return { ok: true, awarded: true, achievements: [id] };
        };
    const game = new Game(
        `zombie-mission-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "hard" },
    );
    const human = joinHuman(game, "MissionHuman", "MissionAccount");
    const runner = joinHuman(game, "MissionRunner");
    const shelteredGuest = joinHuman(game, "MissionGuest");
    assert.equal(human.accountAuthenticated, true, "matchmaking stash identity authenticates player");
    assert.equal(human.stashName, "MissionAccount", "authoritative stash identity reaches game");
    assert.equal(runner.accountAuthenticated, false, "guest remains unauthenticated");
    assert.equal(shelteredGuest.accountAuthenticated, false, "sheltered guest is unauthenticated");
    game.started = true;
    const system = game.zombieMode!;

    try {
        const snapshot = system.missionSnapshot;
        assert.equal(snapshot.elements.length, 3, "exactly three elements");
        const allPoints = [snapshot.devicePos, ...snapshot.elements.map((e) => e.pos)];
        for (const point of allPoints) {
            assert.equal(game.map.isOnWater(point, 0), false, "mission point is on land");
            assert.ok(point.x >= 2 && point.x <= game.map.width - 2, "point x in bounds");
            assert.ok(point.y >= 2 && point.y <= game.map.height - 2, "point y in bounds");
            assert.ok(game.map.isPlayerWalkableAt(point, 0, 0.7), "point has player-clear collision space");
            assert.equal(system.isMissionPointReachable(point), true, "point is reachable from device");
        }
        for (let i = 0; i < 3; i++) {
            for (let j = i + 1; j < 3; j++) {
                assert.ok(
                    Math.hypot(
                        snapshot.elements[i].pos.x - snapshot.elements[j].pos.x,
                        snapshot.elements[i].pos.y - snapshot.elements[j].pos.y,
                    ) >= 48,
                    "element spawn points are separated",
                );
            }
        }

        for (let i = 0; i < 3; i++) {
            const element = system.missionSnapshot.elements[i];
            human.pos.x = element.pos.x;
            human.pos.y = element.pos.y;
            human.layer = 0;
            human.recalculateSpeed();
            const normalBase = human.speed;
            assert.equal(system.tryInteractMission(human), true, `pickup element ${i}`);
            assert.equal(human.zombieMissionCarriedElement, i, "only one element carried");
            human.recalculateSpeed();
            assert.ok(
                Math.abs(human.speed - normalBase * ZOMBIE_MISSION_CARRY_SPEED_MULT) < 0.01,
                "carrier speed is 85%",
            );

            const another = system.missionSnapshot.elements[(i + 1) % 3];
            if (!another.placed) {
                human.pos.x = another.pos.x;
                human.pos.y = another.pos.y;
                system.tryInteractMission(human);
                assert.equal(human.zombieMissionCarriedElement, i, "cannot carry a second element");
            }

            human.pos.x = system.missionSnapshot.devicePos.x;
            human.pos.y = system.missionSnapshot.devicePos.y;
            assert.equal(system.tryInteractMission(human), true, `place element ${i}`);
            assert.equal(human.zombieMissionCarriedElement, -1, "carry cleared after placement");
        }
        assert.equal(system.missionSnapshot.phase, net.ZombieMissionPhase.Countdown);
        assert.equal(system.matchTimerPaused, true, "timer pauses after all placements");

        const beforeTime = game.startedTime;
        (game as unknown as { now: number }).now = Date.now() - 1000;
        game.update();
        assert.equal(game.startedTime, beforeTime, "authoritative timer remains frozen");

        // Activation starts an irreversible 45-second countdown without
        // requiring anyone to enter a bunker.
        const countdownEndsAt = (system as unknown as {
            shelterCountdownEndsAt: number;
        }).shelterCountdownEndsAt;
        assert.ok(
            countdownEndsAt - Date.now() >
                (ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC - 1) * 1000,
            "activation grants the full 45-second evacuation window",
        );
        (system as unknown as { updateMission(now: number): void }).updateMission(
            countdownEndsAt - 1,
        );
        assert.equal(system.missionSnapshot.phase, net.ZombieMissionPhase.Countdown);
        human.layer = 1;
        runner.layer = 0;
        shelteredGuest.layer = 1;
        const groundObstacle = game.map.obstacles.find(
            (obstacle) => obstacle.destructible && !obstacle.dead && obstacle.layer === 0,
        );
        assert.ok(groundObstacle, "test map has a destructible ground obstacle");
        (system as unknown as { updateMission(now: number): void }).updateMission(
            countdownEndsAt + 1,
        );
        assert.equal(system.missionSnapshot.phase, net.ZombieMissionPhase.Detonated);
        assert.ok(system.missionSnapshot.nukeKills > 0, "nuclear blast reports zombie kills");
        assert.equal(human.dead, false, "player still in bunker survives");
        if (useRealPersistence) {
            assert.equal(
                stashManager.hasAchievement(
                    "MissionAccount",
                    AchievementIds.ZombieNuclearHard,
                ),
                true,
                "hard-mode achievement is persisted to the isolated stash file",
            );
            assert.equal(
                stashManager.hasAchievement(
                    "MissionGuest",
                    AchievementIds.ZombieNuclearHard,
                ),
                false,
                "sheltered guest does not receive a persistent achievement",
            );
        } else {
            assert.deepEqual(achievementAwards, [
                {
                    name: "MissionAccount",
                    id: AchievementIds.ZombieNuclearHard,
                },
            ], "hard-mode bunker survivor receives the nuclear achievement");
        }
        assert.equal(
            sentMessages.get(human)?.some((buffer) => {
                const stream = new net.MsgStream(buffer);
                if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
                    return false;
                }
                const unlocked = new net.AchievementUnlockedMsg();
                unlocked.deserialize(stream.stream);
                return unlocked.achievementId === AchievementIds.ZombieNuclearHard;
            }),
            true,
            "network client receives the achievement unlock notification",
        );
        assert.equal(runner.dead, true, "player who left the bunker is killed");
        assert.equal(shelteredGuest.dead, false, "guest in bunker still survives without an award");
        assert.ok(human.kills > 0, "sheltered player receives zombie kill credit");
        assert.equal(groundObstacle.dead, true, "nuclear blast destroys ground obstacles");

        const changedSeedGame = new Game(
            `zombie-mission-seed-${Date.now()}`,
            { mapName: "zombie", teamMode: TeamMode.Solo },
        );
        try {
            const other = changedSeedGame.zombieMode!.missionSnapshot;
            assert.notDeepEqual(
                other.elements.map((element) => element.pos),
                snapshot.elements.map((element) => element.pos),
                "different map seeds produce different element positions",
            );
        } finally {
            changedSeedGame.stop();
        }

        console.log("✓ zombie mission: seeded safe points, one-item carry at 85%, automatic 45s bunker nuke and kill feedback");
    } finally {
        (stashManager as unknown as { grantAchievement: typeof originalGrantAchievement })
            .grantAchievement = originalGrantAchievement;
        game.stop();
        Config.zombie.initialCount = previousInitialCount;
    }
})();
