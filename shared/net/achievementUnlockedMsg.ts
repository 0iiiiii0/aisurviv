import type { AbstractMsg, BitStream } from "./net.ts";

export class AchievementUnlockedMsg implements AbstractMsg {
    achievementId = "";

    serialize(s: BitStream): void {
        s.writeString(this.achievementId);
    }

    deserialize(s: BitStream): void {
        this.achievementId = s.readString();
    }
}
