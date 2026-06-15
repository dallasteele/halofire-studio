# Phase 4 — Intake & Deliverables — CODEX BUILD BRIEF
*Owner: hal-codex (gpt-5.5) + local qwen on GX10. Claude does final live verification only (credit conservation). Authored by Claude 2026-06-14.*

## Goal
Turn a correct sprinkler design into something Halo Fire can submit to the AHJ. Build the Phase-4 items from `docs/plans/AUTOSPRINK_PARITY_GAP_AND_PLAN.md` on the live Studio engine.

## Repo / deploy / harness (USE EXACTLY THIS)
- Repo: `apps/autosprink` in github.com/dallasteele/halofire-studio (branch master). Engine = inline `<script type="module">` in `apps/autosprink/autosprink.html` + `apps/autosprink/src/engine/*`.
- Local run + login for live verification: `cp data/halofire.db /tmp/hfdb-X.db ; HALOFIRE_DB_PATH=/tmp/hfdb-X.db PORT=33NN node src/api/server.js` ; login `qa@halofire.local` / `qa-local-verify-9animals` (admin). Playwright is installed; WebGL works headless (`--use-gl=swiftshader`). Studio at `/autosprink.html`, "Generate Layout" for a model.
- Gate: `npx vitest run --exclude '**/*browser*smoke*.test.js' --exclude '**/*smoke*browser*.test.js'` MUST stay green (currently 1364 pass).
- Deploy each change: `scp autosprink.html root@187.124.234.28:/opt/openclaw/halofire-studio/apps/autosprink/` (+ src). Live URL = https://halofire.rankempire.io/autosprink.html (md5 must match local).
- Commit to master after the gate is green; keep origin == VPS.

## 🔴 GUARDS (non-negotiable — prior wave violated #1 and broke the app)
1. **Camera-neutral:** NEVER reframe/move the camera on click/draw/edit/calc/pointermove. A plain click + a draw click must leave `window.__dbgTarget()` unchanged (<0.5 ft). Use `renderModel(model,{preserveView:true})` for rebuilds. No duplicate pointer/move-drag systems — build WITH the existing handlers (grab-drag `hfDrag` ~line 824, selection `handleCanvasClick`/`curSelSolid`, Phase-1 osnap/grips, 2D mode `__is2D`).
2. **Verify real output, not presence.** Expose `window.__hfPhase4.<feature>` hooks returning observable results. 0 pageerror.
3. **Honesty:** flag PARTIAL/stub explicitly; never fake. Anything regulated stays labeled "engineering aid — NOT AHJ/PE-stamped."

## Build chunks (sequential — the engine is one file; do NOT parallel-edit autosprink.html)
1. **PDF/DWG → building model + scale calibration.** Import a PDF/DXF plan → reconstruct a real building model (walls / openings / columns / levels) the head-placer + router can run on. Add interactive **scale calibration** (pick two points, type the real distance → sets units). Existing intake code is heuristic/partial — make it produce a usable Building. `__hfPhase4.intake -> {walls, openings, columns, levels, scaleFtPerPx}`.
2. **Section / elevation cut.** A cut plane the user places on the plan → a generated 2D section/elevation view (pipes + heads + structure in section). `__hfPhase4.section -> {plane, entities}`. Camera-neutral.
3. **Submittal sheet set (FP-0…FP-D) + titleblock.** Generate the standard sheet set: FP-0 cover, FP-H hydraulic placard, FP-N per-level plans, FP-R riser diagram, FP-B BOM, FP-D details — each on a titleblock (project/date/designer/sheet#), exportable as a multi-sheet PDF. Pull from the real model + Phase-2 BOM + Phase-3 hydraulics. `__hfPhase4.submittal -> {sheets:[...], hasTitleblock}`.
4. **Drop-ceiling tile grid synthesis.** Synthesize a ceiling tile grid (e.g. 2x2/2x4) over a level; option to center heads on tiles. `__hfPhase4.ceiling -> {tileW, tileH, headsCentered}`.
5. **Cut-sheet PDF bundle.** Collate the manufacturer datasheet (cut sheet) for each used SKU into one bundle appended to the submittal. `__hfPhase4.cutsheets -> {skus, pages}`.

## Acceptance (Claude will re-verify these live before it's "done")
- Each chunk's `__hfPhase4` hook returns real, sensible output on the live model.
- Camera-neutral holds (click/draw move camera 0.00 ft).
- Gate green; live URL md5-matches; 0 pageerror.
- Honest residuals listed in `AUTOSPRINK_PARITY_GAP_AND_PLAN.md`.

## Escalation
If a chunk is genuinely beyond local-LLM/Codex reliability (esp. #1 PDF→building reconstruction — it's XL), do the parts you can, commit them green, and write the honest blocker into `data/coordination/codex-to-claude.md` so Claude can finish that piece. Do NOT fake or leave the gate red.
