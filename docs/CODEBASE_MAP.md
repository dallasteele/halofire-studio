# HaloFire Studio — Codebase Map

Orientation doc for a full-system sweep. Tables + bullets; no narrative.
See [`README.md`](../README.md) and [`SHIP_REPORT_FINAL.md`](SHIP_REPORT_FINAL.md)
for ship state.

---

## 1. Top-level tree

```
halofire-studio/
├── apps/
│   ├── editor/                      Next.js 16 + React 19 CAD editor
│   └── halofire-studio-desktop/     Tauri 2 desktop shell + Python sidecar
├── packages/
│   ├── core/                        Pascal-fork schema + systems
│   ├── editor/                      Pascal-fork editor UI primitives
│   ├── viewer/                      Pascal R3F viewport
│   ├── hf-core/                     HaloFire domain modules
│   ├── halofire-schema/             .hfproj zod schemas
│   ├── halofire-catalog/            SCAD parts + catalog.json + GLBs
│   ├── halofire-ifc/                IFC import/export
│   ├── halofire-ai-bridge/          LLM bridge
│   ├── halofire-halopenclaw-client/ Gateway HTTP client
│   ├── halofire-sprinkler/          Sprinkler math helpers
│   ├── halofire-takeoff/            Takeoff math helpers
│   ├── ui/                          shadcn-style UI primitives
│   ├── eslint-config/               Shared ESLint
│   └── typescript-config/           Shared tsconfig
├── services/
│   ├── halofire-cad/                Python pipeline (10 agents)
│   ├── halofire-catalog-crawler/    Catalog scraper
│   └── halopenclaw-gateway/         FastAPI gateway (deprecated post R10.3)
├── docs/                            16 blueprints + plan + reports
├── scripts/                         brain_sync_blueprints.py, build-catalog.ts
├── tooling/                         misc dev tooling
├── openclaw-halofire/               OpenClaw integration scratch
├── turbo.json                       Turborepo config
└── bun.lock / package.json          bun workspaces root
```

---

## 2. `apps/editor/` — Next.js CAD editor

React 19 app. Halofire-specific components live in
`apps/editor/components/halofire/`.

| Component | Purpose |
|---|---|
| `AiPipelineRunner.tsx` | Invoke Python pipeline from editor chrome |
| `AutoDesignPanel.tsx` | Delegates to `hf-core` translateDesignToScene |
| `AutoPilot.tsx` | Streams Design slices live into the viewport |
| `AutosaveManager.tsx` | 90 s + idle autosave + crash recovery modal |
| `BuildingGenerator.tsx` | Generate shell building from intake |
| `CatalogPanel.tsx` | Browse catalog.json parts |
| `CommandPalette.tsx` | Cmd-K command palette |
| `FireProtectionPanel.tsx` | FP-system inspector |
| `HalofireNodeWatcher.tsx` | Observes scene mutations |
| `HalofireProperties.tsx` | Per-node property inspector |
| `IfcUploadButton.tsx` + `IfcUploadButtonImpl.tsx` | IFC import |
| `LayerPanel.tsx` | Floating layer UI (NFPA layer set) |
| `LiveCalc.tsx` | Live hydraulic calc readout |
| `ProjectBriefPanel.tsx` | Project metadata |
| `ProjectContextHeader.tsx` | Header with project info |
| `RemoteAreaDraw.tsx` | Draw remote design area polygon |
| `Ribbon.tsx` | 3-tab Pascal-style ribbon (Design / Analyze / Report) |
| `SceneBootstrap.tsx` | Bootstraps scene on mount |
| `SceneChangeBridge.tsx` | Debounced mutation coalescer |
| `StatusBar.tsx` | Bottom status bar |
| `ToolOverlay.tsx` | Overlay for active tool |
| `UndoStack.tsx` | zundo-backed undo UI |

Support:
- `app/` — Next.js routes: `/`, `/bid`, `/privacy`, `/terms`, `/api/*`.
- `lib/` — `ipc.ts`, `ipc.types.ts`, `project-io.ts`, `utils.ts`.
- `e2e/` — 20 Playwright specs (~160+ tests).
- `tests/` — component unit tests (`__tests__/` subdir per component).

---

## 3. `apps/halofire-studio-desktop/` — Tauri 2 shell

