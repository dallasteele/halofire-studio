# HALOFIRE AUTOBID — MASTER BUILD FILE (Codex 5.6)

_2026-07-09 · authored by Claude (Fable 5) from the full project transcript, live production probes, the
code-cited critical audit (`E:/ClaudeBot/out/verification/CRITICAL_FINDINGS.md`), and the plan history
(`halofire-studio/docs/plans/HALOFIRE_NONBIDGRADE_IMPROVEMENT_PLAN.md`). Every claim below is
live-verified or code-cited — nothing inferred. This file is the single source of truth for the build._

---

## 0. MISSION (what "done" means)

Dentrix-grade **ops center** for Halo Fire Protection. AutoBid is **module 02 (Estimating) of the
20-module blueprint** in the GX10 master-brain vault (`/opt/hal9000/apps/claudebot/hal-vault/halofire-master/`
— read `00_SOFTWARE_BUILD_BLUEPRINT.md` first). The core promise the user is buying:

> **Client bid PDF in → REAL 3D CAD building model + walls-aware Bluebeam-clone sprinkler layout +
> priced bid out.** Historical bids are the ANSWER KEY for validation only — never the input.

The user's verdict on the current state (correct, verified by me on pixels): *"you are still failing to
build a correct 3d model from the pdf and failing to build the fire sprinkler layout on the pdf."*
The scalar spine works; the **spatial reconstruction does not exist yet**. That is the build.

---

## 1. VERIFIED WORKING — keep, do not regress (live evidence)

| Capability | Evidence |
|---|---|
| Pricing spine: corpus $/head calibration, comparables, in-band pricing | pkg4 $30,421.46, pkg9 $605,801.12 live; 41 OH-2 comparables median $498.71/head |
| Footprint sqft from embedded CAD text (`footprint_ocr.read_footprint_textlayer`) | AZAZ 7,899 vs actual 7,936 = **−0.47%**; the one genuinely-right spatial number |
| Proposal PDF deliverable | `GET /api/autobid/proposal/4` → 200, application/pdf, 6,282 B |
| OpenClaw governance conductor (`bid_governance.py`) | 69+ op-log records, `governed:true` on every package; `/governance/summary` live |
| Per-bid verification ensemble (`bid_verification.py`) | pkg4 `converged:true (2 pass/0 fail/1 unknown)` live; honest `unknown` for missing FP |
| Board + send review UI aggregation | badges/verification/governance pills live; pkg9 board row shows doc 34975 / 13R-dwelling (commit `ac90420e4`) |
| Corpus: workbook ledger COMPLETE | 5,924/5,924 accounted: 1,046 priced ∪ 4,794 confirmed-blank templates ∪ 72 missing ∪ 12 unsupported ∪ 1 lock (`workbook_parse_log`) |
| `spec_hazard` table (the density lever) | 294 rows mined from CSI Div-21 specs; e.g. Smith's grocery **0.39 gpm/ft² @ 2,000, Class IV >12 ft** — proof density lives in the SPEC, not the arch plate |
| 13R multi-floor engine (`building_levels.py`) | corpus 2/2 (bs9+bs405 all legs); pkg9 live close-approx with honest podium residual |
| Backtest harness | `run_corpus_validation.py` + `strict_posgate.py` (1:1 mutual-nearest); `backtest_registry` 106 FP-truth jobs |
| Master brain | 26 nodes, 7 cross-cutting `_INDEX` complete, zero dangling links to them |
| Frozen earned-only gate | `confidence.gate_on_payload` md5 `6f95fdac` — additive changes only, logic NEVER weakened |

---

## 2. VERIFIED BROKEN — the audit (code-cited; fix these)

Ranked, from `CRITICAL_FINDINGS.md` + my own pixel-level eye-gates. All confirmed on live packages
(refs 4 / 254 / 766 / 9).

**B1 — The bid-grade badge text is a false claim.** `confidence.py:59` says open-retail =
*"3D model + per-room layout + price recreated end-to-end from the plans."* Both spatial halves are
false for every open-retail bid: `layout_heads.py:576` discards the segmented rooms when
`force_open_room` fires (set by `api.py:1416 _is_open_retail` — the exact classification that earns the
badge), and the 3D has no rooms (B2). **Gate measures availability flags, not spatial correctness.**

**B2 — `model3d` is a massing box on EVERY bid.** `package.py:303 build_model3d` consumes only
`profile + one scalar sqft` — it never receives the real geometry computed in the SAME request.
`levelPlans[*].plan.rooms = []`, no walls field exists, on all 4 bids. The `api.py:2908` "GROUND THE 3D"
block patches **scalar counters** (`grounded_rooms=249`) while the render array stays empty — the
"scalar looks right, spatial model empty" pattern that fooled the gates for weeks.

**B3 — No walls anywhere, while a working extractor sits as DEAD CODE.** `vector_walls.py` (506 lines,
PDF-native vector wall extraction + room polygonization + its own eye-gate overlay) is **imported by
nothing**. Meanwhile `room_layout.segment_rooms` builds a raster wall mask internally and throws it
away; `PlateGeo` has no walls field at all.

**B4 — Multi-story collapse.** Cooperative = 8 real plates (A-101..A-108, 170k sqft) → `model3d.floors=1`,
one levelPlan, footprint = plate A-101 only (16.6k sqft).

**B5 — Open-retail room segmentation is broken (why `force_open_room` exists).** Raster CV reads
shelving/fixture ink as partitions: ref 254 = "12 rooms covering 15% of floor", ref 766 = "6 rooms/11%".
The bypass papers over the count at the cost of ever having a real layout.

**B6 — Wrong-sheet selection is SYSTEMIC.** `sheets.page_index` does **not** map to physical PDF page
order. Measured: AZAZ geometry ran on the S2.1 **foundation** plate; ref 766 on a **site plan**
(1″=20′ scale, "SITE PLAN GENERAL NOTES", true floor plan is physical p28); Cooperative page hints wrong
(energy-compliance sheet captioned as A-101; true A-101 = physical p43 of 337). Also ref 766's footprint
covers only ~72% of its building (missing office wing; printed width 217′-4″ vs extracted 157.5′).

**B7 — Head density can be ~2× off with no flag.** AZAZ actual bid: **134 heads (59 sqft/head)**;
system: 61-66 code-minimum (130 sqft/head) = **−54%**, price −21.5%. The density decision lives in the
spec/hazard judgment (see `spec_hazard`), not the arch plate. Honest ceiling — but it must be priced
from priors + flagged, not silently under-bid.

**B8 — `vector_walls.py`'s own defects (why it was shelved, ep69517).** Auto `plan_block` locator picks
the densest short-stroke blob = a tiny DETAIL VIEW (returned a 167 sqft "building" on AZAZ); rooms come
out as perimeter slivers (storefront bays); scale must be parsed, not guessed (AZAZ floor plan is
1/8″=1′-0″ → **9 pt/ft**; a wrong 18.5 guess wasted several passes). The extractor core is sound —
1,065 real wall segments with a forced block — the localization/calibration around it is not.

---

## 3. DRIFT AUDIT (what quietly diverged from intent)

1. **Two disjoint plan-comprehension pipelines.** Engine Python (`geo_skill`/`room_layout`, raster CV)
   AND studio Node (`plan-extract.js` on GX10/VPS driving the 1881 studio loader). Duplicated effort,
   neither correct. Must converge on ONE canonical BuildingModel.
