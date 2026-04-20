#!/usr/bin/env bash
# Viewport-render smoke: catches "red wireframe box" regression where
# item nodes spawn but their GLBs fail to render.
# Run: bash apps/editor/tests/smoke/run-viewport-smoke.sh
# Exit 0 on pass, 1 on fail.

set -euo pipefail

PORT="${PORT:-3002}"
BASE="http://localhost:${PORT}"
FAIL=0

echo "== GLB availability =="
# All 20 canonical SKUs — matches packages/halofire-catalog/src/manifest.ts
SKUS=(
  SM_Head_Pendant_Standard_K56
  SM_Head_Pendant_QR_K56
  SM_Head_Upright_Standard_K56
  SM_Head_Sidewall_Horizontal_K56
  SM_Head_Concealed_Pendant_K56
  SM_Pipe_SCH10_1in_1m
  SM_Pipe_SCH10_1_25in_1m
  SM_Pipe_SCH10_1_5in_1m
  SM_Pipe_SCH10_2in_1m
  SM_Pipe_SCH10_2_5in_1m
  SM_Pipe_SCH10_3in_1m
  SM_Fitting_Elbow_90_2in
  SM_Fitting_Elbow_90_1in
  SM_Fitting_Tee_Equal_2in
  SM_Fitting_Reducer_2to1
  SM_Fitting_Coupling_Grooved_2in
  SM_Valve_OSY_Gate_4in
  SM_Valve_Butterfly_4in_Grooved
  SM_Riser_FlowSwitch_2in
  SM_Riser_PressureGauge
)

for sku in "${SKUS[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/halofire-catalog/glb/${sku}.glb" || echo '000')
  if [[ "$code" != "200" ]]; then
    echo "FAIL  ${sku}.glb -> ${code}"
    FAIL=1
  fi
done
[[ $FAIL -eq 0 ]] && echo "PASS  20/20 GLBs served"

echo
echo "== Verify Pascal CDN override =="
# If NEXT_PUBLIC_ASSETS_CDN_URL were still the default (editor.pascal.app),
# item-renderer would resolve GLB URLs against that host instead of the
# self-hosted /public dir. We can't easily read runtime env from outside
# the bundle, so we check the .env.local file exists and sets the var.
ENV_FILE="$(dirname "$0")/../../.env.development"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL  apps/editor/.env.development missing (GLBs will 404 against editor.pascal.app)"
  FAIL=1
elif ! grep -qE '^NEXT_PUBLIC_ASSETS_CDN_URL=https?://' "$ENV_FILE"; then
  # An EMPTY value is falsy and falls back to editor.pascal.app —
  # resolveCdnUrl = process.env.NEXT_PUBLIC_ASSETS_CDN_URL || DEFAULT.
  # Must point explicitly at the studio origin (e.g. http://localhost:3002).
  echo "FAIL  NEXT_PUBLIC_ASSETS_CDN_URL must be an explicit http(s) origin in .env.development"
  echo "      (empty string is falsy -> falls back to editor.pascal.app)"
  FAIL=1
else
  echo "PASS  .env.development pins CDN to explicit origin"
fi

echo
if [[ $FAIL -eq 0 ]]; then
  echo "SMOKE: PASS"
  exit 0
else
  echo "SMOKE: FAIL — fix issues above. See viewport-render.smoke.md"
  exit 1
fi
