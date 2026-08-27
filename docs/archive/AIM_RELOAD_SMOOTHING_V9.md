# AI Aim and Reload Tracking V9

## Changes

- Bots keep tracking a recently visible enemy while either normal or alternate reload actions are active.
- Reload tracking uses only the bot's existing visible-player memory. It does not use hidden network coordinates or permit firing during reload.
- A short 850 ms directional hold prevents the crosshair from snapping toward loot or a movement objective when an opponent briefly crosses a doorway.
- All outbound aim directions now pass through an angular-speed limiter instead of being sent directly in one frame.
- Turn speed varies by combat state, difficulty, duel mode, and close-range danger, but remains capped between 260 and 650 degrees per second.
- Event-loop stalls are capped to a 100 ms aim step, so a delayed tick cannot create an instant 180-degree turn.
- Gunfire is delayed until the transmitted crosshair is sufficiently aligned with the desired aim direction:
  - automatic weapons: within about 14.3 degrees;
  - semi-automatic weapons: within about 9.2 degrees.
- Reloading always suppresses fire input while preserving aim tracking.

## Files

- `server/src/smartBot.ts`
- `server/src/bot/aimControl.ts`
- `server/src/aimControlSmokeTest.ts`
- `server/package.json`

## Test command

```powershell
cd server
npm run build
npm run test:aim-control
```
