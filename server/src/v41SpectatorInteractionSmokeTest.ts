import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";

async function run(): Promise<void> {
    const encodedSpectate = new net.SpectateMsg();
    encodedSpectate.specPlayersOnlySet = true;
    encodedSpectate.specPlayersOnly = true;
    encodedSpectate.specFreeActive = true;
    encodedSpectate.freeCameraLayer = 3;
    encodedSpectate.freeCameraPos = { x: 96, y: 30 };
    encodedSpectate.freeCameraViewRadius = 120;
    const spectateBuffer = new ArrayBuffer(64);
    encodedSpectate.serialize(new net.BitStream(spectateBuffer));
    const decodedSpectate = new net.SpectateMsg();
    decodedSpectate.deserialize(new net.BitStream(spectateBuffer));
    assert.equal(decodedSpectate.specPlayersOnlySet, true);
    assert.equal(decodedSpectate.specPlayersOnly, true);
    assert.equal(decodedSpectate.freeCameraLayer, 3);

    const game = new Game("v41-spectator-interaction", {
        mapName: "duel",
        teamMode: TeamMode.Solo,
        privateGame: true,
    });

    function join(
        socketId: string,
        name: string,
        spectator = false,
        duelLoadoutIndex?: number,
    ) {
        const token = `v41-${socketId}`;
        game.addJoinToken(
            token,
            false,
            1,
            60_000,
            spectator,
            false,
            undefined,
            duelLoadoutIndex,
        );
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.joinToken = token;
        msg.matchPriv = token;
        msg.name = name;
        const client = game.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game.joinTokens.get(token)?.data as JoinTokenData,
            msg,
            token,
        );
        const player = client?.player;
        assert(player);
        return player;
    }

    const left = join("left", "Left", false, 0);
    const right = join("right", "Right", false, 1);
    right.serverBot = true;
    const observer = join("observer", "Observer", true);
    assert.equal(observer.spectatorOnly, true);
    assert(observer.spectating);

    const target = observer.spectating!;
    const targetMessages: Array<{ type: number; msg: net.AbstractMsg }> = [];
    const observerMessages: Array<{ type: number; msg: net.AbstractMsg }> = [];
    target.sendMsg = (type, msg) => targetMessages.push({ type, msg });
    observer.sendMsg = (type, msg) => observerMessages.push({ type, msg });

    const chat = new net.SpectatorChatMsg();
    chat.text = "  注意\u0000右侧   沙袋  ";
    observer.sendSpectatorChat(chat);
    assert.equal(targetMessages.length, 1, "watched player should receive the observer message");
    assert.equal(observerMessages.length, 1, "observer should receive a delivery echo");
    assert.equal(targetMessages[0].type, net.MsgType.SpectatorChat);
    const delivered = targetMessages[0].msg as net.SpectatorChatMsg;
    assert.equal(delivered.delivered, true);
    assert.equal(delivered.sender, "Observer");
    assert.equal(delivered.text, "注意 右侧 沙袋");

    // Per-observer flood protection must suppress an immediate second message.
    observer.sendSpectatorChat(chat);
    assert.equal(targetMessages.length, 1);

    const free = new net.SpectateMsg();
    free.specFreeToggle = true;
    free.specFreeActive = true;
    free.freeCameraPos = { x: 96, y: 30 };
    free.freeCameraViewRadius = 120;
    free.freeCameraLayer = 3;
    observer.spectate(free);
    assert.equal((observer as unknown as { freeCameraActive: boolean }).freeCameraActive, true);
    assert.deepEqual((observer as unknown as { freeCameraPos: { x: number; y: number } }).freeCameraPos, {
        x: 96,
        y: 30,
    });
    assert.equal((observer as unknown as { freeCameraLayer: number }).freeCameraLayer, 3);
    assert.equal(observer.spectating, target, "free camera must not replace or mutate the selected player");

    const playersOnly = new net.SpectateMsg();
    playersOnly.specPlayersOnlySet = true;
    playersOnly.specPlayersOnly = true;
    observer.spectate(playersOnly);
    const nextHuman = new net.SpectateMsg();
    nextHuman.specNext = true;
    observer.spectate(nextHuman);
    assert.equal(
        observer.spectating,
        left,
        "players-only navigation must skip server AI targets",
    );
    assert.equal(
        (observer as unknown as { freeCameraActive: boolean }).freeCameraActive,
        false,
        "choosing a player target should exit free camera",
    );

    // A player is not allowed to impersonate a spectator and send this channel.
    const blocked = new net.SpectatorChatMsg();
    blocked.text = "forged";
    left.sendSpectatorChat(blocked);
    assert.equal(targetMessages.length, 1);

    const projectRoot = path.resolve(import.meta.dirname, "../..");
    const gameClient = fs.readFileSync(path.join(projectRoot, "client/src/game.ts"), "utf8");
    const uiClient = fs.readFileSync(path.join(projectRoot, "client/src/ui/ui.ts"), "utf8");
    const html = fs.readFileSync(path.join(projectRoot, "client/index.html"), "utf8");
    const gameCss = fs.readFileSync(path.join(projectRoot, "client/css/game.css"), "utf8");
    assert.match(
        gameClient,
        /if \(this\.m_spectating\)[\s\S]{0,80}appendSpectatorChat[\s\S]*?else[\s\S]*?showSpectatorMessage/,
        "the watched player must have a visible non-spectator message path",
    );
    assert.match(uiClient, /showSpectatorMessage\(sender: string, text: string\)/);
    assert.match(html, /id='ui-spectator-inbox'/);
    // Mobile spectator chat must stay above the touch HUD and opt out of the
    // gameplay touch collector, otherwise tapping the input cannot summon the
    // software keyboard.
    assert.match(
        html,
        /id='ui-spectator-chat-input'[^>]*data-game-input-blocker/,
        "the spectator chat input must block gameplay input collection",
    );
    assert.match(
        gameCss,
        /#ui-spectate-options-wrapper\s*\{[\s\S]*?pointer-events:\s*auto;[\s\S]*?z-index:\s*20;/,
        "the spectator chat must remain touchable above the mobile HUD",
    );
    assert.match(
        gameCss,
        /\.spectator-chat-panel button\s*\{[\s\S]*?touch-action:\s*manipulation;/,
        "the mobile send button must use direct tap handling",
    );

    // iOS can drop the synthetic click when the send button closes the soft
    // keyboard and causes a layout pass. Send on touchend, prevent the ghost
    // click, and keep a short lock so one tap cannot enqueue twice.
    assert.match(
        uiClient,
        /const fireSpectatorChatSend\s*=\s*\(e\?: JQuery\.Event\)\s*=>\s*\{[\s\S]*?if \(chatSendLocked\) return;[\s\S]*?setTimeout\(\(\) => \(chatSendLocked = false\), 300\);[\s\S]*?e\?\.preventDefault\(\);[\s\S]*?submitSpectatorChat\(\);/,
        "mobile chat submission must prevent the ghost click and de-duplicate taps",
    );
    assert.match(
        uiClient,
        /chatSendBtn\.on\("touchend",[\s\S]*?fireSpectatorChatSend\(e\);[\s\S]*?\}\);/,
        "the spectator chat send button must support touchend",
    );
    assert.match(
        uiClient,
        /spectatorChatInput\.on\("keydown keyup keypress",[\s\S]*?event\.type === "keydown"[\s\S]*?event\.key === "Enter" \|\| event\.keyCode === 13[\s\S]*?event\.stopPropagation\(\);[\s\S]*?\}\);/,
        "soft-keyboard Enter must submit without leaking any keyboard phase to gameplay",
    );
    // The spectator occluder-transparency toggle must work while following any
    // target, not only free camera.
    assert.match(
        gameClient,
        /this\.m_spectating && this\.m_uiManager\.specTransparentObstacles/,
        "spectator occluder transparency must apply while watching any player",
    );
    assert.doesNotMatch(
        gameClient,
        /this\.m_spectating &&\s*this\.freeSpectating &&\s*this\.m_uiManager\.specTransparentObstacles/,
        "occluder transparency must not be limited to free-camera mode",
    );

    game.stop();
    console.log(
        "V41 spectator interaction smoke test passed: private delivery, visible player inbox, flood control, human-only navigation and independent free-camera layer.",
    );
}

void run();
