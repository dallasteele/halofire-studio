# HaloFire finish — Codex execution handoff (2026-06-12)

Operating model (user directive): **Claude plans + seeds loops; Codex + the
GX10 qwen loop + OpenClaw execute.** Do NOT ask Claude to spawn cloud agents.

The GX10 qwen loop already has the pure-module waves queued (Wave 18B/C/D:
emitter families, fastener hardware + hanger BOM, door detection; W18A parts
batch). Codex owns the integration + research + harvest below.

## Codex work queue (priority order)

1. **Harvest discipline** — after each qwen loop run lands on `agent/qwen-loop`,
   merge to `main` and run `bash scripts/deploy-vps.sh` (gated + auto-rollback).
   Live = https://halofire.rankempire.io (port 3301, nginx :443 added). Don't
   let qwen work pile up unharvested.

2. **Manufacturer cut-sheet URL map** — for every part in
   `apps/autosprink/src/components/registry.js` COMPONENTS, research the real
   manufacturer submittal/cut-sheet URL (Victaulic/Anvil/Tyco/Viking/Tolco/
   nVent CADDY/Reliable). Write `apps/autosprink/src/data/cutsheet-urls.json`
   `[{key,name,category,manufacturer,url,confidence:verified|probable|not-found,note}]`.
   Verify URLs respond; `url:null` when not found — never fabricate a URL.

3. **Cut-sheet scraper skill** — `apps/autosprink/src/skills/cutsheet-scraper/`
   (cron disabled by default): walk the URL map, fetch each page (Scrapling),
   strip to text, store in a `cutsheet_documents` table flagged
   `needs-verification`; failures recorded, never invented. Where text won't
   parse, use the GPU SAM service (hal-sam3 on GX10, :9003) to read the
   dimension table from the cut-sheet image.

4. **Parts generation bridge** — port the 4 cad emitters (+ the qwen-built
   W18B/C extras) to a JS path or call the cad lib; route
   `POST /api/parts/generate` → dims → emitter → `parts_models` row
   (`needs-verification`); wire `GET /api/parity` `modelsBuilt` to the real
   count of `parts_models` with scad. Goal: **155/155 flagged models, 0
   blocked**; the Settings ledger count climbs as the scraper fills.

5. **Real building extraction (1881)** — chain the landed bricks: sheet-classify
   → scale-notation prefill → pdf-line-cluster → wall-extract-score →
   Suggest-Walls (operator confirm) → W18D door-detect → ceiling grids →
   multi-floor stack. Acceptance: import the 1881 PDF set → scaled building with
   openings + ceilings + the sprinkler system, measured area ~21,332 sqft.

6. **Fasteners into takeoff** — place W18C hanger hardware at W6A spacing points,
   render in Viewer3D, and add the hanger BOM line items to the bid takeoff.

## Doctrine (unchanged)
Build-complete, flag-don't-gate: best-effort everything, label unverified
`needs-verification`, never block/hide, never claim manufacturer-exact/AHJ/PE.
Wade invite already exists; SMTP creds are user-side; no auto-send.

## Verification before "done"
Per part-fill batch: ledger count rises + each new model flagged. Per building:
numeric scene check via `window.__cadVerify3D` + close-range screenshot. Per
deploy: `deploy-vps.sh` health gate + `curl https://halofire.rankempire.io/api/health`.
