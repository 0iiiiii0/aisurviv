import type { AbstractMsg, BitStream } from "./net.ts";

export class AimTrainingStatsMsg implements AbstractMsg {
    shotsFired = 0;
    hits = 0;
    damageDealt = 0;
    distance = 0;
    targetBoost = 0;
    speedBonus = 0;
    infiniteMagazine = false;
    targetReady = false;
    weapon0 = "m4a1";
    weapon1 = "mk12";
    throwable = "frag";
    helmetLevel = 0;
    chestLevel = 0;
    normalHealth = false;
    verticalRandomMovement = true;
    omnidirectionalRandomMovement = false;
    dodgeBullets = false;

    serialize(s: BitStream) {
        s.writeUint32(this.shotsFired >>> 0);
        s.writeUint32(this.hits >>> 0);
        s.writeUint32(Math.max(0, Math.round(this.damageDealt * 10)) >>> 0);
        s.writeUint8(Math.max(0, Math.min(255, Math.round(this.distance))));
        s.writeUint8(Math.max(0, Math.min(100, Math.round(this.targetBoost))));
        s.writeUint16(Math.max(0, Math.min(65535, Math.round(this.speedBonus * 100))));
        s.writeUint8(this.infiniteMagazine ? 1 : 0);
        s.writeUint8(this.targetReady ? 1 : 0);
        s.writeGameType(this.weapon0);
        s.writeGameType(this.weapon1);
        s.writeGameType(this.throwable);
        s.writeBits(Math.max(0, Math.min(3, this.helmetLevel)), 2);
        s.writeBits(Math.max(0, Math.min(3, this.chestLevel)), 2);
        s.writeBoolean(this.normalHealth);
        s.writeBoolean(this.verticalRandomMovement);
        s.writeBoolean(this.omnidirectionalRandomMovement);
        s.writeBoolean(this.dodgeBullets);
        s.writeBits(0, 2);
    }

    deserialize(s: BitStream) {
        this.shotsFired = s.readUint32();
        this.hits = s.readUint32();
        this.damageDealt = s.readUint32() / 10;
        this.distance = s.readUint8();
        this.targetBoost = s.readUint8();
        this.speedBonus = s.readUint16() / 100;
        this.infiniteMagazine = s.readUint8() === 1;
        this.targetReady = s.readUint8() === 1;
        this.weapon0 = s.readGameType();
        this.weapon1 = s.readGameType();
        this.throwable = s.readGameType();
        this.helmetLevel = s.readBits(2);
        this.chestLevel = s.readBits(2);
        this.normalHealth = s.readBoolean();
        this.verticalRandomMovement = s.readBoolean();
        this.omnidirectionalRandomMovement = s.readBoolean();
        this.dodgeBullets = s.readBoolean();
        s.readBits(2);
    }
}
