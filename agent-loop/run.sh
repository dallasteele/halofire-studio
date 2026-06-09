#!/usr/bin/env bash
# HaloFire agent-loop runner (GX10). Safe to cron — flock prevents double-runs.
#   */30 * * * *  /opt/hal9000/apps/halofire-studio/agent-loop/run.sh >> /opt/hal9000/logs/halofire-agent-loop.log 2>&1
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="/tmp/halofire-agent-loop.lock"
MAX_TASKS="${MAX_TASKS:-2}"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[run.sh] another loop run is active; exiting"
  exit 0
fi

cd "$REPO"
git config user.name  >/dev/null 2>&1 || git config user.name  "HaloFire Agent Loop"
git config user.email >/dev/null 2>&1 || git config user.email "agent-loop@halofire.local"

# qwen must be reachable or there is nothing to do (fail fast, no token waste).
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "[run.sh] ollama not reachable on :11434; exiting"
  exit 1
fi

# Gate deps: apps/cad needs node_modules for tsc/vitest.
if [ ! -d "$REPO/apps/cad/node_modules" ]; then
  echo "[run.sh] installing apps/cad deps..."
  (cd "$REPO/apps/cad" && npm install --no-audit --no-fund)
fi

python3 "$REPO/agent-loop/loop.py" --max-tasks "$MAX_TASKS"
