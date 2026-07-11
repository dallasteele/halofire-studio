# HaloFire AutoBid — Polish + Non-Bid-Grade Improvement Plan
_2026-06-30 · grounded in the corpus backtest (brain ep72232/71696) · honest per-type expectations_

## Where we are (live-verified)
- **Open-retail = BID-GRADE end-to-end live** (pkg4 AutoZone: footprint 0.47% from the sheet's embedded CAD dims, 70-head per-room layout, grounded 3D, priced bid; badge EARNED via `confidence.gate_on_payload`).
- **All types**: live priced bids + 3D/geometry for indexed plan-sets + honest per-type confidence flags.
- **13R / grocery / ordinary-commercial = CLOSE-APPROX**, for two *measured* reasons:
  1. **Geometry residuals (REACHABLE from arch):** multi-plate footprint not yet OCR-anchored (only single open plates are); 13R parking-tier area attribution (bs405 +73%→ fixed page, residual area); open parking-podium base layout (bs9 −0.02).
  2. **Layout head DENSITY (design-from-arch CEILING):** grocery refrigeration/equipment clusters + restaurant kitchen zones are hazard/commodity-driven — that density lives in the **FP/spec, not the architectural plate** (proven across ~40 iters; raster glyph-OCR of podium labels measured dead). A uniform-grid close-approx is the honest best from arch alone.

## Part 1 — POLISH (all reachable; ultramode)
1. **Bid-grade badge in the ready-to-send LIST** — the list pre-computes confidence without resolving geometry, so it shows all close-approx. Fix: resolve geometry availability per ready item (or cache the earned flag) so the list reflects the earned badge. Never show bid-grade unless earned.
2. **Reconcile the 70-vs-61 head delta** — geometry-grounded per-room count (70) vs priced area-ceiling (61). Make the price consume the geometry-grounded head count when geometry is bid-grade (or surface both with the basis). Honest, not hidden.
3. **Onboard more open-retail jobs** — only AutoZone's plan-set is prewarmed on the VPS. Batch-onboard the other open-retail plan-sets (raster-sync + `prewarm_geometry.py` + verify each package earns bid-grade). The path is proven.

## Part 2 — NON-BID-GRADE CORRECTIONS (loops + plugins + tools)

### Tier 1 — Geometry / 3D CAD (REACHABLE from arch → push 13R + commercial footprint to bid-grade)
- **Generalize footprint-OCR to MULTI-PLATE / compartmentalized.** The text-layer overall-dimension read (`footprint_ocr.read_footprint_textlayer`) is the keystone that made open-retail bid-grade — currently scope-gated to single open plates. Extend it to per-level/compartmentalized plates (read each level's overall dims; sum with floor multipliers) → fixes 13R + commercial footprint over/under-read.
- **13R parking-tier area attribution** (bs405): separate dwelling floors from parking tiers in the gross-area reconcile.
- **Open parking-podium base layout** (bs9 −0.02): detect open/parking plates in a multi-floor stack and route them through the validated open-retail global grid (reuse, not new).
- **Gate:** re-run the corpus backtest; target 13R footprint ≤8% + head ≤12% + layout coherent → 13R toward bid-grade.
- **Tools:** `footprint_ocr` (text-layer), `geo_skill`/`geo_building`, `geo_kernel` (OpenSCAD 3D), the corpus harness `run_corpus_validation.py`.

### Tier 2 — Layout head DENSITY (the CEILING → needs data beyond the arch plate)
Two honest paths, both real capability (not grinding the arch):
- **(2a) FP-DIGITIZATION mode** — when a COMPLETED FP / sprinkler drawing IS available for a bid (re-bid, GC-provided, or a prior Halo Fire FP), DIGITIZE it directly: the dense-head detector already solved this (180→1393, strict 1:1 precision). This yields the EXACT head count + per-room layout for grocery/commercial **bypassing the arch-density ceiling**. Highest-value, already-proven detection.
- **(2b) FP/SPEC HAZARD-SCHEDULE INGEST** — for the from-arch case, OCR the fire-protection spec / hazard + commodity schedule (the text that defines OH-2 vs ESFR, refrigeration/storage commodity class) → hazard zones → per-zone density. This is where the density actually lives. Heavier; uses OCR + the spec corpus.
- **Honest expectation:** with (2a) or (2b), grocery/commercial can reach bid-grade; from the **arch plate alone** they remain close-approx (correctly flagged).

## Verification discipline (unchanged)
Every change: general procedure (no per-bid hacks; procedural-purity green; truth = scoring args), brain pre/post, eye-gate + live-gate with real evidence (curl the live URL / inspect the overlay), **bid-grade must be EARNED**, additive deploy, no-break, honest no-op beats a gameable fit.

## Sequencing
Polish (Part 1) → Tier-1 geometry loops (push 13R) → Tier-2 FP-digitization mode (unlock grocery/commercial where an FP exists) → spec-ingest (the from-arch density, last + heaviest). Checkpoint with live-verified evidence at each gate.

## Tier-1 geometry — iter1 (2026-06-30): OPEN PARKING-PODIUM BASE tier (lever 3) SHIPPED
**Target:** 13R bs405 (Kozo) footprint under-shoot.
**Diagnosis (MEASURED):** bs405 routes multi-floor with 5 detected dwelling levels (L2..L6). Their
summed wall-hull footprint = 217,916 sqft vs gross truth 271,094 (area_err 0.196 FAIL). The ~52k
shortfall is the PARKING-PODIUM BASE (Kozo LEVEL 00/01) the dwelling-plate picker correctly drops
(it is a "...SLAB"/"PARKING" plate with zero dwelling-unit tags). NOT a per-plate overall-dim
mis-read (the dwelling plates carry NO overall feet-inches dims in their text layer; the directive's
lever-1 textlayer-overall-dims does not apply to them, and raster-OCR overall-dims on compartment-
alized plates is documented to regress — see geo_skill.run_plan scope comment).
**Lever (3):** detect ONE base parking/podium/slab plate at level 0/1 BELOW the dwelling stack,
read its overall building footprint from the EMBEDDED TEXT LAYER (the proven footprint_ocr keystone
— Kozo LEVEL 00 "302'-0" x "173'-8" = 52,448 sqft, conf 0.92, EYE-GATED p87 = a real overall base
plate w/ column grid + perimeter dims), and add it as ONE SEPARATE OPEN light-hazard NFPA tier
(structured parking = one open occupancy). Self-gating + purity-safe: fires only on a multi-floor
dwelling stack with a confident text-layer base footprint; harness-only (run_corpus_validation.py),
no engine module touched (confidence.py md5 identical local↔VPS), procedural_purity 8/8 green.
**RESULT:** bs405 area_err 0.196 -> 0.0027 PASS (217,916 + 52,448 base = 270,364 vs 271,094);
head_err 0.318 -> 0.1996 (improved by the +252 base heads, still >0.12 — the residual is the
DWELLING-segmentation under-count, 0 unit-anchors read, a LAYOUT-leg lever for a later iter, not a
footprint lever). NO REGRESSION: bs9 13R base_tier=None (clean no-op, area 0.0011 PASS unchanged);
bs5 open-retail PASS all legs (bid-grade intact). Honest residual: bs405 head + bs9 layout remain.

## Tier-1 geometry — iter2 (2026-06-30): multi-word UNIT-N anchor lever = HONEST NO-OP (reverted)
**Target:** bs405 head_err 0.1996 (the only failing leg). **Lever:** read the architect's two-token
"UNIT 201" dwelling labels (Kozo convention) as segmentation anchors (0→201 anchors verified).
**Result:** best reachable head was 0.142 (still >0.12) and ONLY by regressing the passing layout
leg 0.9814→0.9177 (anchor-split segmentation makes less-plausible cells). Reverted byte-identical;
purity 8/8 green. **Lesson:** bs405 head is NOT an anchor-recall problem — the 5 detected dwelling
levels are all genuine UNIT-TYPES plates (the "p82 roof-sheet" guess was wrong), so the gap is
elsewhere. Honest no-op beats a fit that regresses a passing leg.

## Tier-1 geometry — iter3 (2026-06-30): PODIUM-FLOOR head replication SHIPPED — bs405 PASSES
**Target:** bs405 head_err 0.1996 (the single failing 13R leg).
**Diagnosis (MEASURED, corrects iter1/iter2):** bs405 is a 7-storey podium tower = 5 dwelling floors
(A-101.2..A-101.6, all real UNIT-TYPES plates, detected L2..L6) ON **TWO** structured-parking decks
(A-100.1 "SUB-LEVEL 00 / PARKING LOWER TIER", A-100.2 "LEVEL 01 / PARKING MID-TIER" — both eye-
confirmed in the set). The iter1 base tier counted the podium footprint ONCE (252 heads) but there
are two separately-sprinklered decks. Self-validating reconcile: 5 dwelling + 2 podium == 7 =
section_storeys; and podium_floors = lowest_dwell(2) − base_level(0) = 2.
**Lever:** in `_detect_levels`, derive `podium_floors = max(1, lowest_dwell − base_level)`, clamped to
`section_storeys − n_dwelling` when the section enumerated every storey; carry it on the base_plate.
In `_design_open_base_tier`, lay the open light-hazard grid `floors=podium_floors` so HEADS scale per
deck (252→504) while AREA stays ×1 (the decks share one footprint outline; the gross-sqft truth
counts it once, so area_err 0.0027 is preserved). Self-gating: podium_floors defaults to 1 = the
proven iter1 single-deck behavior (exact no-op); fires only on a genuine multi-deck podium stack.
Purity-safe + general: the building's OWN level/section datums, no plan key / truth number; harness-
only (run_corpus_validation.py), no engine module touched (confidence.py md5 e3f5d3… identical
local↔VPS), procedural_purity 8/8 green.
**RESULT (live pre/post, run_corpus_validation.py --no3d, truth=scoring args):** bs405 13R head_err
0.1996 → **0.0815 PASS** (designed 1708→1960 = 1456 dwelling + 504 podium vs truth 2134); area
0.0027 PASS unchanged, layout 0.9814 PASS unchanged (dwelling segmentation untouched), price in_band.
bs405 now PASSES ALL LEGS. **NO REGRESSION (full corpus 9-bid):** bs9 13R base_tier=None clean no-op
(all legs PASS, head 0.0092, layout 0.9704); bs5 open-retail PASS all legs (bid-grade INTACT); all
grocery/commercial base_tier=None → byte-identical to baseline (unchanged). 13R-dwelling 1/2 → **2/2
overall**; head_count leg 3/9 → 4/9. **Honest residual:** grocery/commercial geometry (non-podium,
no base tier) is unchanged — outside this lever's reachable scope.