2. **Computed-then-discarded geometry.** Real rooms are extracted per request, then `build_model3d`
   ignores them (B2). Wall masks computed, then dropped (B3). The wiring drifted, not just the algorithms.
3. **Gate semantics drift.** "Earned bid-grade" devolved to `geometry.available && room_layout.available`
   — availability, not correctness. Scalars (sqft 0.47%) masked a wrong spatial model for weeks.
4. **A working vector extractor was shelved in favor of worse raster CV** and the reason was never
   re-examined (the failure was in its plan-block locator, not the approach).
5. **DB index drift**: `sheets.page_index` ≠ physical page order; sheet-type classifier mislabels
   (site plan tagged floor_plan). Root cause behind the whole wrong-sheet bug class (B6).
6. **Doc-binding drift**: `bid_summary.document_id` binds the pricing workbook; geometry resolves the
   job-sibling plan-set (277→279); board vs package ref namespaces differed (pkg9 fixed `ac90420e4`).
7. **Untracked-file drift** (recurring scar): engine + studio UI files lived only on the VPS / disk,
   un-committed. Rule: commit every session (`dde0c53`, `26ca128bb` recovered such work).
8. **Model routing drift in orchestration** (fixed, keep enforced): workers silently inherited the
   orchestrator model. Rule: `var CODER='sonnet'` on every worker `agent()`; Fable/Opus orchestrate only.
9. **Vault drift**: local `E:\ClaudeBot\hal-vault` is DEAD; GX10 vault is canonical.

---

## 4. PROVEN DEAD ENDS — do NOT rebuild these (measured, multiple sessions)

- **Raster-CV wall/room extraction from rasterized sheets.** Picks wrong sheets, invents phantom rooms
  from gridlines/shelving, never yields walls. ~40+ iterations across sessions. Dead.
- **Designing grocery/commercial head density from the arch plate alone.** ~40 iterations, measured
  impossible — the density is a spec/commodity decision (CSI Div-21). Use `spec_hazard` + comparables.
- **Learned FP glyph classifier at current data scale.** 11+ honest iterations; held-out gate
  (recall≥95/precision≥90/zero-fab) never met. Do not retry without materially new training data.
- **Raster glyph-OCR of podium labels** — measured dead. **Single-VLM-vote on busy crops** — auto-reject.
- **Bar-chasing levers that regress passing legs** (bs405 anchor lever lesson): honest no-op beats a fit.

---

## 5. NOVELTY REQUIRED — the actual build (ranked)

### N1 (P0) — Vector-first plan comprehension (the keystone)
Walls exist in the PDF CAD vector layer (`fitz page.get_drawings()`) — proven on AZAZ (envelope +
partitions + storefront recovered where raster CV read a foundation slab). Build the production
extractor around the existing `vector_walls.py` core with these four novel fixes:
- **Scale = parsed, never guessed.** Read the printed scale under the view title (`1/8"=1'-0"` → 9 pt/ft)
  AND verify against a printed overall-dimension chain (the `footprint_ocr` text-layer read). The two
  independent reads must agree within 2% or the plate is flagged, not processed.
- **Viewport located by WALL-NETWORK, not stroke density.** The floor-plan view = the largest connected
  component of the merged wall network / largest closed wall loop, cross-checked with the view-title
  text block ("FLOOR PLAN" + scale). Kills the detail-view/site-plan/foundation-sheet failures (B6, B8).
- **Multi-signal wall classification.** solid-vs-dashed + stroke-width band + **wall-pair** (parallel
  3-12″ apart) + colinear merge across door/storefront gaps + dimension-line rejection (tick marks +
  adjacent dimension text). No single signal suffices — measured (width alone keeps evac arrows;
  pairs alone drop single-line partitions).
- **Rooms = closed faces of the merged wall network** (polygonization), not CV components. Open floor →
  one big face + real sub-rooms (restrooms/office) — which also retires `force_open_room` honestly (B5).

**GATE (hard, per plate):** overlay walls/rooms on the raster; wall-ink recall ≥90% of structural ink,
zero phantom rooms, footprint within ±5% of the printed dims, rooms match the drawing BY EYE. The
overlay PNG is stored as an artifact on the bid and surfaced in the review UI. **A scalar match alone
NEVER passes.**

### N2 — Wire real geometry into `model3d`
`build_model3d` must consume `geometry_block["plates"]` (+ N1 walls): one `levelPlans[]` entry per real
plate (Cooperative = 8), `plan.rooms` + `plan.walls` populated, floors from `n_floors`. Delete the
scalar-patch block or make it derive from the real arrays. The studio 3D then renders an actual building.

### N3 — Walls-aware sprinkler layout
Heads clipped to the envelope polygon (never outside — currently they spill), per-room placement where
partitions exist (small-room NFPA rules), open-floor single grid retained where the wall network proves
the floor is open (now a *derived* fact, not a classification bypass). Pipe routing respects walls.

### N4 — Honest gate v2 + truth-in-labeling (DO FIRST, it's cheap)
Immediately: fix `confidence.py:59` note to the truth ("footprint-verified uniform NFPA grid; not yet
room-aware"). Then: bid-grade requires the N1 overlay gate passed + stored artifact. Availability flags
alone can never earn the badge again.

### N5 — Density priors (closes the −54% class)
Per-bid design density resolved in order: (1) `spec_hazard` row for the job (Div-21 spec, e.g. 0.39
grocery storage); (2) corpus comparables prior by chain/building-type (AutoZone cluster ≈ 59 sqft/head —
the corpus already knows this); (3) code minimum WITH an explicit "density unconfirmed — verify vs spec"
qualifier on the bid. Provenance on every density choice. Re-gate on corpus head_err.

### N6 — FP vector-symbol digitization (novel, untried, likely unlock)
Completed FP sheets are ALSO vector PDFs: sprinkler heads are **repeated identical vector glyph groups**
(CAD blocks). Match repeated sub-path clusters in `get_drawings()` output (exact-geometry fingerprints)
instead of raster CV. This sidesteps everything that killed the raster classifier and could crack
grocery/commercial takeoff on the 106 FP-truth jobs. Gate on `strict_posgate` (recall/precision,
zero fabrication) exactly as before.

### N7 — Sheet-index repair (unblocks everything)
Rebuild the `sheets` table: physical page order, sheet label + title + printed scale read from each
page's text layer, discipline classification (ARCH FLOOR PLAN vs foundation/site/roof/elevation/
schedule/energy). One migration script + re-index; fixes the B6 bug class everywhere at once.

### N8 — Pipeline unification
One canonical BuildingModel (walls/rooms/floors/heads, plan-feet) produced by the engine, consumed by
package/model3d/studio_drawing AND the studio front-end. `plan-extract.js` becomes a renderer or is
retired. No second extraction pipeline.

---

## 6. BUILD PLAN (phases, each with a hard gate — do not proceed on a failed gate)

