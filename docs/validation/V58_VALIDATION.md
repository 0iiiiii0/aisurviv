# V58 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript no-emit check + production build (dist regenerated): PASS
- `test:bot-autofill-config`: PASS (unified interval, independent faction cap)
- `test:faction-autofill`: PASS (50v50 cap + fallback)
- `test:admin`: PASS (new setBotAutoFillConfig signature + snapshot)
- `test:v41-suite` (11 tests): PASS

## Behavior

- All playlists share `defaultJoinIntervalMs`; legacy `modeOverrides` are
  ignored and cleared on admin save.
- `factionTargetPlayerCount` drives 50v50 `policy.targetPlayerCount`;
  ordinary rooms keep using `targetPlayerCount`.
- Admin UI shows "AI统一加入间隔", "普通房间补齐目标", "50v50补齐人数上限"
  and no per-mode interval editors.
