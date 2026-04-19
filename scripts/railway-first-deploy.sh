#!/usr/bin/env bash
# Run from your machine (interactive): login → new Railway project → deploy from this directory.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found" >&2
  exit 1
fi
npm install

echo ""
echo "=== 1/3: Railway login (browser) ==="
npx railway login

echo ""
echo "=== 2/3: Create project + link (name: reglookup) ==="
if [[ -d "$ROOT/.railway" ]]; then
  echo "Already linked (.railway exists). Skipping init. Use 'npx railway unlink' first if you want a new project."
else
  npx railway init -n reglookup
fi

echo ""
echo "=== 3/3: Deploy (Dockerfile build; stream logs) ==="
echo "Tip: In Railway dashboard set this service to >= 2 GB RAM before relying on Puppeteer."
npx railway up

echo ""
echo "Done. Open dashboard: npx railway open"
