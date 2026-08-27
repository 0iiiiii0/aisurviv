import { v2, type Vec2 } from "../utils/v2.ts";
import type { AbstractMsg, BitStream } from "./net.ts";

export enum SpectateAction {
    None,
    Begin,
    Next,
    Prev,
}

/** Maximum supported map coordinate for free-camera network updates. */
const FreeCameraMaxCoordinate = 4096;

export class SpectateMsg implements AbstractMsg {
    action: SpectateAction = SpectateAction.None;
    specBegin = false;
    specNext = false;
    specPrev = false;
    specForce = false;
    specFreeToggle = false;
    specFreeActive = false;
    specPlayersOnlySet = false;
    specPlayersOnly = false;
    freeCameraPos: Vec2 = v2.create(0, 0);
    freeCameraViewRadius = 64;
    freeCameraLayer = 0;

    serialize(s: BitStream) {
        s.writeUint8(this.action);
        s.writeBoolean(this.specBegin);
        s.writeBoolean(this.specNext);
        s.writeBoolean(this.specPrev);
        s.writeBoolean(this.specForce);
        s.writeBoolean(this.specFreeToggle);
        s.writeBoolean(this.specFreeActive);
        s.writeBoolean(this.specPlayersOnlySet);
        s.writeBoolean(this.specPlayersOnly);
        s.writeBits(Math.max(0, Math.min(3, this.freeCameraLayer)), 2);
        s.writeBits(0, 6);
        if (this.specFreeActive) {
            s.writeFloat(this.freeCameraPos.x, 0, FreeCameraMaxCoordinate, 16);
            s.writeFloat(this.freeCameraPos.y, 0, FreeCameraMaxCoordinate, 16);
            s.writeFloat(this.freeCameraViewRadius, 12, 180, 8);
        }
    }

    deserialize(s: BitStream) {
        this.action = s.readUint8();
        this.specBegin = s.readBoolean();
        this.specNext = s.readBoolean();
        this.specPrev = s.readBoolean();
        this.specForce = s.readBoolean();
        this.specFreeToggle = s.readBoolean();
        this.specFreeActive = s.readBoolean();
        this.specPlayersOnlySet = s.readBoolean();
        this.specPlayersOnly = s.readBoolean();
        this.freeCameraLayer = s.readBits(2);
        s.readBits(6);
        if (this.specFreeActive) {
            this.freeCameraPos = {
                x: s.readFloat(0, FreeCameraMaxCoordinate, 16),
                y: s.readFloat(0, FreeCameraMaxCoordinate, 16),
            };
            this.freeCameraViewRadius = s.readFloat(12, 180, 8);
        }
    }
}
