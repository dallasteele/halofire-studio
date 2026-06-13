# HaloFire WALL ENSEMBLE PIPELINE — PIECE 1 (walls only)

Procedural, per-element, vision-verified wall extraction for A-101 page 8 (L1 = parking deck
first floor of The Cooperative 1881). Implements `docs/plans/halofire-extraction-pipeline.md`
stages 0-6. Replaces the old single-pass heuristic that produced 3,643-41,784 fake walls
(parking stalls + blue grid + dimension lines mislabeled as walls).

## Files
- `wall_pipeline.py` — the pipeline (stages 0-6).
- `cubicasa_judge.py` — CubiCasa5K wall-pixel sidecar judge (smp Unet resnet34, 4-class, class1=wall).

## Run (on GX10, where the ensemble lives)
```
SAM3_URL=http://127.0.0.1:9003 OLLAMA_URL=http://127.0.0.1:11434 \
/opt/hal9000/apps/claudebot/.venv/bin/python wall_pipeline.py \
  --pdf ".../1881 - Architecturals.pdf" --out ./out --vlm 0
```
`--vlm 1` (with `VLM_JUDGES=qwen2.5vl:7b,moondream:latest`) adds per-element VLM votes — slow
(see throughput note); default `--vlm 0` uses the fast CubiCasa + deterministic gates.

## Stages
0. **RENDER** — PyMuPDF renders A-101 p8 (page idx 7, rect 2592x1728pt, scale 3/32"=1'=0.1481
   ft/pt) at 300 DPI = 10800x7200px. Raster AND vectors come from the SAME renderer/coordinate
   frame => exact ft<->pixel mapping, no pdfjs-version mismatch (the W2b discipline).
1. **SECTION** — SAM3 :9003 geometric `/box`. NOTE: currently returns HTTP 422 on the footprint
   box (negative origin); geometric boxes worked in the model standup, so the box coords need a
   fix. Sectioning is a secondary aid (missed-wall sweep), not the gate — not blocking.
2. **CANDIDATES** — `get_drawings()` -> 41,802 stroked segments -> prefilter (drop blue grid,
   tiny dim-ticks, off-footprint, sub-median-lineweight) -> 1,005 -> collinear axis-merge ->
   **187 candidate wall RUNS**.
3. **GATE** — per candidate: tight native-res crop -> CubiCasa wall-pixel fraction (>=0.04, and
   reject >90ft spanning lines with ~0 frac). CubiCasa is the only judge both fast (0.1-0.8s) AND
   discriminating enough to gate every element on this GPU.
3b. **PARKING EXCLUSION** (the real fix) — `detect_parking_stalls()` flags evenly-spaced,
   near-identical-length (stall depth 14-22ft), even-pitch parallel runs as parking and rejects
   them. This is what separates stalls from walls; the VLMs that can do it are too slow per-element.
4. **DEDUP** — `dedup_wall_faces()` collapses the two parallel FACES of one wall (perp within
   0.8ft, overlapping span) into a single centerline.

## Result (A-101 p8, lower stacked plan view band y35.8-117.7ft)
- 41,802 raw -> 1,005 prefiltered -> **187 candidate runs**.
- Rejected: **89 parking_stall** (regularity) + **3 spanning_grid**.
- Kept 95 runs -> dedup -> **66 verified wall centerlines** in ~40s.
- Output: `out/plan-walls.cooperative-1881-L1.json` (plan-ft) + `out/vote_log.json` +
  `out/overlay.png` (kept=green / rejected=red). Verified set written to
  `apps/autosprink/src/data/plan-walls.cooperative-1881-L1.json`.

## HONEST flags (read before trusting / next steps)
- The footprint band processed the **UPPER stacked plan view = the parking deck**. Before the
  parking-regularity gate, CubiCasa-alone kept the parking stalls as walls (reproduced the
  original bug). The regularity gate fixes that; remaining green in the parking area is mostly
  drive-aisle/curb edges + the central stair/elevator/restroom core (real partition walls).
- The **lower stacked plan view (rows B-A) = the real room block** was NOT in the processed band
  and is under-covered. Next: process BOTH stacked views via `splitStackedPlanViews` bands and
  label upper=parking-deck.
- **VLM throughput on this GPU**: qwen2.5vl:7b 150-320s/vision-inf (timed out at 320s under
  contention); gemma4:26b-a4b-it-qat ~250s; moondream fast but a yes-machine (no discrimination).
  Per-element VLM gating over 187+ candidates is impractical (~8-24h/wing). Hence CubiCasa +
  deterministic gates are the production path; VLMs are spot-validators only.
- Coordinate frame CONFIRMED identical to the app's served `wallRuns` (V perp-x values match
  recore exactly, no offset).
- Provenance: AUTONOMOUS proposal, `needsVerification:true`. NOT AHJ/PE/AutoSprink parity.
