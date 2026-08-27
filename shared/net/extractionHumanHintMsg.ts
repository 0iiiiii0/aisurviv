import type { AbstractMsg, BitStream } from "./net.ts";

export enum ExtractionBattleRole {
    Reserve = 0,
    Suppressor = 1,
    Breacher = 2,
    Flanker = 3,
    RearCutoff = 4,
    Clearer = 5,
}

export enum ExtractionBattlePhase {
    Assemble = 0,
    Suppress = 1,
    Breach = 2,
    Sweep = 3,
    Recover = 4,
}

/** A server-authoritative, bot-specific order from the match commander. */
export interface ExtractionBattleOrder {
    botId: number;
    targetHumanId: number;
    role: ExtractionBattleRole;
    phase: ExtractionBattlePhase;
    active: boolean;
    blindFire: boolean;
    underFireResponse: boolean;
    targetLayer: number;
    objectiveLayer: number;
    objectiveX: number;
    objectiveY: number;
    fireX: number;
    fireY: number;
    entryStructureId: number;
    entryStairIndex: number;
    clearObstacleId: number;
    cycle: number;
}

/**
 * 搜打撤真人位置提示（只发给 serverBot，浏览器玩家不接收）。
 * 服务端每秒广播一次存活真人的世界坐标，让 AI 知道玩家大概位置并前往
 * 追杀/合围，而不是全程捡物资。AI 仍用导航寻路，实际视野接触仍优先。
 */
export class ExtractionHumanHintMsg implements AbstractMsg {
    /** 真人玩家 id -> 世界坐标。 */
    humans: Array<{ id: number; x: number; y: number; layer: number }> = [];
    /** 旧追猎名额/中央计划先锋列表；中央命令可继续动员其余同阵营 AI。 */
    hunterBotIds: number[] = [];
    /** 绝密模式整场中央指挥器的个人化作战命令。 */
    battleOrders: ExtractionBattleOrder[] = [];

    serialize(s: BitStream) {
        s.writeUint8(Math.min(32, this.humans.length));
        for (const human of this.humans) {
            s.writeUint16(human.id);
            s.writeFloat32(human.x);
            s.writeFloat32(human.y);
            s.writeUint8(human.layer & 0xff);
        }
        s.writeUint8(Math.min(64, this.hunterBotIds.length));
        for (const id of this.hunterBotIds) {
            s.writeUint16(id);
        }
        s.writeUint8(Math.min(64, this.battleOrders.length));
        for (const order of this.battleOrders) {
            s.writeUint16(order.botId);
            s.writeUint16(order.targetHumanId);
            s.writeUint8(order.role);
            s.writeUint8(order.phase);
            s.writeUint8(
                Number(order.active)
                    | (Number(order.blindFire) << 1)
                    | (Number(order.underFireResponse) << 2),
            );
            s.writeUint8(order.targetLayer & 0xff);
            s.writeUint8(order.objectiveLayer & 0xff);
            s.writeFloat32(order.objectiveX);
            s.writeFloat32(order.objectiveY);
            s.writeFloat32(order.fireX);
            s.writeFloat32(order.fireY);
            s.writeUint16(order.entryStructureId);
            s.writeUint8(order.entryStairIndex);
            s.writeUint16(order.clearObstacleId);
            s.writeUint8(order.cycle & 0xff);
        }
        s.writeAlignToNextByte();
    }

    deserialize(s: BitStream) {
        const count = s.readUint8();
        this.humans = [];
        for (let i = 0; i < count; i++) {
            this.humans.push({
                id: s.readUint16(),
                x: s.readFloat32(),
                y: s.readFloat32(),
                layer: s.readUint8(),
            });
        }
        const hunterCount = s.readUint8();
        this.hunterBotIds = [];
        for (let i = 0; i < hunterCount; i++) {
            this.hunterBotIds.push(s.readUint16());
        }
        const orderCount = s.readUint8();
        this.battleOrders = [];
        for (let i = 0; i < orderCount; i++) {
            const botId = s.readUint16();
            const targetHumanId = s.readUint16();
            const role = s.readUint8() as ExtractionBattleRole;
            const phase = s.readUint8() as ExtractionBattlePhase;
            const flags = s.readUint8();
            this.battleOrders.push({
                botId,
                targetHumanId,
                role,
                phase,
                active: Boolean(flags & 0x1),
                blindFire: Boolean(flags & 0x2),
                underFireResponse: Boolean(flags & 0x4),
                targetLayer: s.readUint8(),
                objectiveLayer: s.readUint8(),
                objectiveX: s.readFloat32(),
                objectiveY: s.readFloat32(),
                fireX: s.readFloat32(),
                fireY: s.readFloat32(),
                entryStructureId: s.readUint16(),
                entryStairIndex: s.readUint8(),
                clearObstacleId: s.readUint16(),
                cycle: s.readUint8(),
            });
        }
        s.readAlignToNextByte();
    }
}
