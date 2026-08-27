import { v2, type Vec2 } from "../utils/v2.ts";
import type { AbstractMsg, BitStream } from "./net.ts";

/** Authoritative phases for the zombie-mode nuclear objective. */
export enum ZombieMissionPhase {
    Collecting,
    Armed,
    Countdown,
    Detonated,
}

/** Per-player snapshot for the zombie objective. */
export class ZombieMissionMsg implements AbstractMsg {
    phase = ZombieMissionPhase.Collecting;
    placedMask = 0;
    groundMask = 0;
    /** 0xff means this player is not carrying an element. */
    carriedElement = 0xff;
    devicePos: Vec2 = v2.create(0, 0);
    elementPositions: Vec2[] = [v2.create(0, 0), v2.create(0, 0), v2.create(0, 0)];
    /** Authoritative nuclear countdown remaining time, in milliseconds. */
    countdownMs = 0;
    inBunker = false;
    nukeSequence = 0;
    nukeKills = 0;

    serialize(s: BitStream): void {
        s.writeUint8(this.phase);
        s.writeUint8(this.placedMask & 0x7);
        s.writeUint8(this.groundMask & 0x7);
        s.writeUint8(this.carriedElement);
        s.writeVec(this.devicePos, 0, 0, 1024, 1024, 16);
        for (let i = 0; i < 3; i++) {
            s.writeVec(
                this.elementPositions[i] ?? v2.create(0, 0),
                0,
                0,
                1024,
                1024,
                16,
            );
        }
        // The mission countdown is 45 seconds, so uint8 tenths (25.5 seconds
        // maximum) silently truncated it. uint16 milliseconds covers the full
        // sequence while preserving exact millisecond snapshots.
        s.writeUint16(Math.max(0, Math.min(65535, Math.round(this.countdownMs))));
        s.writeBoolean(this.inBunker);
        s.writeUint8(this.nukeSequence);
        s.writeUint16(Math.max(0, Math.min(65535, this.nukeKills)));
        s.writeAlignToNextByte();
    }

    deserialize(s: BitStream): void {
        this.phase = s.readUint8() as ZombieMissionPhase;
        this.placedMask = s.readUint8() & 0x7;
        this.groundMask = s.readUint8() & 0x7;
        this.carriedElement = s.readUint8();
        this.devicePos = s.readVec(0, 0, 1024, 1024, 16);
        this.elementPositions = [];
        for (let i = 0; i < 3; i++) {
            this.elementPositions.push(s.readVec(0, 0, 1024, 1024, 16));
        }
        this.countdownMs = s.readUint16();
        this.inBunker = s.readBoolean();
        this.nukeSequence = s.readUint8();
        this.nukeKills = s.readUint16();
        s.readAlignToNextByte();
    }
}
