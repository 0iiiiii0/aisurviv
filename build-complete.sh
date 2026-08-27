#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export CI=true

command -v node >/dev/null 2>&1 || {
  echo "Node.js 22.18.0 or newer is required." >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "pnpm is required. Run 'corepack enable pnpm' or install pnpm 11.18.0." >&2
  exit 1
}
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 18)) { console.error(`Node.js 22.18.0 or newer is required (found ${process.versions.node}).`); process.exit(1); }'

echo "[1/3] Installing the pnpm workspace from the frozen lockfile..."
pnpm install --frozen-lockfile

echo "[2/3] Building the Rolldown server entries and Vite client..."
pnpm build

echo "[3/3] Verifying deployable entry points..."
required=(
  server/dist/gameServer.js
  server/dist/gameProcess.js
  server/dist/smartBot.js
  server/dist/index.js
  client/dist/index.html
  client/dist/admin/index.html
)
for output in "${required[@]}"; do
  if [[ ! -f "$output" ]]; then
    echo "Build is incomplete: missing $output" >&2
    exit 1
  fi
done

echo "Build completed. Runtime configuration and server-data were left untouched."
