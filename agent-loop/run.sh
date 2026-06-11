#!/usr/bin/env bash
# HaloFire agent-loop runner (GX10). Safe to cron — flock prevents double-runs.
#   */30 * * * *  /opt/hal9000/apps/halofire-studio/agent-loop/run.sh >> /opt/hal9000/logs/halofire-agent-loop.log 2>&1
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="/tmp/halofire-agent-loop.lock"
MAX_TASKS="${MAX_TASKS:-2}"
# Tier-1.5 local escalation coder (benched 3.0 tok/s on GB10 — see LOCAL_LLM.md);
# one unattended shot per blocked task before cloud escalation. Override to "" to disable.
export HALOFIRE_ESCALATION_MODELS="${HALOFIRE_ESCALATION_MODELS:-gemma4:26b-a4b-it-qat,kimi-dev:72b}"
# Cross-family verifier (Google QAT Gemma judges Qwen-built code).
export HALOFIRE_VERIFIER_MODEL="${HALOFIRE_VERIFIER_MODEL:-gemma4:26b-a4b-it-qat}"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[run.sh] another loop run is active; exiting"
  exit 0
fi

cd "$REPO"
git config user.name  >/dev/null 2>&1 || git config user.name  "HaloFire Agent Loop"
# Checkpoint dirty loop state (LESSONS/backlog/PROPOSALS) so merges stay clean.
git add -A agent-loop 2>/dev/null
git diff --cached --quiet || git -c user.name="HaloFire Agent Loop" -c user.email="agent-loop@halofire.local" commit -qm "agent-loop: state checkpoint"
git config user.email >/dev/null 2>&1 || git config user.email "agent-loop@halofire.local"

# Brain auth — canonical single source of truth on GX10 (fail-soft when absent).
if [ -f /opt/hal9000/config/hal-brain.env ]; then
  set -a; . /opt/hal9000/config/hal-brain.env; set +a
fi

# qwen must be reachable or there is nothing to do (fail fast, no token waste).
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "[run.sh] ollama not reachable on :11434; exiting"
  exit 1
fi

# Gate deps: ALWAYS reconcile (fast no-op when satisfied) — a dep added on main
# blocked an entire wave when node_modules existed but was stale.
(cd "$REPO/apps/cad" && npm install --no-audit --no-fund --prefer-offline >/dev/null 2>&1) ||   echo "[run.sh] npm install failed — gates may fail on missing deps"

python3 "$REPO/agent-loop/loop.py" --max-tasks "$MAX_TASKS"
