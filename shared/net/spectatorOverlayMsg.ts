import type { Vec2 } from "../utils/v2.ts";
import type { AbstractMsg, BitStream } from "./net.ts";

const MAX_COORDINATE = 4096;

export interface SpectatorOverlayEntry {
    playerId: number;
    pos: Vec2;
    health: number;
    weapon: string;
    layer: number;
    dead: boolean;
    downed: boolean;
}

/** Full-world contestant data sent only to spectator-only connections. */
export class SpectatorOverlayMsg implements AbstractMsg {
    players: SpectatorOverlayEntry[] = [];

    serialize(s: BitStream): void {
        s.writeUint8(Math.min(255, this.players.length));
        for (const player of this.players.slice(0, 255)) {
            s.writeUint16(player.playerId);
            s.writeFloat(player.pos.x, 0, MAX_COORDINATE, 16);
            s.writeFloat(player.pos.y, 0, MAX_COORDINATE, 16);
            s.writeFloat(Math.max(0, Math.min(100, player.health)), 0, 100, 8);
            s.writeGameType(player.weapon || "fists");
            s.writeBits(Math.max(0, Math.min(3, player.layer)), 2);
            s.writeBoolean(player.dead);
            s.writeBoolean(player.downed);
            s.writeBits(0, 2);
        }
    }

    deserialize(s: BitStream): void {
        const count = s.readUint8();
        this.players = [];
        for (let index = 0; index < count; index++) {
            this.players.push({
                playerId: s.readUint16(),
                pos: {
                    x: s.readFloat(0, MAX_COORDINATE, 16),
                    y: s.readFloat(0, MAX_COORDINATE, 16),
                },
                health: s.readFloat(0, 100, 8),
                weapon: s.readGameType(),
                layer: s.readBits(2),
                dead: s.readBoolean(),
                downed: s.readBoolean(),
            });
            s.readBits(2);
        }
    }
}
