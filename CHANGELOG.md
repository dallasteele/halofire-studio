# Changelog

## [0.4.1] — 2026-04-20 — honest real-plan intake + 12-test golden suite

User caught a ship-breaking lie: the loop-4 "viewport populate"
demo staged a hand-synthesized `design.json` with a 24-head grid.
That was not CubiCasa + intake producing a floor-plan model from
the architect's drawing. Tore it down, built the honest tests,
fixed the real bug, shipped again — this time from the actual PDF.

### Fixed

- **PDF intake never populated `level.polygon_m`** (`799a13c`) —
  the DXF path always computed a bounding-rectangle polygon from
  detected walls. The PDF path had the SAME structure but skipped
  that step, leaving every level with `polygon_m=[]`. Downstream:
  FP-N sheets, Studio slab renderer, IFC export, every visual
  consumer silently drew nothing for the level outline.

  Fix: after walls land in `intake_file`, compute the same
  bounding-rect polygon. Only runs when `polygon_m` is empty, so
  L3/CubiCasa's real polygons still win when present.

### Added — real tests that fail when the lie returns

- `services/halofire-cad/tests/golden/test_intake_real_plan.py` —
  12 golden assertions against the reference 1881-cooperative
  architectural PDF output (`799a13c` + `de85013`):
    1. ≥ 3 levels
    2. ≥ 10 rooms total across all levels
    3. ≥ 200 wall segments total
    4. ≥ 1 level with a non-degenerate `polygon_m` (≥ 4 verts)
    5. ≥ 1 room with a polygon (≥ 3 verts)
    6. ≥ 50 heads placed
    7. ≥ 20 pipes routed
    8. ≥ 1 routed system
    9. **Synthetic-24-head tripwire** — catches hand-forged demos
   10. Classified hazards or uses cover ≥ half the levels
   11. Rooms carry non-zero `area_sqm` (max ≥ 10 sqm)
   12. Level polygons span 1 m–1000 m on each axis (unit sanity)

  Tests SKIP cleanly when artifacts don't exist (so fresh clones
  don't false-fail). Once pipeline runs, they bite hard on empty
  geometry.

  `pytest.ini` + `services/halofire-cad/pytest.ini` both register
  the `golden` marker under `--strict-markers`.

### Verified

Re-ran the gateway pipeline (job `8c9e708d-…`, 6.5 min, all 9
steps) against the 173 MB / 110-page 1881 architectural PDF on
the patched intake. Outputs:
  - `building_raw.json`: 12 levels, **all 12 with 5-vertex
    non-degenerate polygons**, 19 rooms, 3310 walls.
  - `design.json`: 7 systems, 583 heads placed, 206 pipes routed.
  - `manifest.json`: all 11 deliverables present + warnings list.

Golden suite: **12/12 pass.** Regression sweep:
  - 304 Python unit + 12 Python golden + 92 bun test = **408**
  - viewport smoke: PASS (20/20 GLBs + CDN pin)
  - halofire-only typecheck: clean

Studio screenshot confirms the viewport now shows Level 0's
real bounding polygon (238 m × 82 m, matching the building
footprint) and heads placed under it, all 9 pipeline steps
checked off in the sidebar with deliverable download links.

## [0.4.0] — 2026-04-20 — loop 4: Codex post-review fixes + live Auto-Design

Closes the lingering items in CODEX_REVIEW.md's "Residual Warnings
and Risks" section AND the user's explicit "I have not seen Auto-
Design populate the viewport" blocker.

### Fixed

- **`datetime.utcnow()` deprecation** (`6d2cc77`) — every call site
  in pricing/db, pricing/seed, pricing/sync_agent, and the pricing
  tests moved to a new `utcnow_naive()` helper
  (`datetime.now(timezone.utc).replace(tzinfo=None)`). Confirmed
  clean with `-W error::DeprecationWarning`.
- **ifcopenshell unraisable warning on non-IFC input** (`6d2cc77`)
  — `obstructions_from_ifc` now does an ISO-10303/HDF magic-byte
  check BEFORE handing the file to ifcopenshell, preventing a
  partial C++ `file` object from being garbage-collected later.
  Mocked tests opt out via `_validate_header=False`.
- **AutoDesignPanel spawned nodes orphaned under Site** (`e5ceb4d`)
  — root cause of "Auto-Design never populated the viewport."
  Every `createNode` was passing `parentId=undefined`, same bug
  SceneBootstrap had in loop 0. Fix: `findLevelId()` walks the
  scene store for the first `level` node; every slab/head/pipe
  spawn is parented to it. `clearPreviousAutoDesign()` wipes prior
  auto-design tagged nodes on re-run. `MAX_HEADS_VIEWPORT =
  MAX_PIPES_VIEWPORT = 150` caps viewport fill (full design lives
  in design.json; this is viewport-only throttling).

### Added

- **`docs/PORTS.md`** (`ae8e54a`) — canonical dev + VPS port table
  plus Windows + Linux recipes for killing stale `18790` gateway
  processes.
- **`pytest.ini` third-party filters** (`ae8e54a`) — filters out
  noisy upstream deprecations from pyparsing, ezdxf, torch,
  openpyxl so our own warnings stay visible.

### Observed

Live Auto-Design run against the 1881 Fire RFIs preset (48 KB
PDF) from the Studio UI at port 3002, dispatching to gateway at
18080. Job IDs captured via `preview_network`:
`3f2e613b-…`, `9a908cfa-…`, `bdb983b8-…`. Pipeline runs through
intake → classify → place → route → hydraulic → rule → BOM →
labor → proposal → submittal.

