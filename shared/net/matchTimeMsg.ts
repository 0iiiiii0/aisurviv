import type { AbstractMsg, BitStream } from "./net.ts";

/**
 * Match time sync for time-limited modes (e.g. extraction's 10-minute cap).
 * Broadcast roughly once per second so clients can render a live countdown
 * without running their own authoritative clock.
 */
export class MatchTimeMsg implements AbstractMsg {
    /** Whether the match has started (false while still in the lobby). */
    started = false;
    /** Elapsed match time in seconds since the match started. */
    startedTime = 0;

    serialize(s: BitStream) {
        s.writeBoolean(this.started);
        s.writeFloat32(this.startedTime);
        s.writeAlignToNextByte();
    }

    deserialize(s: BitStream) {
        this.started = s.readBoolean();
        this.startedTime = s.readFloat32();
        s.readAlignToNextByte();
    }
}
