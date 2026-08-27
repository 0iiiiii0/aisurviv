import type { AbstractMsg, BitStream } from "./net.ts";

export class DropItemMsg implements AbstractMsg {
    item = "";
    weapIdx = 0;
    /**
     * Optional short-lived loot owner used by server-controlled item sharing.
     * Normal clients leave this at zero; the server validates the recipient
     * before applying ownership.
     */
    recipientId = 0;

    serialize(s: BitStream) {
        s.writeGameType(this.item);
        s.writeUint8(this.weapIdx);
        s.writeBoolean(this.recipientId !== 0);
        if (this.recipientId !== 0) {
            s.writeUint16(this.recipientId);
        }
        s.writeBits(0, 5);
    }

    deserialize(s: BitStream) {
        this.item = s.readGameType();
        this.weapIdx = s.readUint8();
        this.recipientId = s.readBoolean() ? s.readUint16() : 0;
        s.readBits(5);
    }
}
