import type { AbstractMsg, BitStream } from "./net.ts";

/**
 * Authoritative extraction point + hold progress for the receiving player.
 * The active point is assigned once at spawn (per player, or per squad) and
 * never changes during the match, so players can actually reach it.
 */
export class ExtractionPointMsg implements AbstractMsg {
    pointIndex = 0;
    /** Authoritative seconds the player has been standing in the zone (0..5). */
    holdSeconds = 0;

    serialize(s: BitStream) {
        s.writeUint8(this.pointIndex);
        s.writeUint8(Math.max(0, Math.min(255, Math.round(this.holdSeconds * 2))));
        s.writeAlignToNextByte();
    }

    deserialize(s: BitStream) {
        this.pointIndex = s.readUint8();
        this.holdSeconds = s.readUint8() / 2;
        s.readAlignToNextByte();
    }
}
