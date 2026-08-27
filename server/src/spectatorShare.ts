import { randomBytes } from "node:crypto";
import { isDuelMapName } from "../../shared/defs/duelMapNames.ts";
import type { GameData } from "./game/gameManager.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class SpectatorShareError extends Error {}

export class SpectatorShareService {
    private readonly byCode = new Map<string, string>();
    private readonly byGame = new Map<string, string>();

    constructor(private readonly getGame: (gameId: string) => GameData | undefined) {}

    create(gameId: string): string {
        const current = this.byGame.get(gameId);
        if (current && this.isActive(gameId)) return current;
        this.removeGame(gameId);
        for (let attempts = 0; attempts < 100; attempts++) {
            const bytes = randomBytes(8);
            let code = "";
            for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
            if (this.byCode.has(code)) continue;
            this.byCode.set(code, gameId);
            this.byGame.set(gameId, code);
            return code;
        }
        throw new SpectatorShareError("暂时无法生成观战分享码");
    }

    resolve(code: unknown): { gameId: string; code: string } {
        const normalized = String(code ?? "").trim().toUpperCase();
        const gameId = this.byCode.get(normalized);
        if (!gameId || !this.isActive(gameId)) {
            if (gameId) this.removeGame(gameId);
            throw new SpectatorShareError("观战分享码无效或本局已经结束");
        }
        return { gameId, code: normalized };
    }

    codeFor(gameId: string): string | undefined {
        const code = this.byGame.get(gameId);
        if (!code) return undefined;
        if (!this.isActive(gameId)) {
            this.removeGame(gameId);
            return undefined;
        }
        return code;
    }

    removeGame(gameId: string): void {
        const code = this.byGame.get(gameId);
        if (code) this.byCode.delete(code);
        this.byGame.delete(gameId);
    }

    private isActive(gameId: string): boolean {
        const game = this.getGame(gameId);
        return Boolean(game && !game.stopped && isDuelMapName(game.mapName));
    }
}
