import assert from "node:assert/strict";
import fs from "node:fs";
import {
    GameConfig,
    TeamMode,
} from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { getServerDataFilePath } from "./config.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { ClientSocket } from "./game/socket.ts";
import type { Client } from "./game/client.ts";
import type { Player } from "./game/objects/player.ts";
import type { Loot } from "./game/objects/loot.ts";
import { stashManager } from "./stash/stashManager.ts";
/**
 * 真实绝密搜打撤对局冒烟测试：走完整的服务器管线验证"额外技能可以捡起"。
 *
 * 与直接调用 pickupLoot 的单元测试不同，这里：
 * 1. 用真实 Game（extraction_secret 地图）开局，真人凭仓库配装通过真实
 *    addJoinToken / addClientWithPlayer 入场（含绝密 A/S/S+ 配装校验与带入发放）；
 * 2. 技能以真实地面战利品形式由 lootBarn 刷出；
 * 3. 捡拾通过真实客户端输入包（InputMsg.inputs = [Input.Loot]）经
 *    handleMsg → handleInput → getClosestLoot → interactWith → pickupLoot 完成；
 * 4. 每步之后跑真实 update()/netSync() 帧，并用真实 WebSocket 出站字节流
 *    解析服务器的 PickupMsg 回执。
 */

class CapturingSocket extends ClientSocket<Client> {
    private closedState = false;
    closeReason?: string;
    override ip(): string {
        return "127.0.0.1";
    }
    override closed(): boolean {
        return this.closedState;
    }
    override send(_data: Uint8Array<ArrayBuffer>): void {
        // 出站字节流无需检查：回执通过 Client.sendMsg 拦截断言。
    }
    override close(reason?: string): void {
        this.closedState = true;
        this.closeReason = reason;
    }
}

interface PickupReply {
    item: string;
    result: net.PickupMsgType;
}

/**
 * 拦截真实 Client.sendMsg：pickupLoot 通过 client.sendMsg(Pickup, ...) 回执，
 * 这里记录全部 Pickup 回执用于端到端断言。
 */
function installPickupRecorder(client: Client): PickupReply[] {
    const replies: PickupReply[] = [];
    const original = client.sendMsg.bind(client);
    client.sendMsg = ((type: number, msg: net.AbstractMsg) => {
        if (type === net.MsgType.Pickup) {
            const pickup = msg as net.PickupMsg;
            replies.push({ item: String(pickup.item ?? ""), result: pickup.type });
        }
        original(type, msg);
    }) as typeof client.sendMsg;
    return replies;
}

const STASH_ID = "PerkRunner";
const BROUGHT_IN = ["steelskin", "windwalk"]; // 带入 2 个 → 可带出上限 3
const GROUND_PERKS = [
    "leadership",
    "splinter",
    "combat_stims",
    "small_arms",
    "ap_rounds",
];

const realStashFile = getServerDataFilePath("survivio-stash.json");
const stashBackupFile = getServerDataFilePath("survivio-secret-perk-test-backup.json");
if (fs.existsSync(realStashFile)) fs.copyFileSync(realStashFile, stashBackupFile);

function sendInteract(game: Game, player: Player): void {
    // 先推进一帧：让上一次拾取的 pickupTicker(0.1s) 自然衰减（dt≈0.125s）。
    advanceFrame(game);
    // 真实输入路径：序列化 InputMsg（inputs=[Input.Loot]）→ handleMsg。
    const input = new net.InputMsg();
    input.seq += 1;
    input.addInput(GameConfig.Input.Loot);
    input.useItem = "";
    const stream = new net.MsgStream(new ArrayBuffer(128));
    stream.serializeMsg(net.MsgType.Input, input);
    const raw = stream.getBuffer();
    const packet = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    game.clientBarn.handleMsg(packet, player.client.socket);
    // 推进真实帧：世界状态更新，并经 netSync 把 PickupMsg 真正写进玩家 socket。
    advanceFrame(game);
    game.netSync();
}

function advanceFrame(game: Game): void {
    (game as unknown as { now: number }).now = performance.now() - 125;
    game.update();
}