Rust + Tauri 2 shell wrapping the Next.js editor (static export) + a Python
sidecar that runs the Halofire CAD pipeline.

`src-tauri/src/commands/` — Rust IPC modules:

| Module | Purpose |
|---|---|
| `mod.rs` | Command registry |
| `host.rs` | Host + OS info |
| `pipeline.rs` | Start/stream the Python pipeline |
| `hydraulic.rs` | Hazen-Williams calc invocation |
| `scad.rs` | OpenSCAD compile → GLB |
| `catalog.rs` | Read `catalog.json` |
| `project.rs` | `.hfproj` read/write + autosave |

Entry: `src-tauri/src/main.rs`, `lib.rs`. Config: `tauri.conf.json`.
Build scripts: `scripts/fetch-openscad.ts`, `scripts/openscad-manifest.json`,
`scripts/build-sidecar.ts` (PyInstaller one-file).

---

## 4. `packages/`

| Package | Purpose |
|---|---|
| `core` | Pascal-fork schema (AnyNode discriminated union: Fitting, Valve, Hanger, Device, FDC, RiserAssembly, RemoteArea, Obstruction, Sheet, SprinklerHead, Pipe, System), zundo store, events, hooks, systems incl. HydraulicSystem |
| `editor` | Pascal-fork editor UI primitives |
| `viewer` | Pascal R3F viewport + InstancedCatalogRenderer |
| `hf-core` | `catalog/`, `scad/` (parse-params), `scene/` (spawn-from-design, translate-slice), `drawing/` (dimension, auto-dim-pipe-runs), `sheets/` (generate-default-set, riser-diagram, floor-plan-layout, layer-mapping), `report/` (pdf-sheet-set) |
| `halofire-schema` | `.hfproj` zod: ProjectManifest, Correction, Comment, Audit, CatalogLock |
| `halofire-catalog` | 29 `.scad` parts + 40-part `catalog.json` + `assets/` GLBs + `title-blocks/` + `authoring/` |
| `halofire-ifc` | IFC import/export |
| `halofire-ai-bridge` | LLM bridge |
| `halofire-halopenclaw-client` | HTTP client for the FastAPI gateway (CI only) |
| `halofire-sprinkler` | Head-placement math helpers |
| `halofire-takeoff` | Quantity-takeoff helpers |
| `ui` | shadcn-style primitives |
| `eslint-config`, `typescript-config` | Shared config |

---

## 5. `services/halofire-cad/` — Python CAD pipeline

10 agent stages + support. Canonical orchestrator: `orchestrator.py`.

Agents (in pipeline order; extras are tools, not stages):

| Dir | Role |
|---|---|
| `agents/00-intake/` | Parse bid PDF → intake JSON |
| `agents/01-classifier/` | Title-block + sheet-ID classification |
| `agents/02-placer/` | NFPA 13 head placement |
| `agents/03-router/` | Pipe network routing |
| `agents/04-hydraulic/` | Hazen-Williams reactor |
| `agents/05-rulecheck/` | NFPA-8 rule check |
| `agents/06-bom/` | Bill of materials |
| `agents/07-labor/` | Labor hours |
| `agents/08-drafter/` | Sheet drafting |
| `agents/09-proposal/` | Proposal PDF |
| `agents/10-submittal/` | AHJ submittal package |
| `agents/11-field/` | Field punch-list tools |
| `agents/12-quickbid/` | Quick-bid back-of-envelope |
| `agents/13-pe-signoff/` | PE sign-off workflow |
| `agents/14-building-gen/` | Shell-building generator |

Support:
- `cad/` — `exceptions.py`, `layer_mapping.py`, `logging.py`, `schema.py`.
- `rules/`, `pricing/`, `truth/`, `vendor/`.
- `truth/` — DuckDB truth DB + seed scripts (`seed_1881.py`,
  `gomez_warehouse_seed.py`).

Tests (43 files):

| Subdir | Scope |
|---|---|
| `tests/unit/` | Unit tests per agent |
| `tests/properties/` | Hypothesis property tests |
| `tests/golden/` | Golden-fixture regression (`test_cruel_vs_truth.py`) |
| `tests/cruel/` | 1881 cruel scoreboard + `test_second_project.py` + `synthetic_fixtures.py` |
| `tests/stress/` | Stress / perf |
| `tests/e2e/` | Full-pipeline E2E |
| `tests/fixtures/` | intake / hydraulic / submittal / schemas |

