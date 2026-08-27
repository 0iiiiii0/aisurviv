import type { AbstractMsg, BitStream } from "./net.ts";

export const SPECTATOR_CHAT_MAX_BYTES = 180;

function truncateUtf8(value: string, maxBytes: number): Uint8Array {
    const encoder = new TextEncoder();
    let bytes = encoder.encode(value);
    if (bytes.length <= maxBytes) return bytes;
    let end = value.length;
    while (end > 0) {
        bytes = encoder.encode(value.slice(0, end));
        if (bytes.length <= maxBytes) return bytes;
        end--;
    }
    return new Uint8Array();
}

export class SpectatorChatMsg implements AbstractMsg {
    /** false when sent by a spectator; true when delivered by the server. */
    delivered = false;
    sender = "";
    text = "";

    serialize(s: BitStream): void {
        s.writeBoolean(this.delivered);
        s.writeBits(0, 7);
        const sender = truncateUtf8(this.sender, 48);
        const text = truncateUtf8(this.text, SPECTATOR_CHAT_MAX_BYTES);
        s.writeUint8(sender.length);
        for (const byte of sender) s.writeUint8(byte);
        s.writeUint8(text.length);
        for (const byte of text) s.writeUint8(byte);
    }

    deserialize(s: BitStream): void {
        this.delivered = s.readBoolean();
        s.readBits(7);
        const senderLength = s.readUint8();
        const sender = new Uint8Array(senderLength);
        for (let index = 0; index < senderLength; index++) sender[index] = s.readUint8();
        const textLength = s.readUint8();
        const text = new Uint8Array(textLength);
        for (let index = 0; index < textLength; index++) text[index] = s.readUint8();
        this.sender = new TextDecoder().decode(sender);
        this.text = new TextDecoder().decode(text);
    }
}
