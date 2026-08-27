V9 installation
===============

1. Stop the launcher, game server, and all related node.exe processes.
2. Extract the update-only archive into the project root containing server, client, and shared.
3. Replace all files when prompted.
4. Restart the server and create a new room.

Main behavior:
- AI tracks visible enemies while reloading.
- AI turns toward changed targets over time instead of snapping in one frame.
- AI does not fire until the smoothed crosshair is aligned.

V9 is based on V8 and retains resource sweeping, invalid-loot crash protection,
50v50 20+20 AI limits, spectator fixes, and the previous combat/healing changes.
