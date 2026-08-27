import type { AbstractMsg, BitStream } from "./net.ts";

export enum ArenaRoundState {
    Waiting,
    Playing,
    RoundOver,
    MatchOver,
}

export class ArenaRoundMsg implements AbstractMsg {
    round = 1;
    totalRounds = 1;
    state = ArenaRoundState.Waiting;
    winnerId = 0;
    playerIds = [0, 0];
    scores = [0, 0];

    serialize(s: BitStream): void {
        s.writeUint8(this.round);
        s.writeUint8(this.totalRounds);
        s.writeUint8(this.state);
        s.writeUint16(this.winnerId);
        for (let i = 0; i < 2; i++) {
            s.writeUint16(this.playerIds[i] ?? 0);
            s.writeUint8(this.scores[i] ?? 0);
        }
    }

    deserialize(s: BitStream): void {
        this.round = s.readUint8();
        this.totalRounds = s.readUint8();
        this.state = s.readUint8();
        this.winnerId = s.readUint16();
        for (let i = 0; i < 2; i++) {
            this.playerIds[i] = s.readUint16();
            this.scores[i] = s.readUint8();
        }
    }
}