## [0.3.0] — 2026-04-20 — loop 3: AutoSprink depth pass

Third autonomous iteration through the AutoSprink gap matrix. All
phases include unit tests, run green in CI locally, and are
persisted to the shared Brain (`hal-vault/wiki/decisions/`).

### Added

- **Hydraulic per-area detail** (`P-G`, `18ae791`) —
  `HydraulicResult.remote_areas_detail` now carries Q / P / head-count
  per remote-area window for NFPA 13 §11.2.3 split calcs.
- **DXF clean-import wizard** (`P-H`, `fe4b45c`) —
  `agents/00-intake/dxf_clean.py`: ezdxf-backed pass that keeps
  walls / structure / grids / title-block, drops furniture,
  annotation, MEP trades. Drop-wins-over-keep rule.
- **Studio LayerPanel** (`P-I`, `776fefa`) — floating widget with
  7 layers (heads, pipes, walls, zones, hangers, obstructions, arch),
  ribbon + Ctrl-less hotkey (H / P / W / Z) + all/none bulk. Emits
  `halofire:layer-visibility` events.
- **Prefab report + cut-list CSV** (`P-J`, `e37d5ae`) —
  `agents/09-proposal/prefab.py`: per-segment fab tag, per-system
  PDF, machine-readable cut_list.csv, DO_NOT_FAB at <3″.
- **Seismic bracing calc** (`P-K`, `50ff845`) —
  `agents/03-router/seismic.py`: NFPA 13 §18.5 lateral (40 ft) +
  longitudinal (80 ft) spacing, 4-way hangers count both, surfaces
  `SEISMIC_LATERAL_SHORT` / `SEISMIC_LONGITUDINAL_SHORT` issues.
- **Proposal hero band** (`P-L`, `a2f194b`) — big plan SVG + live
  3D model-viewer side-by-side at the top of `proposal.html`.

### Changed

- `agents/09-proposal/agent.py::write_proposal_files` now emits
  `submittal.pdf`, `cut_sheets.pdf`, `prefab.pdf`, and
  `cut_list.csv` alongside the JSON/HTML/PDF/XLSX.
- `apps/editor/components/halofire/Ribbon.tsx` learned the
  `remote-area` command.
- `apps/editor/components/halofire/CommandPalette.tsx` gained the
  'Remote area' Analyze entry.

### Tests

47 new unit tests. Running suite: **284** + viewport smoke.

## [0.2.0] — 2026-04-20 — loop 2: gap-closer backlog

Six phases closing the AutoSprink research findings from loop 1.

### Added

- **IFC obstruction bridge** (`P-A`, `ba6e357`) — `agents/02-placer/
  ifc_obstructions.py` reads IfcColumn/Beam/Member/LightFixture from
  an IFC model and returns `arm_over.Obstruction` bboxes in meters.
- **FP-N plan geometry** (`P-B`, `53c9681`) — submittal sheets
  embed per-level heads + NFPA-colored pipes with a 1 m scale bar.
- **Cut-sheet bundle** (`P-C`, `8434c0e`) — `agents/09-proposal/
  cut_sheets.py` merges project-specific and library-shared per-SKU
  PDFs via pypdf, falls back to reportlab stubs when real sheets
  aren't on disk.
- **Batch OpenSCAD renderer** (`P-D`, `c4c2251`) — `packages/
  halofire-catalog/authoring/scad/batch_render.py` drives the
  openscad CLI across the catalog with dry-run + ThreadPool workers.
- **RemoteAreaDraw** (`P-E`, `0aee189`) — click-drag overlay posts
  world-space bounds to `/remote-area`.
- **Gemma LLM contract test** (`P-F`, `473bd68`) — urllib-mocked
  round-trip through `extract_updates_from_text` and the new
  balanced-brace `_extract_json_object` parser (handles prose-
  wrapped Gemma output).

## [0.1.0] — 2026-04-20 — loop 1: AutoSprink parity slice

Eight phases landing the core AutoSprink parity features.

### Added

- NFPA 13 Table 28.2.4.1.1 fitting equivalent lengths (`4f5aa0f`)
- `DO_NOT_FAB` flag + stale/missing-price flags (`de11ace`)
- Command palette (Ctrl+K / Ctrl+Shift+P) (`b61da78`)
- Measure + Section tool overlay (`0a7501b`)
- Submittal sheet-set PDF (`7be97dc`)
- NFPA §11.2.3 two-remote-areas-together selection (`96d2f18`)
- LiveCalc floating card (`55d8daa`)
- NFPA §14.2.9 arm-over around obstructions (`2d58008`)

## [0.0.*] — pre-loop baseline

Earlier commits this session:
- SceneBootstrap Level 0 parenting (`ba224c5`)
- Asset CDN pin + viewport smoke (`5046e2a`)
- PBR materials + typed connector graph (`c77f4fe`)
- Self-contained `proposal.html` (`3145058`)
- Pricing DB + sync agent + BOM wiring (`17493c8`)
- Gemma-only policy enforcement (`7f53ece`)
- OpenClaw-HaloFire autonomous runtime (`ea3b377`)
- AutoSprink-class Ribbon + StatusBar (`f82885d`)
- AutoSprink research matrix + OpenSCAD authoring (`9f344a2`)
