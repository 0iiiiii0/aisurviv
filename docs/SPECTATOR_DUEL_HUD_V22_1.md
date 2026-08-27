# Spectator Duel HUD v22.1

This patch separates the 1v1 scoreboard from the spectator status label.

- The score remains the highest layer in the top-center HUD.
- Spectator/player-camera/free-camera text becomes a compact translucent pill below the score.
- When the round status line expands the score panel, the spectator pill moves farther down.
- On narrow screens, the redundant "Spectating" prefix is hidden and only the target/free-camera help is shown.
- The same override is included in `client/dist`, so the packaged production client contains the fix without rebuilding Vite.
