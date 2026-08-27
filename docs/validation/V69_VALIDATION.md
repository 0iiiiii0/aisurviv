# V69 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript + Vite build: PASS
- `test:cooperation` (new): PASS
- `test:integrated-spec`: PASS
- `test:special-roles`: PASS
- `test:movement-jitter`: PASS
- `test:v41-suite` (11 tests): PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:savannah-perks`: PASS
- `test:loot-capacity`: PASS
- `test:v53-matchmaking`: PASS
- `test:faction-autofill`: PASS

## Fix verification (`test:cooperation`)

- `PlayerInfo.isBot` wire round-trip: human -> false, bot -> true: PASS
- Healthy attacking faction: every doctrine order has `unifiedPush=true`, stance
  is attack, and the formation objectives stay tight (max spread < 80): PASS
- Heavy pressure (4 enemies at ~7 units): `unifiedPush=false`: PASS
- Faction rescue with a downed human and a downed bot: the human wins
  (`rescuePlayerId=901`, stance "rescue"): PASS
- Source guarantees:
  - downed reports carry the human flag from `playerInfos.isBot === false`: PASS
  - squad rescue sorts humans first (+160): PASS
  - human rescues get the dedicated "revive-human-teammate" intent and +150
    utility / +0.6 tier: PASS
  - `chooseEnemy` boosts the unified focus target: PASS
  - the faction order is resolved before target selection: PASS
  - `FactionOrder.unifiedPush` exists and faction rescue sorts humans first: PASS

## Live run (faction, 16 bots, 180 s)

- Bots followed shared faction orders (bridgehead objectives), no crashes,
  no reconnect loops: PASS

## Files changed

- `shared/net/updateMsg.ts` (PlayerInfo.isBot + exported serialize helpers)
- `shared/gameConfig.ts` (protocolVersion 85)
- `server/src/bot/factionStrategy.ts` (unifiedPush, human-first rescue sort)
- `server/src/smartBot.ts` (human flags, rescue priority, unified focus bonus,
  faction order before chooseEnemy, factionRescueAssignment.human)
- `server/src/game/objects/player.ts` (isBot getter)
- `client/src/objects/player.ts` (isBot in setPlayerInfo/getPlayerInfo)
- `client/src/ui/opponentDisplay.ts` (isBot on the dummy PlayerInfo)
- `server/src/cooperationSmokeTest.ts` (new)
- `server/package.json` (`test:cooperation`)