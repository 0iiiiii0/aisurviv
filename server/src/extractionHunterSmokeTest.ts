import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import { stashManager } from "./stash/stashManager.ts";

const previousHunters = { ...Config.extractionHunters };
const secretTestPlayers = ["HunterHuman", "DH"];

function prepareSecretPlayer(name: string): void {
    stashManager.removePlayer(name);
    stashManager.addItem(name, "m4a1", 1);
    stashManager.setLoadout(name, {
        guns: ["m4a1", ""],
        ammo: {},
        consumables: {},
        armor: {},
    });
}

void (async () => {
    try {
        Config.extractionSecret.enabled = true;
        Config.extractionHunters.normal = { solo: 3, duo: 2, squad: 5 };
        Config.extractionHunters.secret = { solo: 4, duo: 3, squad: 6 };

        const game = new Game(
            `extraction-hunter-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction_secret", teamMode: TeamMode.Solo },
            () => {},
            () => {},
        );
        await game.init();

        game.addJoinToken("hunter-human", false, 1, 60_000, false, false, undefined);
        prepareSecretPlayer("HunterHuman");
        const humanMsg = new net.JoinMsg();
        humanMsg.protocol = GameConfig.protocolVersion;
        humanMsg.matchPriv = "hunter-human";
        humanMsg.name = "HunterHuman";
        humanMsg.loadoutPriv = "HunterHuman";
        const human = game.playerBarn.addPlayer("hunter-h-sock", humanMsg);
        assert(human, "human joins");

        const botIds: number[] = [];
        for (let i = 0; i < 8; i++) {
            game.addJoinToken(
                `hunter-bot-${i}`,
                true,
                1,
                60_000,
                false,
                true,
                undefined,
            );
            const botMsg = new net.JoinMsg();
            botMsg.protocol = GameConfig.protocolVersion;
            botMsg.matchPriv = `hunter-bot-${i}`;
            botMsg.name = `HunterBot${i}`;
            const bot = game.playerBarn.addPlayer(`hunter-b-sock-${i}`, botMsg);
            assert(bot, "bot joins");
            botIds.push(bot.__id);
        }

        const ex = game.extraction() as unknown as {
            hunterBotIds: number[];
            update(dt: number): void;
        };
        // 跑约 1.3s 触发真人提示广播 + 猎手刷新。
        for (let i = 0; i < 40; i++) ex.update(1 / 30);

        assert.equal(
            ex.hunterBotIds.length,
            4,
            "secret mode must assign exactly the configured hunter cap",
        );
        assert.ok(
            ex.hunterBotIds.every((id) => botIds.includes(id)),
            "hunters must be real server bots",
        );

        // 猎手死亡：空位补给下一个 AI，且不再包含已死 AI。
        const deadHunter = ex.hunterBotIds[0];
        const deadObj = game.objectRegister.getById(deadHunter);
        assert(deadObj, "hunter object exists");
        (deadObj as unknown as {
            kill(params: unknown): void;
        }).kill({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        for (let i = 0; i < 40; i++) ex.update(1 / 30);
        assert.equal(
            ex.hunterBotIds.includes(deadHunter),
            false,
            "dead hunter must be removed from the hunter list",
        );
        assert.equal(
            ex.hunterBotIds.length,
            4,
            "the freed hunter slot must be filled by another AI",
        );

        // 消息回环：hunterBotIds + humans 序列化一致。
        const msg = new net.ExtractionHumanHintMsg();
        msg.humans = [{ id: human.__id, x: 100, y: 100, layer: 1 }];
        msg.hunterBotIds = [...ex.hunterBotIds];
        msg.battleOrders = [{
            botId: ex.hunterBotIds[0],
            targetHumanId: human.__id,
            role: net.ExtractionBattleRole.Suppressor,
            phase: net.ExtractionBattlePhase.Suppress,
            active: true,
            blindFire: true,
            underFireResponse: false,
            targetLayer: 1,
            objectiveLayer: 1,
            objectiveX: 95,
            objectiveY: 100,
            fireX: 100,
            fireY: 100,
            entryStructureId: 88,
            entryStairIndex: 0,
            clearObstacleId: 0,
            cycle: 1,
        }];
        const stream = new net.MsgStream(new ArrayBuffer(1024));
        stream.serializeMsg(net.MsgType.ExtractionHumanHint, msg);
        const buff = stream.getBuffer().slice();
        const stream2 = new net.MsgStream(buff.buffer);
        stream2.deserializeMsgType();
        const round = new net.ExtractionHumanHintMsg();
        round.deserialize(stream2.stream);
        assert.deepEqual(
            [...round.hunterBotIds].sort(),
            [...msg.hunterBotIds].sort(),
            "hunter ids must survive the wire",
        );
        assert.equal(round.humans[0]?.id, human.__id);
        assert.equal(round.humans[0]?.layer, 1);
        assert.deepEqual(round.battleOrders, msg.battleOrders);

        game.stop();

        // 双人模式用双人名额：验证按队伍模式分开计算。
        const duoGame = new Game(
            `extraction-hunter-duo-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction_secret", teamMode: TeamMode.Duo },
            () => {},
            () => {},
        );
        await duoGame.init();
        duoGame.addJoinToken("dh", false, 2, 60_000, false, false, undefined);
        prepareSecretPlayer("DH");
        const dhMsg = new net.JoinMsg();
        dhMsg.protocol = GameConfig.protocolVersion;
        dhMsg.matchPriv = "dh";
        dhMsg.name = "DH";
        dhMsg.loadoutPriv = "DH";
        duoGame.playerBarn.addPlayer("dh-sock", dhMsg);
        for (let i = 0; i < 8; i++) {
            duoGame.addJoinToken(`db-${i}`, true, 1, 60_000, false, true, undefined);
            const dbMsg = new net.JoinMsg();
            dbMsg.protocol = GameConfig.protocolVersion;
            dbMsg.matchPriv = `db-${i}`;
            dbMsg.name = `DB${i}`;
            duoGame.playerBarn.addPlayer(`db-sock-${i}`, dbMsg);
        }
        const duoEx = duoGame.extraction() as unknown as {
            hunterBotIds: number[];
            update(dt: number): void;
        };
        for (let i = 0; i < 40; i++) duoEx.update(1 / 30);
        assert.equal(
            duoEx.hunterBotIds.length,
            3,
            "duo extraction must use the duo hunter cap (secret.duo=3), not solo (4)",
        );
        duoGame.stop();

        // 普通模式用普通名额。
        Config.extractionSecret.enabled = false;
        const normalGame = new Game(
            `extraction-hunter-normal-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction", teamMode: TeamMode.Solo },
            () => {},
            () => {},
        );
        await normalGame.init();
        normalGame.addJoinToken("nh", false, 1, 60_000, false, false, undefined);
        const nhMsg = new net.JoinMsg();
        nhMsg.protocol = GameConfig.protocolVersion;
        nhMsg.matchPriv = "nh";
        nhMsg.name = "NH";
        normalGame.playerBarn.addPlayer("nh-sock", nhMsg);
        for (let i = 0; i < 8; i++) {
            normalGame.addJoinToken(
                `nb-${i}`,
                true,
                1,
                60_000,
                false,
                true,
                undefined,
            );
            const nbMsg = new net.JoinMsg();
            nbMsg.protocol = GameConfig.protocolVersion;
            nbMsg.matchPriv = `nb-${i}`;
            nbMsg.name = `NB${i}`;
            normalGame.playerBarn.addPlayer(`nb-sock-${i}`, nbMsg);
        }
        const normalEx = normalGame.extraction() as unknown as {
            hunterBotIds: number[];
            update(dt: number): void;
        };
        for (let i = 0; i < 40; i++) normalEx.update(1 / 30);
        assert.equal(
            normalEx.hunterBotIds.length,
            3,
            "normal extraction must use its own hunter cap",
        );
        normalGame.stop();

        console.log(
            "Extraction hunter smoke test passed: per-mode hunter cap, death frees slot for the next AI, wire round-trip.",
        );
    } finally {
        Config.extractionHunters = previousHunters;
        for (const name of secretTestPlayers) stashManager.removePlayer(name);
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