| Phase | Work | Gate (evidence required) |
|---|---|---|
| **0** | N4-lite (truth-in-labeling) + N7 (sheet-index repair) | Badge text honest in prod; AZAZ/254/766/Cooperative all resolve the correct physical floor-plan page from the DB |
| **1** | N1 on AZAZ until the overlay is RIGHT, then hold on 766 (must recover the missing office wing / full 217′-4″), 254, Cooperative A-101 | Per-plate overlay gate (recall ≥90%, phantom=0, footprint ±5% of printed dims) + human eye-gate on the stored overlay |
| **2** | N2 model3d wiring | Studio 3D shows walls+rooms matching the overlay; Cooperative renders 8 floors; `levelPlans[*].plan.rooms` non-empty for every geometry bid |
| **3** | N3 layout + N4 gate v2 | Zero heads outside envelope; per-room placement where partitions exist; bid-grade re-earned ONLY through the overlay gate (expect a temporary honest downgrade of current bid-grade bids) |
| **4** | N5 density priors | Corpus backtest head_err: AZAZ-class bids within band of actuals (134-class, not 61); every density has provenance |
| **5** | N6 FP vector-symbol digitization | strict_posgate on held-out FP-truth jobs: recall ≥95%, precision ≥90%, zero fabrication |
| **6** | N8 unification + end-to-end acceptance walk | Full live flow (board → open → 3D/layout/price/verification/governance → send) with real per-bid overlays visible in the review UI |

**Working loop for every phase:** build → generate overlay → measure against the real drawing →
eye-gate the pixels → fix → repeat. Never gate on a scalar. Never claim done without the overlay.

---

## 7. INVARIANTS (non-negotiable, from AGENTIC_RULES + standing user directives)

1. **No guessing.** Unknown → typed blocker/qualifier, never a fabricated value.
2. **Procedural purity green** (`engine/test_procedural_purity.py`): truth numbers enter ONLY as scoring
   args; no plan key / bid name / truth number in extraction/layout/price logic.
3. **Frozen gate**: `confidence.gate_on_payload` logic is never weakened; additions are additive.
4. **Deploy discipline**: ADDITIVE, backup first, md5-verify, restart, live-curl verify. VPS
   187.124.234.28 (`halofire-autobid.service` engine :8770, `halofire.service` studio). Never break the
   live open-retail path. Single trunk (origin/main for studio; commit engine work IMMEDIATELY).
5. **Verification = loops with evidence** in the product AND in the process; the overlay artifact is
   the gate. Eye-gate on real pixels (Playwright headless renders fine — claude-in-chrome chokes on
   >1.5 MB pages).
6. **Model routing**: coding workers = Sonnet 5 (`model:'sonnet'`); Fable 5 / Opus 4.8 orchestrate only.
7. **Local + free only**: qwen3:30b-a3b for local LLM (numCtx 12288, think:false under JSON), no paid
   APIs, OAuth only. Torch on the RTX 4090 for any training.
8. **Brain pre/postflight** every task (GX10 hal-brain :8790); Egnyte Y: is read-only, work off-drive.
9. **Honest no-op beats a gameable fit.** Every downgrade in reported capability that reflects reality
   is a WIN, not a regression (expect Phase 3 to downgrade badges before re-earning them).

---

## 8. KEY PATHS, FIXTURES, ANSWER KEYS

