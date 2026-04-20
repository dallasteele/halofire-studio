# Changelog

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