void (async () => {
    try {
        // ---------- 准备仓库配装（绝密入场资格：A/S/S+ 主武器 + 带入技能） ----------
        stashManager.removePlayer(STASH_ID);
        assert.equal(stashManager.addItem(STASH_ID, "vector", 1).ok, true);
        assert.equal(stashManager.addItem(STASH_ID, "steelskin", 1).ok, true);
        assert.equal(stashManager.addItem(STASH_ID, "windwalk", 1).ok, true);
        const saved = stashManager.setLoadout(STASH_ID, {
            guns: ["vector", ""],
            ammo: {},
            consumables: {},
            throwables: {},
            armor: {},
            perks: BROUGHT_IN,
        });
        assert.equal(saved.ok, true, `stash loadout must save: ${saved.reason ?? ""}`);
        assert.deepEqual(saved.loadout?.perks, BROUGHT_IN);

        // ---------- 开局：真实绝密搜打撤对局 ----------
        const game = new Game(`secret-live-${Math.random().toString(36).slice(2)}`, {
            mapName: "extraction_secret",
            teamMode: TeamMode.Solo,
        });
        assert.equal(game.extractionSecretEnabled, true, "secret mode must be active");

        game.addJoinToken("runner-token", false, 1, 60_000, false, false, undefined);
        const tokenData = game.joinTokens.get("runner-token")?.data as JoinTokenData;
        const joinMsg = new net.JoinMsg();
        joinMsg.protocol = GameConfig.protocolVersion;
        joinMsg.joinToken = "runner-token";
        joinMsg.matchPriv = "runner-token";
        joinMsg.name = STASH_ID;
        joinMsg.loadoutPriv = STASH_ID;
        const socket = new CapturingSocket();
        const client = game.clientBarn.addClientWithPlayer(socket, tokenData, joinMsg, "runner-token");
        const human = client?.player;
        const pickupReplies = installPickupRecorder(client!);
        assert(human, "runner must pass the secret-extraction eligibility gate and join");
        assert.equal(human.dead, false);

        // 游戏随真人在场自动开局（extractionMode 的 isGameStarted 规则）。
        advanceFrame(game);
        assert.equal((game as unknown as { started: boolean }).started, true, "match auto-starts with the human");

        // ---------- 带入发放：2 个带入技能已生效 ----------
        assert.deepEqual(
            human.broughtInPerks.filter((type) => BROUGHT_IN.includes(type)),
            BROUGHT_IN,
            "brought-in perks recorded at spawn",
        );
        assert.ok(human.perks.some((perk) => perk.type === "steelskin"), "steelskin granted");
        assert.ok(human.perks.some((perk) => perk.type === "windwalk"), "windwalk granted");
        assert.equal(
            human.perkCarryOutCap,
            3,
            "bring 2 perks -> carry-out cap 3 (2 + 1 extra slot)",
        );

        // ---------- 地面刷出额外技能（真实战利品） ----------
        // 以玩家出生点为锚（保证不被随机地图障碍物压住），沿 x 轴排开。
        const anchor = v2.copy(human.pos);
        const placedLoot: Array<{ type: string; get(): Loot }> = [];
        for (let i = 0; i < GROUND_PERKS.length; i++) {
            const type = GROUND_PERKS[i]!;
            game.lootBarn.addLoot(type, v2.add(anchor, v2.create(4 + i * 2, 0)), 0, 1);
        }
        for (const type of GROUND_PERKS) {
            const loot = [...game.lootBarn.loots].reverse().find(
                (candidate) => candidate.type === type && !candidate.destroyed,
            );
            assert(loot, `${type} must spawn as ground loot`);
            placedLoot.push({ type, get: () => loot });
        }

        // ---------- 捡起第 1、2 个额外技能：填满可带出上限 ----------
        let pickedExtra = 0;
        for (let i = 0; i < 2; i++) {
            const loot = placedLoot[i]!.get();
            human.pos = v2.add(loot.pos, v2.create(0.5, 0)); // 走到技能旁边
            sendInteract(game, human);
            const replies = pickupReplies.splice(0);
            assert.equal(loot.destroyed, true, `${loot.type}: ground perk is consumed by pickup`);
            assert.ok(
                replies.some((reply) => reply.item === loot.type && reply.result === net.PickupMsgType.Success),
                `${loot.type}: server must answer PickupMsg Success`,
            );
            assert.ok(human.hasPerk(loot.type), `${loot.type}: perk is now equipped`);
            pickedExtra++;
        }
        assert.equal(pickedExtra, 2, "both extra perks picked up");
        assert.equal(human.perks.length, human.perkCarryOutCap, "slots filled exactly to carry-out cap");

        // ---------- 第 3 个：满槽后仍能捡 —— 替换局内捡的可掉落技能 ----------
        const beforeTypes = human.perks.map((perk) => perk.type);
        const replaceable = beforeTypes.find(
            (type) => !BROUGHT_IN.includes(type),
        );
        assert.ok(replaceable, "a picked-up (droppable) perk must exist for replacement");
        const thirdLoot = placedLoot[2]!.get();
        human.pos = v2.add(thirdLoot.pos, v2.create(0.5, 0));
        sendInteract(game, human);
        const thirdReplies = pickupReplies.splice(0);
        assert.equal(thirdLoot.destroyed, true, "pickup at full slots still consumes the new perk");
        assert.ok(
            thirdReplies.some((reply) => reply.result === net.PickupMsgType.Success),
            "replacement pickup succeeds instead of being rejected",
        );
        assert.ok(human.hasPerk(thirdLoot.type), "the new perk is equipped after replacement");
        assert.equal(
            human.hasPerk(replaceable),
            false,
            "the replaced droppable perk leaves the loadout",
        );
        assert.ok(
            human.perks.every((perk) => !(perk.type === replaceable)),
            "replaced perk removed",
        );
        // 被替换的旧能力作为战利品掉回地上（可给队友再捡）。
        assert.ok(
            game.lootBarn.loots.some((loot) => loot.type === replaceable && !loot.destroyed),
            "replaced perk is dropped back to the ground",
        );

        // ---------- 带入技能保护：替换永不牺牲带入技能 ----------
        for (const brought of BROUGHT_IN) {
            assert.ok(
                human.perks.some((perk) => perk.type === brought),
                `brought-in perk ${brought} must survive replacement`,
            );
        }

        // ---------- 重复拾取同类技能：AlreadyEquipped，不占用新槽 ----------
        game.lootBarn.addLoot(thirdLoot.type, v2.create(human.pos.x + 1, human.pos.y), 0, 1);
        const dupLoot = [...game.lootBarn.loots].reverse().find(
            (candidate) => candidate.type === thirdLoot.type && !candidate.destroyed,
        );
        assert(dupLoot, "duplicate perk loot must spawn");
        sendInteract(game, human);
        const dupReplies = pickupReplies.splice(0);
        assert.ok(
            dupReplies.some((reply) => reply.result === net.PickupMsgType.AlreadyEquipped),
            "duplicate perk answers AlreadyEquipped",
        );
        // 已装备同类时：原物件被弹回地面（销毁旧引用、原地掉落新副本），
        // 玩家不会重复获得该技能。
        assert.ok(
            game.lootBarn.loots.some(
                (candidate) => candidate.type === thirdLoot.type && !candidate.destroyed,
            ),
            "duplicate perk bounces back to the ground",
        );

        // ---------- 局内捡的技能计入可带出集合（撤离结算口径） ----------
        assert.ok(
            human.broughtInPerks.includes(thirdLoot.type),
            "in-match picked perks are recorded for extraction carry-out",
        );
        assert.ok(
            !human.broughtInPerks.includes(replaceable!),
            "the replaced-out perk is no longer carried",
        );

        game.stop();

        console.log(
            "Secret extraction LIVE match smoke test passed: extra ground perks are picked up through real input packets "
                + `(2 fills + 1 replacement at cap ${human.perkCarryOutCap}), brought-in perks preserved, `
                + "duplicate pickup rejected, and server PickupMsg replies verified end-to-end.",
        );
    } finally {
        stashManager.removePlayer(STASH_ID);
        try {
            if (fs.existsSync(stashBackupFile)) {
                fs.copyFileSync(stashBackupFile, realStashFile);
            }
            fs.rmSync(stashBackupFile, { force: true });
        } catch {
            // 恢复失败不掩盖测试结果。
        }
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});