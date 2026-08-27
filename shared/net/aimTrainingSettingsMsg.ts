import type { AbstractMsg, BitStream } from "./net.ts";

/**
 * Live aim-range controls sent by the human trainee. The server normalizes
 * every field before applying it, so this message never acts as trusted state.
 */
export class AimTrainingSettingsMsg implements AbstractMsg {
    weapon0 = "m4a1";
    weapon1 = "mk12";
    throwable = "frag";
    infiniteMagazine = false;
    targetBoost = 0;
    helmetLevel = 0;
    chestLevel = 0;
    normalHealth = false;
    distance = 60;
    verticalRandomMovement = true;
    omnidirectionalRandomMovement = false;
    dodgeBullets = false;
    resetStats = false;

    serialize(s: BitStream) {
        s.writeGameType(this.weapon0);
        s.writeGameType(this.weapon1);
        s.writeGameType(this.throwable);
        s.writeBoolean(this.infiniteMagazine);
        s.writeUint8(Math.max(0, Math.min(100, Math.round(this.targetBoost))));
        s.writeBits(Math.max(0, Math.min(3, Math.round(this.helmetLevel))), 2);
        s.writeBits(Math.max(0, Math.min(3, Math.round(this.chestLevel))), 2);
        s.writeBoolean(this.normalHealth);
        s.writeUint8(Math.max(0, Math.min(255, Math.round(this.distance))));
        s.writeBoolean(this.verticalRandomMovement);
        s.writeBoolean(this.omnidirectionalRandomMovement);
        s.writeBoolean(this.dodgeBullets);
        s.writeBoolean(this.resetStats);
    }

    deserialize(s: BitStream) {
        this.weapon0 = s.readGameType();
        this.weapon1 = s.readGameType();
        this.throwable = s.readGameType();
        this.infiniteMagazine = s.readBoolean();
        this.targetBoost = s.readUint8();
        this.helmetLevel = s.readBits(2);
        this.chestLevel = s.readBits(2);
        this.normalHealth = s.readBoolean();
        this.distance = s.readUint8();
        this.verticalRandomMovement = s.readBoolean();
        this.omnidirectionalRandomMovement = s.readBoolean();
        this.dodgeBullets = s.readBoolean();
        this.resetStats = s.readBoolean();
    }
}
