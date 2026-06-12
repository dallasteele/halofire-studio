#!/usr/bin/env bash
# cf-dns.sh — create/update a Cloudflare DNS record via the API (idempotent).
#
# UNATTENDED infra access for Claude + OpenClaw. Reads the token from the
# environment — NEVER hardcode or commit a token. Source the secret file first:
#   source /opt/hal9000/config/infra-secrets.env   # holds CLOUDFLARE_API_TOKEN=...
#
# Usage: cf-dns.sh <zone> <name> <type> <content> [proxied true|false]
#   bash scripts/cf-dns.sh rankempire.io halofire A 187.124.234.28 true
set -euo pipefail

ZONE="${1:?zone required e.g. rankempire.io}"
NAME="${2:?record name e.g. halofire}"
TYPE="${3:?type e.g. A}"
CONTENT="${4:?content e.g. 187.124.234.28}"
PROXIED="${5:-true}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (source the secret file) — never hardcode}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
FQDN="${NAME}.${ZONE}"
[ "$NAME" = "@" ] && FQDN="$ZONE"

# 1) Resolve the zone id.
ZID=$(curl -fsS "${AUTH[@]}" "$API/zones?name=${ZONE}" | python3 -c \
  'import sys,json; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')
[ -n "$ZID" ] || { echo "zone not found or token lacks Zone:Read for ${ZONE}"; exit 1; }

# 2) Does the record already exist? (idempotent: update vs create.)
RID=$(curl -fsS "${AUTH[@]}" "$API/zones/${ZID}/dns_records?type=${TYPE}&name=${FQDN}" | python3 -c \
  'import sys,json; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')

BODY=$(python3 -c "import json,sys; print(json.dumps({'type':sys.argv[1],'name':sys.argv[2],'content':sys.argv[3],'proxied':sys.argv[4].lower()=='true','ttl':1}))" "$TYPE" "$FQDN" "$CONTENT" "$PROXIED")

if [ -n "$RID" ]; then
  echo "updating existing ${TYPE} ${FQDN} -> ${CONTENT} (proxied=${PROXIED})"
  RES=$(curl -fsS -X PUT "${AUTH[@]}" "$API/zones/${ZID}/dns_records/${RID}" --data "$BODY")
else
  echo "creating ${TYPE} ${FQDN} -> ${CONTENT} (proxied=${PROXIED})"
  RES=$(curl -fsS -X POST "${AUTH[@]}" "$API/zones/${ZID}/dns_records" --data "$BODY")
fi

echo "$RES" | python3 -c 'import sys,json; r=json.load(sys.stdin); print("OK" if r.get("success") else "FAILED: "+json.dumps(r.get("errors")))'
