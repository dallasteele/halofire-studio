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
  panel has no accept control and states that it cannot clear spatial or
  bid-grade gates. The unrelated local `apps/autosprink/src/api/server.js`
  modification remains untouched.
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