**Engine:** `E:\ClaudeBot\halofire-autobid\engine\` — `api.py` (FastAPI :8770; `/package/{ref}`,
`/geometry`, `/layout`, `/proposal/{ref}`, `/ready-to-send`, `/governance/*`), `package.py`
(`build_model3d` — B2 fix site), `confidence.py` (frozen gate + B1 note), `layout_heads.py`
(`force_open_room` B1/B5), `room_layout.py` (`segment_rooms`), `geo_building.py` (`PlateGeo` — needs
walls field), **`vector_walls.py` (the dead-code extractor to resurrect)**, `footprint_ocr.py`
(text-layer keystone), `building_levels.py` (13R), `bid_governance.py`, `bid_verification.py`,
`hazard_density_lookup.py`, `geometry_cache.py`.
**DB:** `halofire-autobid/db/halofire_bids.db` — `bid_summary` (answer keys), `documents`, `sheets`
(page_index BROKEN, N7), `spec_hazard` (294), `workbook_parse_log`, `backtest_registry` (106),
`ready_bids`. **Dev login:** `python scripts/halofire_login.py` (dev-agent@halofire.local) → cookie jar
`%TEMP%\halofire_session.cookie`. **Live:** https://halofire.rankempire.io (Cloudflare 120s edge timeout).

**Answer keys (system must NEVER see these as inputs):**
- **AZAZ / AutoZone (ref 4, workbook doc 277, plan-set doc 279):** 7,936 sqft · **134 heads** ·
  $38,753.63 · $289.21/head sell · 175 man-hrs · 33.3%/25% markup/margin. Arch PDF:
  `Y:\...\7B Building & Development\AZAZ Surprise AZ\Fire Sprinkler\1-Bid Documents\GC - Bid Plans\Building\Autozone Surprise COMBINED SET 02.12.26.pdf`
  — **physical page 1 = sheet A-1 floor plan, 1/8″=1′-0″ (9 pt/ft), 37,687 vector paths.**
- **Cooperative 1881 (ref 9, doc 34975/34978):** 170,654 sqft · 1,420 heads · $538,792.35 · 8 plates;
  true A-101 = **physical page 43 of 337** in `theCooperative - Bid Set 6.12.25.pdf`.
- **Ref 254 Point S:** floor plan = physical p56 ("MAIN LEVEL FLOOR PLAN", label "A1", 1/8″).
  **Ref 766 Les Schwab:** floor plan = physical p28 ("GROUND FLOOR PLAN"); printed width 217′-4″
  (current extraction gets 72% — the acceptance test for N1's wing recovery).

**Proof artifacts (the honest baseline to beat):** `halofire-autobid/out/verification/azaz_bid_view.html`
(the user-facing honest bid view), `wall_proof_azaz.html` (raster-CV fail vs vector win),
`E:/ClaudeBot/out/verification/CRITICAL_FINDINGS.md` + `haloFire_CRITICAL_diagnostic.html` (4-bid FAIL
scorecards), `haloFire_bid_verification.html` (system-vs-actual with charts).

---

## 9. WHAT TO TELL THE USER WHEN REPORTING

Show the overlay, not adjectives. Per bid: the real plan, the reconstruction on it, the delta table vs
the Halo Fire actual, and a PASS/PARTIAL/FAIL per component. The user has caught overclaiming
repeatedly ("you keep calling shit work good") — the only acceptable report is one they can verify
with their own eyes in an HTML. Build that reporting INTO the pipeline (per-bid overlay artifact in the
review UI), not as an afterthought.

---

## 10. CODEX CONTINUATION EVIDENCE — 2026-07-10

The continuation work remains deliberately below the completion bar:

- `c01e68092` isolates every held-out equivalent summary from the truth-free
  density fit; `1699922fb` adds a runnable `--density-only` evaluator that reads
  only indexed scalar `sqft`, never carries geometry, and reports
  `bid_grade_eligible=false`.
- The real eight-fold density-only run is now scoreable without leakage:
  **4/8 within 12%, mean absolute error 18.9933%, max 49.5238%**. AZAZ,
  Walmart 1280, Circle K, and Kozo remain out of band. Truth-safe nearest,
  bucket, quantile, chain, and blend simulations did not improve this result;
  no heuristic was promoted.
- `f032e2724`, `a96a1a8ab`, and Studio `8e73ab3` retain and surface registered
  source viewport provenance (upper/lower roles, dimensions, transforms) beside
  the stored overlay. `df2079dff` rejects non-estimator/admin spatial-review
  roles at the engine boundary.
- `251542e58` adds a truth-free FP review bundle: co-located vector paint variants
  are grouped, disjoint families remain separate, and a hash-bound multi-color
  overlay is rendered for eye review. A real Walmart FP2.1 probe produced four
  review groups (364, 364, 159, and 119 centers; 1,006 markers) that visibly land
  on repeated plan symbols. Semantic head classification and strict held-out
  scoring remain **not attempted**; the bundle is not a count and cannot clear a
  gate.
- Focused evidence is green, but the requirement audit is still open: canonical
  Cooperative overlays have no trusted human review rows, real held-out density
  accuracy is not met, N6 semantic scoring remains unearned, and the VPS
  engine/Studio are stale. No production mutation was authorized or performed.

## 11. CODEX CONTINUATION EVIDENCE — 2026-07-10 (FP REVIEW SURFACE)

- Root `251542e58` now has a separate `fp_vector_review_store.py` contract. A
  producer must bind a truth-free bundle to `document_id`, `page_index`, the
  exact physical page, sheet label, and source PDF SHA-256 before it is visible
  to an estimator. Bundle and PNG bytes are content-addressed and integrity
  checked; a replacement supersedes the old page artifact.
- The engine exposes immutable `/fp-vector-artifacts/{id}/overlay.png` and
  `/bundle.json` routes and adds a package-level `fp_vector_review` projection.
  It is explicitly `review_only=true`, `semantic_classification=not_attempted`,
  and `gate_status=not_scored`; it is not read by `spatial_verification`,
  confidence, model3d grounding, or accepted-layout code.
- Studio `autobid-send.html` now renders document-bound FP candidate overlays
  with physical-page identity, source digest, and a truth-free bundle link. The
  panel exposes a separate trusted semantic-review control and states that it
  cannot clear spatial or bid-grade gates. The unrelated local
  `apps/autosprink/src/api/server.js` modification remains untouched.
- New engine/API tests plus the existing spatial/vector suite pass **66 tests**;
  Studio static checks pass **29 tests**. This proves visibility and isolation,
  not semantic head-count accuracy. At that checkpoint no canonical FP artifact
  was bound and no reviewer row was fabricated; the later local Walmart binding
  and review-loop evidence are recorded below. No deploy was performed.

## 12. CODEX CONTINUATION EVIDENCE — 2026-07-10 (TRUSTED FP REVIEW LOOP)

- Root `ea821d393` corrected the FP review store root. The default API now points
  at `out/`, matching stored `fp-vector-review/<artifact>/...` relpaths; the
  real Walmart FP-2.1 bundle is served locally with immutable 200 responses for
  both bundle JSON (46,419 bytes) and overlay PNG (726,401 bytes).
- Root `494dedefb` normalizes Cooperative A-101 registered viewport transforms
  into the composite frame while preserving raw registration transforms and the
  composite origin. Real physical page 44 extraction now reports two localized
  views, a registered 340.1 x 60.0 ft composite, and 0.000425 ft registration
  residual; the inspected overlay visibly covers both upper and lower views.
- Root `a23472d46` and `2edc4a2ca` add the strict, source-bound reviewed-FP head
  evidence contract. Root `526cda756` persists trusted estimator/admin semantic
  reviews with artifact/page/hash binding and exposes them at the separate
  `/package/{ref}/fp-vector-review` route. Accepted reviews can emit
  `project_overlay_evidence`; they never mutate `spatial_verification`, model3d,
  or bid-grade automatically. No count was entered for the Walmart artifact.
- Studio `1c6d257` adds the estimator browser flow. An authenticated browser
  smoke against package ref 234 (Walmart workbook doc 108566 -> FP sibling doc
  108569) rendered and decoded the real FP-2.1 overlay, showed physical page 1,
  and exposed semantic review controls. Viewer role denial and estimator
  missing-count fail-closed checks returned 403 and 422 respectively.
- Full engine suite: **748 passed, 10 skipped**. Focused review/evidence tests:
  **25 passed**. Studio spatial/FP browser/static loop: **9 passed**. Rule
  verifier and compileall pass. The FP semantic count remains unaccepted and
  N6 held-out scoring remains unearned; no deploy was performed.

## 13. CODEX CONTINUATION EVIDENCE — 2026-07-10 (PRODUCTION SIDECAR + 8-FLOOR REPAIR)

- Root `8cb1a782b` wires one-and-only-one current accepted FP review into a
  `density_resolution` sidecar on `/layout` and `/package`. Multiple accepted
  pages, missing review, or integrity failure remain explicit residuals. The
  sidecar is `diagnostic_only_code_spacing_unchanged`: it does not re-price,
  alter NFPA spacing, clear spatial/model3d gates, or promote bid-grade.
- Root `89d01ec13` applies deterministic Shapely `make_valid` splitting to
  ordinary accepted plates, not only disjoint bundles. Copied-DB Cooperative
  end-to-end evidence now shows all 8 levels model3d-grounded, accepted layout
  passed, accepted drawing available on all 8 plates, and outside-head count 0;
  per-level head counts were 226, 211, 241, 266, 237, 328, 266, and 269.
- Root `21b5040f7` adds an explicit repaired-room-to-accepted-layout regression;
  the schema/layout focus now passes **18** tests. Studio `371beef` surfaces the
  density sidecar in the estimator panel with its diagnostic-only semantics.
- Focused repair tests pass **56**; production-wiring tests pass **2** plus the
  relevant regression suite (**162**). The live canonical package remains
  correctly fail-closed because no trusted Cooperative review rows exist.

## 14. CODEX CONTINUATION EVIDENCE — 2026-07-10 (BROAD VERIFICATION)

- Root `4543d9ec7` records the accepted copied-DB geometry evidence without
  changing the canonical database. The full root engine suite now passes
  **751 tests**, with **10 skipped** and **4 warnings** under the canonical
  `C:/Python312/python.exe` runtime. Studio `371beef`/`f9bba98` is green at
  **10 tests** across the spatial/FP browser/static loop.
- `verify_agentic_rules.py`, `agent_loop_guard.py validate`, and compileall
  pass. The local engine health endpoint reports the expected Python 3.12
  runtime and the live Walmart package still exposes an available,
  immutable FP artifact while its semantic review is explicitly `missing` and
  density remains diagnostic-only.
- Copied-DB Cooperative evidence remains simulation-only: all eight levels
  are grounded and layout/drawing gates pass with outside-head count zero.
  The canonical DB still has no trusted semantic FP or Cooperative spatial
  review rows. Held-out density remains **4/8 within 12%**; GX10 formal prover
  health is unavailable; VPS deployment is stale and unauthorized. The master
  goal therefore remains open and no production bid-grade claim is made.

## 15. CODEX CONTINUATION EVIDENCE — 2026-07-10 (REVIEWER PROXY + DENSITY CANDIDATE)

- Studio `4bda968` adds an authenticated FP semantic-review proxy smoke. The
  upstream receives the verified JWT identity (`Real Estimator`, `estimator`),
  client-forged reviewer headers are replaced, and a read-only user remains
  fail-closed even when forging admin headers. The focused proxy test passes
  **4/4**; the engine FP review/API/store focus passes **13/13**. No source
  server file or canonical review row was changed.
- Root `1b6070257` persists that truth-free log-space MAD outlier-rejection
  candidate in an isolated, non-production audit module. Held-out density moves
  from **4/8** and 18.9933% MAE to **5/8** and **17.9458% MAE**. The persisted
  artifact contains no answer-key fields; AZAZ, Circle K, and Kozo remain
  materially out of band, so the candidate is not promoted and N5 remains open.
- The proxy evidence strengthens the trusted-reviewer boundary, but it does
  not itself create a human review. Canonical FP semantic and Cooperative
  spatial reviews remain absent; N6 strict vector-symbol scoring, the GX10
  formal proof lane, and deployment acceptance remain unearned.

## 16. CODEX CONTINUATION EVIDENCE — 2026-07-10 (N6 VECTOR PROBE)

- Root `37ae8aefa` persists the reusable probe artifact
  `out/corpus_backtest/fp-vector-repeat-fingerprint-probe.v1.json`. The
  truth-free held-out vector scan covers six FP artifacts. Repeated-glyph
  fingerprints nominate review candidates, but every artifact remains
  `semantic_classification=not_attempted` / `gate_status=not_scored`.
  The persisted blockers are explicit: no held-out truth-point binding, no
  strict-posgate wiring to vector candidates, and family-budget truncation.
- A fresh bounded Winco scan retained 512 families with truncation warnings;
  top consensus groups varied from 236/230/211/58 markers. Walmart's top
  family had 364 markers and Circle K's candidate support was only 0.8077.
  These are candidate markers, not head counts. N6 remains unearned and no
  semantic review or production gate was changed.
- Expanded focused verification is green: **71 engine tests** and **13 Studio
  tests**. This verifies isolation and review visibility, not N5/N6 acceptance.

## 17. CODEX CONTINUATION EVIDENCE — 2026-07-10 (POST-CHANGE REGRESSION)

- The post-change root engine run passes **755 tests**, skips **10**, and emits
  **4 warnings**. Compileall, rule verification, and loop-contract validation
  remain green.
- The focused AutoBid browser/proxy loop passes **14/14** (spatial review,
  FP overlay, FP semantic-review proxy, and send-panel checks). The broad Studio
  run reached **1,540 passed / 24 failed** across 152 files; all 24 failures
  are existing Workbench/shell browser or static-surface failures in the
  unrelated dirty Studio UI (`#projectTarget`/resolver selectors and a glass
  style assertion), not the AutoBid review lane. They remain visible blockers
  for a clean whole-Studio claim and were not altered in this slice.
- No deployment was performed. The master objective remains open: canonical
  human review rows, N5/N6 acceptance, clean whole-Studio runtime, formal proof,
  and authorized deployment are still required.

## 18. CODEX CONTINUATION EVIDENCE — 2026-07-10 (CANONICAL ACCEPTANCE AUDIT)

- Live package ref `234` remains correctly fail-closed: workbook document
  `108566`, geometry document `108569`, one immutable FP artifact, zero FP
  semantic-review rows, zero spatial-review rows, and no accepted geometry
  level mapping. `model3d.geometry_grounded=false` with
  `accepted_level_mapping_missing`.
- Direct engine review writes reject missing identity with **401** and an
  untrusted role with **403**. The exact next manual gate is an estimator/admin
  visual review of the stored Walmart FP-2.1 overlay, followed by the Studio
  proxy POST with verified identity, hash echoes, and a human-confirmed positive
  head count. No count was injected or trusted.

## 19. CODEX CONTINUATION EVIDENCE — 2026-07-10 (WORKBENCH MISMATCH ROOT CAUSE)

- The 24 broad Studio failures are a proven route/test mismatch, not an
  AutoBid regression: live `/workbench.html` is the intentionally swapped
  `HaloFire · Today` dashboard from `af2c13d` and lacks `#projectTarget`,
  `#resolverQueue`, and legacy official-flow sections. `/official-flow.html`
  contains those selectors. Redirecting or duplicating that workflow in
  `workbench.html` would be a broad semantic change, and the current dirty
  `autosprink.html`, `index.html`, styles, and `server.js` are explicitly out
  of scope for this continuation. The exact clean-runtime mismatch is recorded
  rather than hidden by weakening or retargeting tests.

## 20. CODEX CONTINUATION EVIDENCE — 2026-07-10 (N6 FAMILY EYE-GATE SURFACE)

- Root `38049a4e7` adds a separate strict family-review contract/store and
  `POST /package/{ref}/fp-vector-family-review`. It binds artifact, document,
  page/physical-page, bundle/overlay hashes, family ID, and verified estimator/
  admin identity. It has no `head_count` field and emits
  `semantic_classification=not_attempted`, `gate_status=not_scored`, and
  `production_gate_effect=none`.
- The restarted engine exposes **4** truth-free candidate families for Walmart
  artifact `8ad8…`, with **0** family decisions and density review still
  `missing`. Studio `2bb101c` displays family IDs, anchor/support IDs,
  occurrence counts, co-location support, and eye-gate status beside the
  source/hash context; its focused browser/static checks pass **9** tests.
- Full engine regression after the slice: **768 passed, 10 skipped, 4 warnings**.
  This prepares the human semantic decision but does not score N6 or clear any
  production gate.

## 21. CODEX CONTINUATION EVIDENCE — 2026-07-10 (ESTIMATOR FAMILY DECISION CONTROL)

- Studio `808cec7`/`d95f20a` completes the estimator action surface. Each verified family
  group now has Accept/Reject controls, persisted reviewer/role/decision state,
  overlay-decode gating, and a POST carrying artifact ID, page/physical-page,
  family ID, bundle hash, overlay hash, and note. The correction preserves
  workbook ref `234` while resolving sibling geometry document `108569`.
- The UI still labels the family lane `not_attempted` / `not_scored`; it never
  accepts a head count or clears spatial/model3d/bid-grade gates. Focused static
  coverage remains **8 passed**, and the live browser smoke now verifies the
  family controls and candidate context (**1/1**). A real trusted human decision
  is still required before N6 scoring can begin.

## 22. CODEX CONTINUATION EVIDENCE — 2026-07-10 (N6 SCORING-ONLY BRIDGE)

- Root `825352f77` adds a scoring-only bridge from an accepted family review to
  `score_candidate_family`. It persists a truth-free candidate artifact with a
  content identity, frozen centers, source/page/hash/reviewer binding, then
  accepts authoritative held-out truth points only in the explicit scoring
  function. Missing/rejected/ambiguous family reviews, tampering, and absent
  truth fail closed.
- The bridge cannot be called by production package/layout/model3d paths and
  does not mutate N6 or bid-grade state. Its adversarial scoring focus passes
  **5 tests** (combined FP family/vector focus: **35 passed**). N6 remains
  unearned until real held-out truth-point bindings and an accepted family
  review exist.

## 23. CODEX CONTINUATION EVIDENCE — 2026-07-10 (N5 SOURCE-BOUND EVIDENCE)

- Root `074bdb854` adds a strict, frozen external Division-21 evidence contract
  and a truth-free density audit. Evidence is bound to document ID, physical
  page, source SHA, source path/snippet, reviewer identity/role, hazard class,
  hydraulic density, and remote area. Hydraulic gpm/sqft and remote-area
  values are never converted into layout sqft/head without explicit reviewed
  layout evidence; all absent or ambiguous evidence remains
  `production_eligible=false`.
- The canonical audit confirms **0 trusted numeric `spec_hazard` rows** for all
  four held-out targets: AZAZ job 4, Circle K job 1999, Kozo job 1143, and
  Walmart job 622. The audit persists this absence and fails closed rather
  than manufacturing a density answer. Focused adversarial coverage passes
  **5 tests**.
- Studio `b304caa` now exposes hydraulic spec status/source/document/page/path
  and every density qualifier in the estimator panel, including the missing
  same-job Division-21 qualifier. The panel remains explicitly
  diagnostic-only: it cannot alter spacing, pricing, spatial/model3d
  acceptance, or bid-grade. Focused static coverage remains **8 passed**.
- N5 remains open until trusted source-bound held-out evidence is actually
  available and meets the frozen 12% accuracy gate. No database rows,
  reviewer decisions, or production gates were fabricated or changed.

## 24. CODEX CONTINUATION EVIDENCE — 2026-07-10 (SOURCE PROBE, IDENTITY, A-101 REVIEW)

- Root `c0b92f6fd` adds a read-only source-bound density probe. It hashes every
  scanned PDF, binds page/physical-page findings and snippets, supports common
  PDF unit spellings, and emits no head truth, answer-key fields, DB writes, or
  production eligibility. The real held-out report
  `source-bound-density-heldout.v1.json` scanned 18 documents and produced 21
  findings with **0 numeric density candidates** and 18 explicit blockers:
  AZAZ, Circle K, Kozo, and Walmart source documents do not expose a trusted
  numeric Division-21 density in their text layers. This is an evidence-bound
  absence, not a fallback answer.
- Root `d01a5d681` hardens the spatial review boundary. Accepted overlay rows
  require estimator/admin identity at the store layer, and legacy accepted rows
  with missing/invalid identity are projected as untrusted and cannot clear the
  spatial gate. Focused store/service/API coverage is **39 passed**; no
  production review rows were fabricated.
- Root `a709cd311` recovers legacy Cooperative composite viewport provenance
  deterministically from registered block IDs and source-Y order. The real
  A-101 artifact is page index **43** / physical PDF page **44**, with upper
  `network-0` source bbox `[288,178,1464,704]` and lower `network-1` source bbox
  `[494,932,2250,1458]`; registration residual is **0.000425 ft**.
- Studio `5e756fb` exposes that zero-based/physical mapping, viewport bounds,
  and a zoomable stored source-PDF/derived-geometry review frame. Static and
  browser coverage is **8 + 1 passed**, with the rendered frame at
  `out/agent-loops/halofire-master-build-20260710/evidence/a101-overlay-review-frame.png`.
- The running `8770` process is stale relative to `a709cd311`; it must be
  restarted before treating the recovered projection as live. N5/N6 and
  production acceptance remain open: no trusted human FP-family/spatial review,
  held-out density score, or formal prover/deployment proof exists.

## 25. CODEX CONTINUATION EVIDENCE — 2026-07-10 (EXPLICIT LAYOUT PROBE)

- Root `79b5b9766` extends the read-only density probe to recognize explicit
  source statements such as `sq ft per sprinkler/head` separately from
  hydraulic gpm/sqft. It still emits only source-bound candidates and never
  promotes a value to the layout prior or production gate.
- The real-source v2 report
  `source-bound-density-heldout.v2.json` remains **18 documents / 21 findings /
  18 blockers / 0 numeric hydraulic candidates / 0 explicit layout candidates**
  across AZAZ, Circle K, Kozo, and Walmart. Focused probe coverage is **6
  passed**; all density-focused tests remain **38 passed**.

## 26. CODEX CONTINUATION EVIDENCE — 2026-07-10 (MODEL3D, ROUTE, DEPLOYMENT PROOF)

- Root `e7338c0fb` makes accepted-vector geometry consumable by downstream 3D/CAD
  clients through validated per-floor `plan.walls` and `plan.rooms` aliases,
  while `7ac0cb218` proves machine-passed but human-pending overlays remain
  ungrounded with empty generic geometry. The focused model3d/spatial boundary
  passes **33 tests**; canonical Cooperative geometry remains correctly
  `geometry_grounded=false` until human review.
- Studio `0df4df0` makes the dashboard-to-estimator route contract explicit:
  `/workbench.html` visibly hands off to `/official-flow.html` while preserving
  project/hash context. A browser smoke proves the handoff and required review
  selectors (**1 passed**) without hiding the known route mismatch.
- Root `ee58af269` adds a typed fail-closed runtime/deployment proof. The live
  artifact records AutoBid `8770` healthy, Studio `3210` refused, formal prover
  `8810` refused, verified source HEAD, no deployment authorization, and
  `deployment_performed=false`; focused proof coverage passes **4 tests**.

## 27. CODEX CONTINUATION EVIDENCE — 2026-07-10 (RUNTIME PROOF HARDENING)

- Runtime proof follow-ups `579e011f3` and `a2119e69e` preserve the canonical
  Studio `/api/health` contract (which has no `service` field), treat HTTP
  404/5xx as a typed health-contract failure distinct from connection refusal,
  and reject malformed source identities without raising. Focused proof
  coverage is **6 passed** and the full engine suite is **788 passed, 10
  skipped, 4 warnings**.
- The v3 live artifact records AutoBid `8770` HTTP 200, local Studio `3210`
  refused, formal prover `8810` refused, remote prover endpoint HTTP 404 (not
  the required contract), public Studio health reachable but not a local
  deployment proof, missing authorization, and hard-coded
  `deployment_performed=false`. Overall status remains **blocked**.

## 28. CODEX CONTINUATION EVIDENCE — 2026-07-10 (FINAL RUNTIME BINDING)

- Root `fedc7c712` completes the runtime proof boundary: the source commit is
  accepted only when the supplied identity exactly matches `git rev-parse
  HEAD`; malformed or mismatched identities are typed blockers, and the CLI
  cannot enable deployment authorization. Focused runtime coverage is **7
  passed**; the full engine suite is **790 passed, 10 skipped, 4 warnings**.
- Final proof artifact `runtime-deployment-proof-20260710T1200Z-v4.json`
  (`proof_id=4594c07157585a7f412dc8ec46d7b480b7823145f951e76ad24934259e16690d`)
  records engine healthy, Studio/prover unavailable, source identity verified,
  authorization absent, and `deployment_performed=false`. The master-build
  remains open at those external gates and at trusted human FP/spatial review.

## 29. CODEX CONTINUATION EVIDENCE — 2026-07-10 (CURRENT-HEAD PROOF REFRESH)

- After the evidence commits advanced the checkout, the runtime proof was
  regenerated against the actual current HEAD `07915f8228b0177f0313dd417bda8d1f35886b3e`.
  Artifact `runtime-deployment-proof-20260710T1300Z-v5.json` has proof ID
  `fa6aa56ef63cf4f61a211a1a022b2aa565a8b505bd346f3969afd760801e16fd` and
  `source_head_verified=true`.
- Current observations remain fail-closed: AutoBid `8770` passes; Studio
  `3210` and formal prover `8810` refuse connections; authorization is absent;
  deployment remains false. This refresh prevents stale-HEAD evidence from
  being mistaken for current deployment proof.

## 30. CODEX CONTINUATION EVIDENCE - 2026-07-10 (REVIEW, DENSITY, MODEL3D)

- Root `158ca4a68` adds a read-only source-bound spec inventory. The real report
  `source-bound-spec-inventory.v1.json` covers eight held-out target plan
  documents and eight source-bound Division-21 criteria candidates. It records
  source document/page/snippet hashes and explicit blockers; it contains no
  answer-key, workbook-summary, or head-count fields. Home Depot job 610 has
  three trusted-looking spec rows plus five `needs_review` rows, but the
  inventory remains diagnostic and `production_eligible=false`.
- Root `d2fccfe93` and Studio `87ebcfe`/`6749940` make the accepted-vector
  model3d handoff typed and physical-page-bound. Pending or partial geometry is
  rejected before rendering. The live extracted fallback assembly is real and
  renderable: eight levels, 2,380 meshes, 668,560 vertices, 822 wall meshes,
  192 room meshes, and no page errors; it remains `needsVerification=true`.
- Studio `d425ab0` gates FP semantic/family writes at the authenticated proxy,
  replacing forged headers with verified JWT identity and rejecting viewers
  before upstream contact. Studio `0b7c891` proves estimator-visible family
  acceptance in an isolated test database. Canonical production rows remain
  zero; no semantic head count or production gate was fabricated.
- Current verification is green on the scoped lanes: full engine **809 passed,
  10 skipped, 4 warnings**; source-density inventory/probe focus **31 passed**;
  accepted model3d focus **20 Python + 13 Studio**; review/proxy/browser focus
  includes **13 proxy/static + 2 browser**. Current proof artifact
  `runtime-deployment-proof-formal-gateway-20260710T2055Z.json` has
  `proof_id=96e94c6894f5064926c05811b7742c8fedece6a36b33a3cd76387db97db8328c`,
  verifies root `856b23b99`, and passes engine, Studio, formal-prover, and
  source gates; deployment authorization remains blocked.
- The master objective remains open. Required external gates are still an
  actual trusted FP semantic review, trusted Cooperative spatial review rows,
  held-out density at the frozen 12% threshold, strict N6 scoring, a clean
  whole-Studio regression, and authorized deployment. No deployment was
  performed.

## 31. CODEX CONTINUATION EVIDENCE - 2026-07-11 (MATERIALIZATION, ATTESTATION, OPS FLOW)

- Root `5db6d3481`/`4e4750697` adds the source-bound FP vector materializer and
  typed HMAC deployment authorization. Root `8fc250851` adds legacy composite
  viewport migration; root `a484707e5` adds the blind held-out density review
  queue. The density queue contains **8 candidates / 0 unresolved**, exact
  source PDF/page/render hashes, and no `head_count`, `actual_heads`,
  `answer_key`, or scoring truth fields (`expected_count_supplied=false`).
- Root `31017753d` requires exact per-viewport attestations for every registered
  composite viewport before spatial acceptance. Fresh Cooperative A-101 replay
  binds physical page 44, upper/lower source bboxes, 418 wall runs, and 12
  rooms; the bid-grade and spatial review remain correctly pending. Focused
  engine spatial coverage is **61 passed**; full engine is **857 passed, 10
  skipped, 19 warnings**.
- Studio `72d301c`/`5df270c` adds the estimator viewport-attestation checklist;
  `7fe0dc2` wires Workbench `New bid`, `View pipeline`, and approval `Review` to
  the canonical AutoBid intake/board routes, preserving those controls after
  live API re-render. Focused Studio review/ops coverage is **22 passed**.
- VPS `srv1509989` now serves the eight Cooperative spatial artifacts with
  integrity-checked overlays and physical-page provenance; package ref 9 is
  still `pending_review` with **0 spatial review rows**. Engine and Studio
  health are HTTP 200. Qwen remains honestly review-only and unavailable on the
  CPU VPS because its model snapshot is absent; local RTX 4090 inference remains
  available and cannot clear a production gate.
- The master objective remains open: trusted human FP semantic and Cooperative
  spatial rows, held-out density at the frozen 12% threshold (current production
  score remains **4/8**, truth-free MAD diagnostic **5/8**), strict N6 scoring,
  clean whole-Studio regression, and a provisioned deployment authorization
  receipt. No acceptance row or deployment authorization was fabricated.

## 32. CODEX CONTINUATION EVIDENCE - 2026-07-11 (READY-LIST TRUTH-IN-LABELING)

- Root `2f021a920` closes a live honesty bug in `/ready-to-send`: a durable geometry
  cache hit no longer projects `bid-grade` while the current source-bound spatial
  overlay is pending. The projection resolves the same geometry document used by
  `/package`, reads the stored spatial manifest, and applies the existing confidence
  helper followed by the downgrade-only spatial gate. Pending manifests now expose
  `spatial_verification_unaccepted=true` and a physical-page residual; accepted
  manifests can still earn `bid-grade`.
- Focused badge/spatial coverage is **32 passed**; the full engine suite is **859
  passed, 10 skipped, 17 warnings**. `verify_agentic_rules.py`, `py_compile`, and
  `git diff --check` pass.
- The deployed VPS API (`srv1509989`, `8770`) was restarted from the scoped file.
  Live `/ready-to-send` reports AZAZ `close-approx`, `spatial_verification_unaccepted=true`,
  and `no_current_overlay_artifacts; missing_page_index:1`; it does not claim
  estimator-grade geometry. The rendered live board shows the same close-approx badge
  with no console errors at
  `out/agent-loops/halofire-master-build-20260711/live-ops/board-fail-closed.png`.
- The master objective remains open: this fixes public badge honesty but does not
  fabricate trusted FP/Cooperative review rows, improve the held-out density score,
  satisfy strict N6, or create the missing deployment authorization.

## 33. CODEX CONTINUATION EVIDENCE - 2026-07-11 (BLIND FP RECEIPT, SOURCE BINDING, TRANSMISSION TRUTH)

- Root `a179713fd` adds the production ingestion path for blind FP point review:
  rendered-page-bound point overlays are stored as immutable PNG bytes with their
  source PDF hash, physical page, rendered-page hash, packet hash, point digest,
  reviewer identity/role, timestamp, and decision id. Public projections omit point
  coordinates and answer-key fields. Tamper, page/hash mismatch, reviewer role, and
  strict scorer-before-acceptance cases are covered by focused tests.
- The strict N6 scorer endpoint now binds only to an accepted, independent point
  receipt and persists a content-addressed scorecard. It is explicitly
  `diagnostic_only` with `production_gate_effect=none`; no answer key or expected
  total is returned to the reviewer or public projection. Same-person family/point
  review is rejected fail-closed.
- Root `a179713fd` also separates package export history from external transmission:
  an exported package with missing runtime files is now
  `exported_manual_transmission_pending`, `transmission_confirmed=false`, and never
  renders as Sent. Explicit transmission confirmation remains a separate state.
- Studio `e850ddb` binds board and Review & Send 3D/drawing links to the canonical
  `geometry_document_id`, not the priced workbook document. Cooperative ref 9 live
  package data now carries pricing document `34975` and geometry document `34978`.
  The live rendered board and send page are console-clean; the send page visibly
  reports manual transmission pending.
- Focused root coverage is **38 passed**; focused Studio source/spatial coverage is
  **17 passed**. Full root regression before the final UI-only patch was **864 passed,
  10 skipped, 18 warnings**. `verify_agentic_rules.py`, `py_compile`, and
  `git diff --check` pass. VPS `srv1509989` (`187.124.234.28`) API and Studio
  services are active and healthy after deployment.
- The master objective remains open. No trusted FP semantic/head-count receipt,
  Cooperative spatial review rows, held-out density improvement to the frozen 12%
  gate, production N6 score, or deployment-authorization receipt has been fabricated.
  Accepted geometry is still absent for Cooperative, so its 3D/drawing state remains
  correctly fail-closed.

## 34. CODEX CONTINUATION EVIDENCE - 2026-07-11 (SOURCE-RASTER-BOUND SPATIAL REVIEW)

- Root `4e0ad0e76` hardens held-out density scoring. A future density observation
  must carry an independently accepted FP artifact/review, explicit FP document,
  physical page, source/render/overlay hashes, trusted reviewer identity/role, and
  observed-count binding. Density-only evidence and tampered corpus/summary data
  are rejected. Focused held-out coverage is **26 passed**; the frozen baseline
  remains **4/8 within 12% (18.9933%)**.
- Root `e3ab8fcf9` binds spatial review records to the exact rendered source-page
  SHA-256 in addition to source PDF, physical page, overlay, gate-manifest,
  reviewer identity/role, timestamp, and viewport attestations. Missing or changed
  rendered-page hashes reject acceptance with a typed 409. Root `14fd55ad0` and
  `f1bd715fc` preserve a visible review worklist when the source PDF is offline,
  while keeping the write path fail-closed.
- Combined focused backend coverage is **120 passed**; the full engine suite is
  **869 passed, 10 skipped, 18 warnings**. Studio source/spatial/geometry coverage
  is **17 passed**. Rulebook, compile, and diff checks pass.
- VPS `187.124.234.28` is active and healthy. Live `/package/9/review-packet`
  returns the eight Cooperative targets with physical pages 44/47/50/53/56/59/62/65,
  source PDF and immutable overlay/gate hashes, and no answer-key fields. Because the
  source PDF is not mounted on the VPS, rendered-page hashes are explicitly null and
  acceptance remains unavailable. The live Send page renders all eight overlays and
  review controls with no browser console errors.
- The master objective remains open: source-PDF availability for trusted rows,
  actual independent FP semantic and Cooperative spatial decisions, accepted
  vector-grounded 3D/drawing, density at the frozen threshold, production N6, and
  formal deployment authorization still require real external evidence. No answer
  key, human decision, transmission, or authorization was fabricated.

## 35. CODEX CONTINUATION EVIDENCE - 2026-07-11 (LIVE 3D SOURCE IDENTITY AND MODULE RUNTIME)

- Studio `7fa910c` fixes a live identity defect in the PDF-to-3D route. A request
  such as `/autosprink.html?doc=34978` now resolves the canonical AutoBid package
  before initialization, selects the Cooperative project, and renders the visible
  source card as `The Cooperative 1881 Apartments phase 1`, `doc 34978`,
  `Review pending`, and `needs-verification`. It no longer inherits the Home Depot
  fixture identity or its unrelated metadata.
- The live module probe found five missing runtime module responses that had been
  served as HTML (`accepted-model3d.js`, `ceiling-grid.js`, `section-cut.js`,
  `submittal-sheets.js`, and `cut-sheets.js`). Those tracked modules were deployed
  to the VPS and the probe now reports zero non-JavaScript script responses.
- The live Studio screenshot
  `out/agent-loops/halofire-master-build-20260711/live-ops/autosprink-34978-source-bound-final.png`
  was inspected: the 3D viewport shows the extracted Cooperative plan geometry and
  registered plan underlay, the job card is source-bound, the viewer is console-clean,
  and the status remains an honest review-pending state. Focused Studio coverage is
  **18 passed**.
- This is a real source-identity/runtime correction, not an accepted-geometry claim.
  The model remains needs-verification until the source PDF is available for exact
  rendered-page binding and a trusted human accepts the required spatial/FP rows.

## 36. CODEX CONTINUATION EVIDENCE - 2026-07-11 (SOURCE-RASTER UI FAIL-CLOSED DEPLOYMENT)

- Studio `b1534bc` makes the source-raster binding a visible, functional review
  prerequisite. Each plate now displays the rendered source-page SHA-256 (or an
  explicit unavailable state), disables both Accept and Reject when that hash is
  absent, and refuses decision events before an exact 64-character hash is present.
  Decision payloads carry `expected_rendered_page_sha256` alongside the PNG and
  manifest hashes; this preserves the backend's typed 409 fail-closed behavior
  instead of presenting a misleading actionable review control.
- The focused Studio source/spatial/geometry/workbench suite is **18 passed**.
  The scoped UI was deployed to VPS `187.124.234.28`; `halofire.service` is active.
  A fresh authenticated browser run of `/autobid-send.html?ref=9` renders all **8**
  Cooperative plates, shows physical pages 44/47/50/53/56/59/62/65, and reports
  all **16** spatial decision buttons disabled with the visible reason
  `Source raster unavailable on the canonical runtime`. The rendered evidence is
  `out/agent-loops/halofire-master-build-20260711/live-ops/send-source-raster-gate.png`;
  the only browser console item is the expected HTTP-origin COOP warning.
- This closes a UI honesty/deployment slice, not the acceptance goal. The VPS still
  lacks the canonical source PDF mount, so rendered-page hashes remain null and no
  spatial/FP/density/N6 acceptance row or bid-grade geometry claim is created. The
  remaining unblock is to provision the trusted source-PDF mount and authorized
  reviewer/identity path, then collect independent receipts without answer-key
  leakage and re-run the frozen gates.

## 37. CODEX CONTINUATION EVIDENCE - 2026-07-11 (HASH-VERIFIED SOURCE MIRROR UNBLOCK)

- Root `093a5e96d` adds a controlled `AUTOBID_SOURCE_MIRROR_ROOT` resolver. When the
  Windows Egnyte/Y: locator is absent, only the DB-indexed `rel_path` is joined
  beneath that operator-provisioned root; arbitrary explicit paths never use the
  fallback. Without the environment setting or the mirrored file, the resolver
  remains the original typed 404. Focused resolver/packet coverage is **30 passed**;
  full AutoBid engine regression is **871 passed, 10 skipped, 18 warnings**.
- The exact source PDF for Cooperative document 34978 was found locally and
  provisioned to the VPS mirror. Its byte size is **343,489,824** and its SHA-256 is
  `ab25bee6eb303a54470e00259c1f94719e1c89b6372fe8dc7bc1ba44cc68bc01`, exactly
  matching the package's source binding. `halofire-autobid.service` is active with
  `AUTOBID_SOURCE_MIRROR_ROOT=/opt/openclaw/halofire-autobid/source-mirror`.
- Live `/api/autobid/pdf/page?doc=34978&page=43` now returns a real PNG (HTTP 200,
  1,762,050 bytes). Live `/package/9/review-packet` now reports non-null rendered
  page hashes for all eight physical targets 44/47/50/53/56/59/62/65. The
  authenticated Send page renders eight bound hashes with zero source-unavailable
  warnings; A-101 Accept remains disabled until its upper/lower viewport
  attestations are independently checked, while the other plates expose the
  source-bound review controls. Evidence screenshot:
  `out/agent-loops/halofire-master-build-20260711/live-ops/send-source-raster-bound.png`.
- This is a genuine runtime/data-path unblock, not a human acceptance claim. No
  reviewer decision, FP semantic receipt, density score, N6 production score, or
  bid-grade geometry was fabricated. The remaining gates are independent trusted
  review (including A-101 upper/lower), held-out density at the frozen 12% threshold,
  strict N6 scoring, and deployment authorization separation.