Run: `pytest services/halofire-cad/tests -q` → ~370 PASS / 2 SKIP.

---

## 6. `services/halopenclaw-gateway/` — deprecated

FastAPI gateway that previously hosted hydraulic calc + deliverable reads
over HTTP. Deprecated after R10.3 gap-close (`199bdc4`) migrated the editor
to Tauri IPC. Still runs for CI and is retained for legacy HTTP consumers.

---

## 7. `docs/` — 16 blueprints + 6 planning docs

Blueprints (the SPEC):

| File | Topic |
|---|---|
| `blueprints/00_INDEX.md` | Blueprint index |
| `blueprints/01_DATA_MODEL.md` | Typed node + graph model |
| `blueprints/02_FOUNDATION.md` | App foundation / boot |
| `blueprints/03_CATALOG_ENGINE.md` | Catalog schema + SCAD |
| `blueprints/04_PASCAL_NODES.md` | Fire-protection node types |
| `blueprints/05_TOOLS_AND_INTERACTIONS.md` | Tool system |
| `blueprints/06_CALC_ENGINES.md` | Hydraulic + rule check |
| `blueprints/07_DRAWING_SHEET_MANAGEMENT.md` | Sheet set |
| `blueprints/08_UX_SHELL.md` | Ribbon + panels |
| `blueprints/09_AGENT_PIPELINE.md` | Python agents + streaming |
| `blueprints/10_TAURI_SHELL.md` | Desktop packaging |
| `blueprints/11_EXPORTS_AND_HANDOFF.md` | PDF / DXF / DWG |
| `blueprints/12_EXTENSIONS_AND_COLLAB.md` | Plugins + collab |
| `blueprints/13_OPERATIONS.md` | Logging / telemetry |
| `blueprints/14_TEST_STRATEGY.md` | Test matrix |
| `blueprints/15_DESIGN_SYSTEM.md` | Visual language |

Planning / report docs:

| File | Topic |
|---|---|
| `CORE_ARCHITECTURE.md` | Pascal + OpenSCAD + hf-core engine doctrine |
| `CORE_ARCHITECTURE_GAPS.md` | Gap analysis that populated the plan |
| `IMPLEMENTATION_PLAN.md` | 11-phase, 53-commit tracker |
| `SHIP_REPORT_FINAL.md` | 2026-04-21 final ship report |
| `SHIP_REPORT_2026-04-21.md` | Prior ship report |
| `PHASE_COMPLETION_REPORT.md` | Historical phase scoreboard |
| `INTEGRATED_STACK_V2.md` | Tauri shell packaging |
| `REAL_PLAN_FORK_PASCAL.md` | Historical |
| `AUTOSPRINK_TARGET.md` + `AUTOSPRINK_CLONE_PLAN(_V2).md` | Market comparison |
| `TEST_MATRIX.md` | Test strategy |
| `LEARNING_LOOP.md` | Agent-driven improvement |
| `PORTS.md` | Port table |

---

## 8. `scripts/`

| Script | Purpose |
|---|---|
| `scripts/brain_sync_blueprints.py` | Sync blueprints to HAL Brain |
| `scripts/build-catalog.ts` | Build `catalog.json` from `.scad` sources |
| `services/halofire-cad/scripts/check_schema_drift.py` | Schema drift check |
| `apps/halofire-studio-desktop/scripts/fetch-openscad.ts` | Download + verify OpenSCAD binary |
| `apps/halofire-studio-desktop/scripts/build-sidecar.ts` | PyInstaller sidecar |

---

## 9. Test count by layer

| Layer | Command | Count |
|---|---|---|
| Python | `pytest services/halofire-cad/tests -q` | ~370 PASS / 2 SKIP (43 files) |
| Playwright | `bun --cwd apps/editor run test:e2e` | ~160+ PASS across 20 specs |
| Rust | `cargo test` (src-tauri) | smoke only |

---

## 10. Skipped directories (intentional)

- `node_modules/`, `__pycache__/`, `.next/`, `out/`, `dist/` — build output.
- `packages/*/node_modules` — hoisted; walked via `packages/` entries above.
- `test-results/`, `.vault-index/` — ephemeral.
- `openclaw-halofire/` — scratch integration dir; not part of the ship.
