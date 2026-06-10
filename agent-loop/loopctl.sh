#!/usr/bin/env bash
# loopctl.sh — the ONLY entry point HAL's exec allowlist permits (gated autonomy).
set -euo pipefail
DIR=/opt/hal9000/apps/halofire-studio/agent-loop
LOG=/opt/hal9000/logs/halofire-agent-loop.log
case "${1:-}" in
  status)
    python3 - <<'PY'
import json
from collections import Counter
p = "/opt/hal9000/apps/halofire-studio/agent-loop/backlog.json"
d = json.load(open(p))
tasks = d.get("tasks", d) if isinstance(d, dict) else d
print("backlog:", dict(Counter(str(t.get("status","?")) for t in tasks)))
for t in tasks:
    if str(t.get("status","")) == "blocked":
        print(f"BLOCKED: {t.get('id','?')} | {str(t.get('last_error',''))[:200]}")
    if str(t.get("status","")) == "pending":
        print(f"PENDING: {t.get('id','?')}")
PY
    ;;
  run)
    n="${2:-1}"; case "$n" in 1|2|3) ;; *) echo "run: MAX_TASKS must be 1-3"; exit 2;; esac
    MAX_TASKS="$n" bash "$DIR/run.sh"
    ;;
  log)     tail -n "${2:-60}" "$LOG" ;;
  lessons) tail -n 80 "$DIR/LESSONS.md" ;;
  git)     git -C /opt/hal9000/apps/halofire-studio log --oneline -n "${2:-5}" ;;
  propose)
    shift
    { printf '\n## %s (hal, via loopctl — NOT auto-applied)\n%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$*"; } >> "$DIR/PROPOSALS.md"
    echo "OK: appended 1 proposal to PROPOSALS.md"
    ;;
  *) echo "usage: loopctl.sh status|run [1-3]|log [n]|lessons|git [n]|propose <text>"; exit 2 ;;
esac
