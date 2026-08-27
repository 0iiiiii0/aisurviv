import { type AbstractMsg, type BitStream, Constants } from "./net.ts";

export class JoinMsg implements AbstractMsg {
    protocol = 0;
    joinToken = "";
    /** Legacy source compatibility; the wire format uses joinToken. */
    get matchPriv(): string {
        return this.joinToken;
    }
    set matchPriv(value: string) {
        this.joinToken = value;
    }
    /** Legacy custom-account stash identity, retained by protocol 1024. */
    loadoutPriv = "";
    /** Legacy quest credential, retained for compatible custom clients. */
    questPriv = "";
    name = "";
    useTouch = false;
    isMobile = false;
    bot = false;
    /** Server-authorized smart-bot coordinator needs one complete map snapshot. */
    botMapOwner = false;
    loadout = {
        outfit: "",
        melee: "",
        heal: "",
        boost: "",
        emotes: [] as string[],
    };

    serialize(s: BitStream) {
        // NEVER PUT THIS ANYWHERE ELSE OR CHANGE ITS SIZE!!
        // PROTOCOL VERSION SHOULD ALWAYS BE THE FIRST WITH THE SAME SIZE TO NOT BREAK OLD CLIENTS!!
        s.writeUint32(this.protocol);
        s.writeString(this.joinToken);
        s.writeString(this.loadoutPriv);
        s.writeString(this.questPriv);

        s.writeString(this.name, Constants.PlayerNameMaxLen);
        s.writeBoolean(this.useTouch);
        s.writeBoolean(this.isMobile);
        s.writeBoolean(this.bot);
        s.writeBoolean(this.botMapOwner);

        s.writeGameType(this.loadout.outfit);
        s.writeGameType(this.loadout.melee);
        s.writeGameType(this.loadout.heal);
        s.writeGameType(this.loadout.boost);

        s.writeArray(this.loadout.emotes, 8, (emote) => {
            s.writeGameType(emote);
        });
    }

    deserialize(s: BitStream) {
        this.protocol = s.readUint32();
        this.joinToken = s.readString();
        this.loadoutPriv = s.readString();
        this.questPriv = s.readString();

        this.name = s.readString(Constants.PlayerNameMaxLen);
        this.useTouch = s.readBoolean();
        this.isMobile = s.readBoolean();
        this.bot = s.readBoolean();
        this.botMapOwner = s.readBoolean();

        this.loadout.outfit = s.readGameType();
        this.loadout.melee = s.readGameType();
        this.loadout.heal = s.readGameType();
        this.loadout.boost = s.readGameType();

        this.loadout.emotes = s.readArray(8, () => {
            return s.readGameType();
        });
    }
}
