#!/usr/bin/env bash
# loopctl.sh — the ONLY entry point HAL's exec allowlist permits (gated autonomy).
# VERSION-CONTROLLED: lives in the repo so branch resets can never destroy it.
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
    st = str(t.get("status",""))
    if st == "blocked":
        print(f"BLOCKED: {t.get('id','?')} | {str(t.get('last_error',''))[:200]}")
    elif st == "pending":
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
  health)
    # SELF-OBSERVATION: gateway + model runtime state, best-effort and honest.
    echo "== ollama runtime =="
    ollama ps 2>/dev/null | head -5 || echo "ollama unreachable"
    echo "== gateway log signals (errors/overflows, newest log file) =="
    LOGF=$(ls -t /home/hal9000/.openclaw/logs/*.log 2>/dev/null | head -1)
    if [ -n "${LOGF:-}" ]; then
      tail -n 400 "$LOGF" | grep -aiE "error|overflow|context-overflow|failed|denied" | tail -15 || echo "no error signals in last 400 lines"
    else
      echo "no readable gateway log file (journald-only logging)"
    fi
    echo "== loop log tail =="
    tail -n 8 "$LOG" 2>/dev/null || echo "no loop log"
    ;;
  report)
    # ONE deterministic call gathering everything the self-improve agent needs.
    echo "===== PRIORITIES (steering file) ====="
    head -40 /opt/hal9000/apps/halofire-studio/docs/plans/PRIORITIES.md 2>/dev/null || echo "no priorities file"
    bash "$0" status
    echo "===== LESSONS (tail) ====="
    tail -n 20 "$DIR/LESSONS.md" 2>/dev/null || true
    echo "===== LOOP LOG (tail) ====="
    tail -n 25 "$LOG" 2>/dev/null || true
    echo "===== HEALTH ====="
    bash "$0" health
    ;;
  propose)
    shift
    { printf '\n## %s (hal, via loopctl — NOT auto-applied)\n%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$*"; } >> "$DIR/PROPOSALS.md"
    echo "OK: appended 1 proposal to PROPOSALS.md"
    ;;
  *) echo "usage: loopctl.sh status|run [1-3]|log [n]|lessons|git [n]|health|report|propose <text>"; exit 2 ;;
esac
