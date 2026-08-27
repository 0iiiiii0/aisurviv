import type { TeamMode } from "../gameConfig.ts";
import type { AbstractMsg, BitStream } from "./net.ts";

export class JoinedMsg implements AbstractMsg {
    teamMode!: TeamMode;
    playerId = 0;
    started = false;
    /** True only for a credential created as a dedicated room observer. */
    spectatorOnly = false;
    /** True only for the server-controlled moving target in aim training. */
    trainingTarget = false;
    emotes: string[] = [];

    serialize(s: BitStream) {
        /* STRIP_FROM_PROD_CLIENT:START */
        s.writeUint8(this.teamMode);
        s.writeUint16(this.playerId);
        s.writeBoolean(this.started);
        s.writeBoolean(this.spectatorOnly);
        s.writeBoolean(this.trainingTarget);
        s.writeArray(this.emotes, 8, (emote) => {
            s.writeGameType(emote);
        });
        /* STRIP_FROM_PROD_CLIENT:END */
    }

    deserialize(s: BitStream) {
        this.teamMode = s.readUint8();
        this.playerId = s.readUint16();
        this.started = s.readBoolean();
        this.spectatorOnly = s.readBoolean();
        this.trainingTarget = s.readBoolean();
        this.emotes = s.readArray(8, () => {
            return s.readGameType();
        });
    }
}
