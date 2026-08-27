const AMMO_REQUEST_EMOTES = new Set([
    "emote_ammo",
    "emote_ammo9mm",
    "emote_ammo12gauge",
    "emote_ammo762mm",
    "emote_ammo556mm",
    "emote_ammo50ae",
    "emote_ammo308sub",
    "emote_ammoflare",
    "emote_ammo45acp",
]);

const AMMO_GIFT_PING = "ping_help";

const AMMO_GIFT_EMOTES = new Set([AMMO_GIFT_PING]);

export const isAmmoRequestEmote = (type: string): boolean => AMMO_REQUEST_EMOTES.has(String(type ?? ""));

export const isAmmoGiftEmote = (type: string): boolean => AMMO_GIFT_EMOTES.has(String(type ?? ""));

export const ammoGiftEmoteForType = (_ammoType: string): string => AMMO_GIFT_PING;

export interface TeamEmoteVisibilityInput {
    type: string;
    teamOnly: boolean;
    isPing: boolean;
    hasItemType: boolean;
    senderVisible: boolean;
    sameGroup: boolean;
    sameFaction: boolean;
    senderIsFactionLeader: boolean;
}

/**
 * Team-only emotes normally stay inside the four-player group. Ammo requests
 * are different in 50v50: every same-faction AI donor must be able to receive
 * the request even when the human belongs to another squad or is off-screen.
 */
export function shouldDeliverTeamEmote(input: TeamEmoteVisibilityInput): boolean {
    const factionAmmoRequest = input.sameFaction && isAmmoRequestEmote(input.type);
    const ammoGift = isAmmoGiftEmote(input.type);
    const teamAmmoGift = ammoGift && (input.sameGroup || input.sameFaction);
    // A gift is an item-sharing signal, not a public cosmetic emote. Deliver it
    // to the intended team even if smoke or the edge of the camera temporarily
    // hides the donor, and never leak it to an enemy.
    if (ammoGift) return teamAmmoGift;
    if (input.teamOnly && !input.sameGroup && !factionAmmoRequest) return false;

    const seeNormalEmote = !input.isPing && (input.senderVisible || factionAmmoRequest);
    const seePing = (input.isPing || input.hasItemType)
        && (input.sameGroup || input.senderIsFactionLeader || factionAmmoRequest);
    return seeNormalEmote || seePing;
}
