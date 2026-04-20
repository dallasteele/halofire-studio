#!/usr/bin/env bash
# Persist a research / decision note to the shared Brain via HAL.
# Usage:
#   docs/research/brain_sync.sh "title" path/to/note.md [confidence=0.8] [source=claude-code]
#
# The file's body is stored verbatim as the note content; the title is
# required so the Brain can write it to wiki/decisions/<slug>.md.
set -euo pipefail

TITLE="${1:?title required}"
FILE="${2:?markdown file required}"
CONF="${3:-0.8}"
SOURCE="${4:-claude-code}"
HAL_URL="${HAL_URL:-http://localhost:9000}"

if [[ ! -f "$FILE" ]]; then
  echo "note file not found: $FILE" >&2
  exit 1
fi

CONTENT="$(cat "$FILE")"

python3 - <<PY
import json, sys, urllib.request
body = {
  "source": "$SOURCE",
  "type": "decision",
  "title": "$TITLE",
  "content": """$CONTENT""",
  "confidence": float("$CONF"),
  "related": ["halofire-cad", "halofire-studio", "openclaw-halofire"],
}
req = urllib.request.Request(
  "$HAL_URL/brain/wiki/remember",
  data=json.dumps(body).encode(),
  headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=30) as r:
  print(r.read().decode())
PY
