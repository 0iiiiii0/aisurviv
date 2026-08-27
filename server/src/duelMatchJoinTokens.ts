import type { FindGameResponse, GameManager, ServerGameConfig } from "./game/gameManager.ts";

type DuelTokenManager = Pick<GameManager, "createGame" | "createJoinToken">;

export interface PrivateDuelJoinTokens {
    gameId: string;
    humanJoins: FindGameResponse[];
    botJoin: FindGameResponse | null;
}

/**
 * Creates one credential per contestant so the token can carry the matching
 * per-player weapon-loadout index. AI credentials always use the explicit
 * serverBot path and therefore remain correctly classified in room statistics.
 */
export async function createPrivateDuelJoinTokens(
    manager: DuelTokenManager,
    config: ServerGameConfig,
    aiEnabled: boolean,
    expiresInMs: number,
): Promise<PrivateDuelJoinTokens> {
    const game = await manager.createGame(config);
    const gameId = game.id;
    const humanCount = aiEnabled ? 1 : 2;
    const humanJoins: FindGameResponse[] = [];
    for (let index = 0; index < humanCount; index++) {
        humanJoins.push(
            await manager.createJoinToken(
                gameId,
                expiresInMs,
                false,
                1,
                false,
                false,
                undefined,
                index,
            ),
        );
    }

    const botJoin = aiEnabled
        ? await manager.createJoinToken(
            gameId,
            expiresInMs,
            false,
            1,
            false,
            true,
            undefined,
            1,
        )
        : null;
    return { gameId, humanJoins, botJoin };
}
