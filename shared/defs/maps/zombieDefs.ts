import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import type { MapDef } from "../mapDefs.ts";
import { Main } from "./baseDefs.ts";

/**
 * 僵尸模式地图：完全复用主地图（地形/障碍/物资），仅覆盖模式标志。
 * 大批量低占用近战僵尸追逐玩家；玩家撑到时限获胜。
 * 注意：mergeDeep 就地修改第一个参数——必须传空对象，否则会污染 Main！
 */
export const Zombie: MapDef = util.mergeDeep({}, Main, {
    mapId: GameConfig.MapId.Zombie,
    gameMode: {
        maxPlayers: 40,
        zombieMode: true,
    },
}) as MapDef;
