# HaloFire Studio — Blueprint Index

**Date:** 2026-04-21
**Purpose:** Top-to-bottom technical spec of the entire app. Each
file in this directory is a **blueprint** — a self-contained,
testable specification for one subsystem.

Junior engineer test: any one of these blueprints, in isolation,
gives enough detail to implement that subsystem from scratch
without asking for clarification.

## Navigation

| # | Blueprint | What it covers |
|---|---|---|
| 00 | `00_INDEX.md` | This file |
| 01 | `01_DATA_MODEL.md` | `.hfproj` bundle, core schemas, migrations, file I/O |
| 02 | `02_FOUNDATION.md` | Undo/redo, autosave, crash recovery, error taxonomy, performance budgets + instancing |
| 03 | `03_CATALOG_ENGINE.md` | SCAD annotations, Part schema, catalog build pipeline, lint rules |
| 04 | `04_PASCAL_NODES.md` | Fire-protection node types, selection + hydraulic systems |
| 05 | `05_TOOLS_AND_INTERACTIONS.md` | Every tool: states, shortcuts, UX flows, error paths |
| 06 | `06_CALC_ENGINES.md` | Hydraulic (Hardy Cross), NFPA rule check, seismic, pump, tank; TS/Python parity |
| 07 | `07_DRAWING_SHEET_MANAGEMENT.md` | Sheet sets, title blocks, dimensioning, annotation, paper ↔ model space |
| 08 | `08_UX_SHELL.md` | Home/splash, new-project wizard, ribbon, panels, command palette, keyboard map |
| 09 | `09_AGENT_PIPELINE.md` | intake → classifier → placer → router → hydraulic → rulecheck → bom → labor → proposal → submittal; streaming contract |
| 10 | `10_TAURI_SHELL.md` | Host, sidecars, IPC contracts, packaging, updates |
| 11 | `11_EXPORTS_AND_HANDOFF.md` | DXF/DWG/IFC/RVT/PDF/Hydralist/NFPA-8 + AHJ submittal bundle |
| 12 | `12_EXTENSIONS_AND_COLLAB.md` | Firm catalogs, comments, revisions, multi-role, audit trail |
| 13 | `13_OPERATIONS.md` | Logging, telemetry, updater, licensing, privacy, offline |
| 14 | `14_TEST_STRATEGY.md` | Golden fixtures, CI, Playwright, cruel-test, perf budgets |
| 15 | `15_DESIGN_SYSTEM.md` | Tokens, components, typography, motion, a11y |

## Doctrine (summary)

- **Pascal knows the building. OpenSCAD knows the parts. HF Core
  knows the rules.** (CORE_ARCHITECTURE §1)
- **One integrated Tauri 2 executable.** No localhost ports at
  runtime. (INTEGRATED_STACK_V2)
- **TypeScript canonical; Python mirror CI-enforced via golden
  fixtures.** (CORE_ARCHITECTURE §3.2)
- **Every catalog item traceable to a `.scad` source with
  machine-readable annotations.** No hardcoded meshes.
- **SI canonical internally; imperial display by default (en-US).**
- **Floor plans are security-sensitive. Local-first, opt-in cloud.**

## Non-negotiable invariants

1. Pascal never knows what a K-factor is (see §1 CORE_ARCH).
2. OpenSCAD never knows what NFPA is (same).
3. No two code paths compute the same number without a shared
   golden fixture.
4. The desktop shell has zero localhost ports at runtime.
5. Every BOM line is traceable to a SCAD source.
6. The app boots to a usable state in ≤ 3 s on target hardware
   (16 GB RAM, integrated GPU, NVMe SSD).

## Reading order

First-time: 00 → 15 in order.

Maintainers: jump to the blueprint for the subsystem in play.

Resuming a session: POST `/recall` to HAL Brain with
`halofire-studio blueprint <area>` — see BRAIN SYNC below.

## Brain sync

Every blueprint in this folder is mirrored into the HAL Brain so
any future session can `recall` it and resume without drift.

Index entry:
- **Domain tag:** `halofire-studio`
- **Source tag:** `blueprint`
- **Type tag:** `technical-spec`
- **File tag:** `blueprint-{NN}-{slug}`

See `scripts/brain_sync_blueprints.py` for the sync mechanics.

## Revision history

- 2026-04-21 v1.0 — initial 16-blueprint set. Commit …
