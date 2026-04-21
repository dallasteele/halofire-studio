# HaloFire Studio — Implementation Plan

**Date:** 2026-04-21
**Target:** Drop a PDF → watch the 3D model build → export an
AHJ-submittal PDF sheet set + DWG. All from one HaloFireStudio.exe.

This plan is the **operational bridge** between
`docs/blueprints/` (the spec) and git commits. Each phase has a
visible user-facing deliverable. Each commit ships a testable
slice.

---

## Part 0 — Hard facts (what we have today)

### Python CAD pipeline (`services/halofire-cad/`)
- **350 tests PASS / 2 SKIP** (incl. 2 full-pipeline E2E)
- Cruel-test scoreboard against 1881 truth: **27 PASS / 0 FAIL**
  - head_count: 1,293 / 1,303 (−0.8 %) ✅
  - total_bid: $595,149 / $538,792 (+10.5 %) ✅
  - system_count: 7 / 7 (exact) ✅
  - level_count: 6 / 6 (exact) ✅
- 10 agent stages wired: intake → classifier → placer → router →
  hydraulic → rulecheck → bom → labor → proposal → submittal
- Orchestrator accepts `progress_callback` (blueprint 09 §2)
- DXF export partial; IFC export partial; Hydralist + NFPA-8 ✅

### Pascal fork (`packages/core/src/schema/`)
- **3 of 10 fire-protection node types landed:**
  - `SprinklerHeadNode` ✅
  - `PipeNode` ✅
  - `SystemNode` ✅
- `HydraulicSystem` Hazen-Williams reactor **written but not
  installed at app boot** (blueprint 04 §10)
- 32 zod-parse tests PASS (blueprint 04)
- AnyNode discriminator covers the three landed types
- **NOT yet landed:** Fitting, Valve, Hanger, Device, FDC,
  RiserAssembly, RemoteArea, Obstruction, Sheet

### Tauri shell (`apps/halofire-studio-desktop/`)
- Scaffolded: `src-tauri/Cargo.toml`, `tauri.conf.json`,
  `main.rs`, 5 command modules (host/pipeline/scad/catalog/project)
- Python sidecar entry + PyInstaller build script + 4 pytest
  smoke tests PASS
- **NOT yet buildable:** `cargo build` not run, OpenSCAD binary
  not vendored, Next.js `output: 'export'` not configured, fetch
  calls in editor still hit the gateway

### Editor UI (`apps/editor/`)
- 27 halofire components, 5 Playwright smoke tests PASS
- Built + deployed Ribbon (3 tabs: Design / Analyze / Report),
  LayerPanel, LiveCalc, AutoPilot, HalofireProperties,
  HalofireNodeWatcher, SceneChangeBridge, AutoDesignPanel,
  CommandPalette, StatusBar, ProjectContextHeader
- **Scene spawning still uses tagged ItemNodes** — first-class
  types from the Pascal fork aren't wired into runtime yet

### 3D modeling — issues solved (regression-protected)
1. Auto-clear-on-mount nuking building ⇒ removed
2. Multi-Building / multi-Site duplication ⇒ Pass 4 dedup
3. LayerPanel full-width ⇒ floating bottom-left
4. Columns as red wireframes ⇒ proper OpenSCAD column GLB
5. Truth seed: 12 levels vs real 6 ⇒ re-seeded, idempotent
6. Bid $1.5 M (182 % over) ⇒ tuned overhead multipliers → PASS
7. system_count 3 vs 7 ⇒ stopped over-merging + combo_standpipe
8. head_count 533 (59 % under) ⇒ per-unit subdivision → PASS
9. CubiCasa wall noise ⇒ room-shared-edge interior wall derivation
10. Drop ceilings missing ⇒ first-class intake output
11. All pipes rainbow colors ⇒ NFPA §6.7 red `#e8432d` uniform
12. Pipes shrinking at scale ⇒ 1:1 metres, no autoscale
13. Level stacking collapsed to Y=0 ⇒ per-level LevelNode + Ceiling
14. SlabNode.elevation misunderstood (30 m thick blocks!) ⇒ 0.2 m
15. Realistic Halo bid structure ⇒ direct × (18/6/5/4/4 %) × O&P
16. Intake page filter ⇒ title-block sheet-ID classifier
17. Pipe fragmentation ⇒ wall-chain merging
18. Multiple-spawn pile-up on re-run ⇒ clearPreviousAutoDesign Pass 1-4
19. Pascal default level_0 collision ⇒ dedup pass 3
20. BrokenItemFallback red-wireframe paths (src='') ⇒ proper GLB src
21. Heads 3D size too small ⇒ 0.4 m viz dims
22. Pipes drawing with wrong yaw ⇒ Y-up axis-swap correct
23. Scene clearing left orphaned children ⇒ two-pass delete
24. Scene events firing too often ⇒ SceneChangeBridge + debounce
25. Preview server stale-cache on rebuild ⇒ kill + restart

### 3D modeling — issues still open (this plan solves them)

| # | Issue | Phase |
|---|---|---|
| A | Viewport caps at 150 heads; real jobs 1.5–10 K heads | R3 |
| B | DWG import as underlay (90 % of real intake) | R12 (stretch) |
| C | Scale calibration UX when intake fails | R12 (stretch) |
| D | HydraulicSystem not installed → no live re-solve | R1 |
| E | First-class fire-protection nodes not spawned at runtime | R2 |
| F | AutoPilot shows stage list but doesn't spawn geometry live | R4 |
| G | `.hfproj` format undefined; `out/<id>/` is ad-hoc | R5 |
| H | No undo/redo (zundo in deps, unused) | R5 |
| I | No autosave / crash recovery | R5 |
| J | No SheetNode / title block / paper-space | R6 |
| K | No dimensioning engine | R8 |
| L | No bound PDF submittal (only `proposal.pdf`) | R6-R7 |
| M | DXF export partial; DWG export missing | R9 |
| N | Tauri shell not integrated with editor (still 3 services) | R10 |
| O | Second-project smoke (cruel-test on a fresh bid) | R11 |

---

## Part 1 — Critical path to "PDF + DWG AHJ submittal from one exe"

Minimum commit sequence to MVP:

```
R1 Pascal nodes ──► R2 spawn rewrite ──► R3 instancing ──┐
                                                         ├─► R6 sheets ──► R7 default set ──► R8 dims ──► R9 DWG ──► R10 Tauri ──► R11 submittal
R4 live spawn streaming ─────────────────────────────────┤
R5 hfproj + undo + autosave ─────────────────────────────┘
```

**R1–R5 run in parallel-ish** (R1+R2+R3 interlock; R4 is
independent; R5 is independent). **R6 needs R1 + R2** (sheets
reference typed nodes). **R7 needs R6**. **R8 needs R6**. **R9
needs R6 + R7 + R8**. **R10 can start any time, but packaged
build gates on everything else**. **R11 is the ship gate**.

---

## Part 2 — Phased implementation (commit-by-commit)

Each commit = one file-level deliverable, one test green, one
visible outcome. All target branch `main` (or feature branch
→ squash-merge).

### Phase R1 — Pascal runtime parity (first-class node types)

**Goal:** Scene graph uses typed nodes, not tagged ItemNodes.

| Commit | File | Deliverable | Test |
|---|---|---|---|
| R1.1 | `packages/core/src/schema/nodes/fitting.ts` | FittingNode schema (blueprint 04 §3) | `pascal-fork.spec.ts` +6 |
| R1.2 | `packages/core/src/schema/nodes/valve.ts` | ValveNode schema | +4 |
| R1.3 | `packages/core/src/schema/nodes/hanger.ts` + `device.ts` | HangerNode + DeviceNode | +4 |
| R1.4 | `packages/core/src/schema/nodes/{fdc,riser-assembly,remote-area,obstruction,sheet}.ts` | 5 remaining types | +5 |
| R1.5 | `packages/core/src/schema/types.ts` + `index.ts` | AnyNode union + barrel exports | round-trip |
| R1.6 | `apps/editor/app/page.tsx` | `installHydraulicSystem(useScene)` at boot | live solve in Playwright |

**DoD:** `AnyNode.parse({type:'fitting', …})` works in both TS
and Python mirror. HydraulicSystem solves on mutation
(verified via e2e scene-change → demand-updated).

### Phase R2 — spawn-from-design rewrite

**Goal:** Auto-design produces typed nodes.

| Commit | File | Deliverable |
|---|---|---|
| R2.1 | `packages/hf-core/src/scene/spawn-from-design.ts` | Extract from AutoDesignPanel → stateless `translateDesignToScene(design) → NodeCreateOp[]`. Use typed nodes (SprinklerHead, Pipe, Fitting, Valve, Hanger, Device, FDC, RiserAssembly). |
| R2.2 | `apps/editor/components/halofire/AutoDesignPanel.tsx` | Delegate to spawn-from-design. Drop 500 lines of inline scene-creation. |
| R2.3 | `packages/hf-core/tests/scene/spawn.spec.ts` | Golden fixture — 1881 design slice → expected NodeCreateOps |

**DoD:** AutoDesign spawn produces SprinklerHeadNodes + PipeNodes
+ FittingNodes (check via `window.__hfScene.getState()`).
HalofireProperties panel renders typed fields without fallback
to generic ItemNode.

### Phase R3 — Instancing (1,500+ heads at 60 fps)

**Goal:** Warehouse-scale 10 K heads performant.

| Commit | File | Deliverable |
|---|---|---|
| R3.1 | `packages/viewer/src/renderers/instanced-catalog-renderer.tsx` | drei `<Instances>` per GLB src; group nodes by `asset.src` |
| R3.2 | `packages/viewer/src/systems/selection-escape.ts` | Selected item pulled out of instance → per-node transform; re-absorbed on deselect |
| R3.3 | `apps/editor/e2e/perf-baseline.spec.ts` | 1500 heads @ 60 fps avg, 30 fps p95 |

**DoD:** AutoDesignPanel's `MAX_HEADS_VIEWPORT = 150` cap
removed. Full 1293-head 1881 renders at ≥ 55 fps p50.

### Phase R4 — Streaming autopilot

**Goal:** Viewport fills progressively as pipeline runs.

| Commit | File | Deliverable |
|---|---|---|
| R4.1 | `services/halofire-cad/orchestrator.py` | Every stage emits Design-slice events (blueprint 09 §3) |
| R4.2 | `packages/hf-core/src/scene/translate-slice.ts` | Stateless `translateDesignSliceToNodes(slice, existing) → {creates,updates,deletes}` |
| R4.3 | `apps/editor/components/halofire/AutoPilot.tsx` | Consume slices → merge into scene store via txn |
| R4.4 | `apps/editor/e2e/autopilot-streaming.spec.ts` | Assert walls, then rooms, then heads, then pipes appear in that order with timing assertions |

**DoD:** User watches building emerge stage-by-stage instead of
all-at-once big-bang at pipeline end. Idempotent re-run doesn't
duplicate nodes.

### Phase R5 — Project file + persistence

**Goal:** Projects are savable, reloadable, undoable, crash-
recoverable.

| Commit | File | Deliverable |
|---|---|---|
| R5.1 | `packages/halofire-schema/src/project.ts` | `.hfproj` schemas (blueprint 01) |
| R5.2 | `apps/editor/lib/project-io.ts` | `saveProject`, `loadProject`, `createProject` — atomic writes; IPC-ready |
| R5.3 | `apps/editor/components/halofire/AutosaveManager.tsx` | 90 s + idle-based autosave to `.autosave/`; crash-recovery modal on boot |
| R5.4 | `packages/core/src/store/transactions.ts` | `txn(label, fn)` wrapper around zundo; used by every tool's onCommit |
| R5.5 | `apps/editor/components/halofire/UndoStack.tsx` | Ctrl-Z / Ctrl-Shift-Z + history panel |
| R5.6 | `apps/editor/e2e/save-load-undo.spec.ts` | Full round-trip + undo past a pipeline stage |

**DoD:** Create new project → drop PDF → edit → save → close →
reopen → state identical. Undo/redo works across the pipeline
boundary.

### Phase R6 — Sheet rendering + PDF export

**Goal:** Paper-space sheets renderable to PDF.

| Commit | File | Deliverable |
|---|---|---|
| R6.1 | `packages/core/src/schema/nodes/sheet.ts` | SheetNode + Viewport + Annotation schemas (blueprint 07 §2-3) |
| R6.2 | `packages/editor/src/components/sheet/title-block-renderer.tsx` | SVG title-block with field templating |
| R6.3 | `packages/halofire-catalog/title-blocks/halofire-standard.svg` | Default title block (Arch D 24×36 landscape) |
| R6.4 | `packages/editor/src/components/sheet/viewport-renderer.tsx` | Offscreen three.js at viewport scale → raster tile |
| R6.5 | `packages/editor/src/components/sheet/sheet-renderer.tsx` | Composite title block + viewports + annotations into one SVG |
| R6.6 | `packages/hf-core/src/report/pdf-sheet-set.ts` | pdf-lib composition of N SheetNodes → one PDF |
| R6.7 | `packages/hf-core/tests/report/pdf-sheet-set.spec.ts` | Render 3-sheet fixture → assert page count + bytes |

**DoD:** Export 3 sample SheetNodes → PDF opens in Adobe Reader
with correct page sizes, title blocks populated, viewport rasters
visible.

### Phase R7 — Default sheet set generator

**Goal:** First-stamp generates the canonical AHJ sheet set.

| Commit | File | Deliverable |
|---|---|---|
| R7.1 | `packages/hf-core/src/sheets/generate-default-set.ts` | `generateDefaultSheetSet(design) → SheetNode[]` — cover + site + N floor plans + riser diagram + hydraulic calc + stocklist + legend |
| R7.2 | `packages/hf-core/src/sheets/riser-diagram.ts` | Schematic (not-to-scale) layout of each system's pipes + valves |
| R7.3 | `packages/hf-core/src/sheets/floor-plan-layout.ts` | Auto-place viewport + center-on-level + apply layer filter (heads+pipes visible, mech/elec hidden) |
| R7.4 | `apps/editor/e2e/sheet-set-generation.spec.ts` | 1881 design → 10-sheet set generated, correct ordering |

**DoD:** "Generate submittal sheets" button on the Report ribbon
tab → immediate 10+ sheets available in the Sheets panel.

### Phase R8 — Dimensioning + annotation

**Goal:** Sheets look like AHJ-ready drawings.

| Commit | File | Deliverable |
|---|---|---|
| R8.1 | `packages/hf-core/src/drawing/dimension.ts` | Dimension + DimStyle schemas (blueprint 07 §5) |
| R8.2 | `packages/editor/src/components/tools/dimension-tool.tsx` | Linear / continuous / aligned dim tool (D) |
| R8.3 | `packages/hf-core/src/drawing/auto-dim-pipes.ts` | `autoDimensionPipeRun(systemId) → Dimension[]` — one per branch |
| R8.4 | `packages/editor/src/components/tools/text-tool.tsx` | Text + leader annotation tool (T) |
| R8.5 | `packages/editor/src/components/tools/revision-cloud-tool.tsx` | Revision cloud + auto-numbered bubble (Shift-R) |

**DoD:** Pipe-run dimensions appear on floor-plan sheets
automatically. User can add callouts + revision clouds.

### Phase R9 — DXF + DWG export ship

**Goal:** AutoCAD-compatible output.

| Commit | File | Deliverable |
|---|---|---|
| R9.1 | `services/halofire-cad/agents/10-submittal/dxf_export.py` | Extend to emit paper-space layouts + SheetNode dimensions as ACAD_DIMENSION entities |
| R9.2 | `services/halofire-cad/agents/10-submittal/dwg_export.py` | LibreDWG bridge (or ODA File Converter). Fallback: DXF → DWG via `libredwg-convert`. |
| R9.3 | `packages/hf-core/src/sheets/layer-mapping.ts` | SheetNode layer_visibility → DXF layer names (`FP-HEADS`, `FP-PIPES-MAIN`, etc.) |
| R9.4 | `services/halofire-cad/tests/test_dxf_dwg_roundtrip.py` | DXF imports into `ezdxf.load` without warnings; DWG magic bytes correct |

**DoD:** Export 1881 submittal as DXF + DWG. Open DXF in AutoCAD
LT 2018 (manual). Pipe / head / dimension layers correct.

### Phase R10 — Tauri integration ship

**Goal:** One HaloFireStudio.exe replaces the 3-service stack.

Picks up from `docs/INTEGRATED_STACK_V2.md` steps A2 onward.

| Commit | File | Deliverable |
|---|---|---|
| R10.1 | `apps/editor/next.config.ts` | `output: 'export'`, `images.unoptimized: true` |
| R10.2 | `apps/editor/lib/ipc.ts` | `runPipeline / renderScad / saveProject / …` with fetch fallback for browser dev |
| R10.3 | `apps/editor/components/halofire/AutoDesignPanel.tsx` + `AutoPilot.tsx` + `LiveCalc.tsx` | Replace `fetch(GATEWAY_URL…)` → `invoke(…)` + `listen(…)` |
| R10.4 | `apps/halofire-studio-desktop/src-tauri/bin/openscad-<triple>.exe` | Vendor OpenSCAD 2024.x binaries (check-in or CI fetch) |
| R10.5 | `.github/workflows/build-desktop.yml` | CI pipeline: build sidecar (PyInstaller), build OpenSCAD if missing, `tauri build` per-OS |
| R10.6 | Smoke: launch built `HaloFireStudio.exe` on clean VM | Drop 1881 PDF → bid → export PDF → no terminals |

**DoD:** `HaloFireStudio.exe` installs from MSI; launches; drop
PDF; auto-design completes; sheet set exports; zero localhost
ports in `netstat` during operation.

### Phase R11 — Ship validation

**Goal:** Prove the full loop on a NEW project (not 1881).

| Commit | File | Deliverable |
|---|---|---|
| R11.1 | `services/halofire-cad/truth/seed_<second-project>.py` | Truth table for a second real Halo bid |
| R11.2 | `services/halofire-cad/tests/cruel/test_second_project.py` | Full pipeline + cruel scoreboard must pass on first run |
| R11.3 | Manual: run desktop app on the second project | Bid within 15 %, submittal bundle complete |

**DoD:** Full round-trip on a bid Halo Fire hasn't seen the
pipeline touch. Cruel-test passes first run.

---

## Part 3 — Parallel tracks (concurrent work)

These can be picked up any time, not on the critical path but
valuable to ship alongside:

### P1 — Regression tests for the 25 solved 3D issues
`apps/editor/e2e/regressions.spec.ts` — one test per solved
issue so regressions surface fast.

### P2 — Catalog build pipeline (blueprints 03, §I)
- `scripts/build-catalog.ts` walks 29 existing `.scad` files
- Annotate them with `@part / @param / @port / @mfg`
- Generate `catalog.json` — feeds HalofireProperties dropdown

### P3 — Live NFPA rule check
- `packages/hf-core/src/nfpa13/live-rules.ts` — fast subset
  runs on-edit (spacing / wall distance / deflector height)
- `RuleCheckPanel` shows violations inline

### P4 — Scale calibration modal
- For when intake misses wall scale
- Click 2 points → type known distance → scale locked
- `components/halofire/ScaleCalibration.tsx`

### P5 — Manual trace over underlay
- PDF / DWG as background image
- Wall tool already in Pascal; new: IFC + DWG intake adapter
  (currently only PDF)

### P6 — Cut sheets per SKU
- Bind manufacturer PDF data sheets
- Placeholder with QR if no PDF cached

### P7 — PE stamp workflow (blueprint 11 §5)
- Digital signature via OS keychain
- Per-sheet or bundle-wide
- Auditable via `audit.jsonl`

---

## Part 4 — Definition of Done (ship gate)

The app ships when ALL of these are true:

| # | Criterion | Evidence |
|---|---|---|
| 1 | Drop 1881 PDF → bid completes in ≤ 90 s | Full-pipeline E2E timer |
| 2 | Viewport fills progressively stage-by-stage | Playwright R4.4 |
| 3 | 1,500 heads render at ≥ 55 fps p50 | Playwright R3.3 |
| 4 | HaloFireStudio.exe launches in ≤ 3 s (cold), ≤ 1 s (warm) | Perf baseline |
| 5 | Export AHJ submittal → bound PDF in ≤ 60 s | R6.7 + R7.4 |
| 6 | PDF contains: cover + site + floor plans (1 per level) + riser diagram + hydraulic calc + stocklist + legend + cut sheets | Manual content audit |
| 7 | DWG output opens in AutoCAD LT 2018+ without errors | Manual |
| 8 | Zero localhost ports visible in netstat while running | Manual |
| 9 | Save project → close app → reopen → identical state | R5.6 |
| 10 | Undo past a pipeline stage returns to prior state | R5.6 |
| 11 | Second-project cruel-test passes on first run | R11 |
| 12 | Installs from MSI on clean VM without dependency prompts | R10.6 |

---

## Part 5 — Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LibreDWG parses crashes / produces invalid DWG | Med | High | Fallback to Oda File Converter (free for internal use) or `dxf2dwg` CLI on Windows |
| OpenSCAD timeout on complex SCAD (> 60 s) | Low | Med | Cache aggressively; flag slow parts in CI; timeout per-render is 60 s already |
| PyInstaller sidecar bloat (~150 MB) | High | Low | `--onedir` instead of `--onefile` cuts to ~80 MB; or UPX compression |
| Tauri MSI too large for casual distribution | Med | Low | Split OpenSCAD + catalog into downloadable addon; `.msi` base ≤ 100 MB |
| Memory at 10 K heads | Med | High | Instance pools + LOD + frustum culling + lazy GLB load |
| Cross-engine TS/Python drift | High | High | Golden-fixture CI gate (blueprint 14 §3) — non-negotiable |
| `zundo` wrapping scene-store is complicated | Low | Med | Follow Pascal's existing zundo integration patterns (e.g. Pascal's own undo of wall edits) |
| PDF rendering slow for 20-sheet submittal | Med | Med | Parallelize viewport rasterization; use `satori` for static SVG → PNG |

---

## Part 6 — Commit tracker

Copy to an active tracker (Projects board / Linear / whatever)
with per-commit status. Keep each PR to ONE commit where
feasible.

| Phase | Commit | Owner | Status | Tests |
|---|---|---|---|---|
| R1 | R1.1 FittingNode | — | pending | 6 tests |
| R1 | R1.2 ValveNode | — | pending | 4 tests |
| R1 | R1.3 HangerNode + DeviceNode | — | pending | 4 tests |
| R1 | R1.4 FDC+RiserAssy+RemoteArea+Obstruction+Sheet | — | pending | 5 tests |
| R1 | R1.5 AnyNode union + barrel | — | pending | round-trip |
| R1 | R1.6 HydraulicSystem install | — | pending | e2e |
| R2 | R2.1 spawn-from-design.ts extraction | — | pending | golden |
| R2 | R2.2 AutoDesignPanel delegation | — | pending | e2e |
| R2 | R2.3 1881-slice spawn test | — | pending | golden |
| R3 | R3.1 InstancedCatalogRenderer | — | pending | — |
| R3 | R3.2 selection escape | — | pending | e2e |
| R3 | R3.3 perf baseline 1500 heads | — | pending | perf |
| R4 | R4.1 orchestrator slice emit | — | pending | python |
| R4 | R4.2 translate-slice.ts | — | pending | vitest |
| R4 | R4.3 AutoPilot consumer | — | pending | e2e |
| R4 | R4.4 streaming visibility test | — | pending | e2e |
| R5 | R5.1 hfproj schemas | — | pending | round-trip |
| R5 | R5.2 project-io.ts | — | pending | vitest |
| R5 | R5.3 AutosaveManager | — | pending | e2e |
| R5 | R5.4 transactions.ts | — | pending | vitest |
| R5 | R5.5 UndoStack UI | — | pending | e2e |
| R5 | R5.6 save/load/undo e2e | — | pending | e2e |
| R6 | R6.1 SheetNode schema | — | pending | schema |
| R6 | R6.2 title-block-renderer | — | pending | snapshot |
| R6 | R6.3 halofire-standard.svg | — | pending | manual |
| R6 | R6.4 viewport-renderer | — | pending | snapshot |
| R6 | R6.5 sheet-renderer | — | pending | snapshot |
| R6 | R6.6 pdf-sheet-set.ts | — | pending | pdf |
| R6 | R6.7 3-sheet fixture → PDF | — | pending | snapshot |
| R7 | R7.1 generate-default-set.ts | — | pending | fixture |
| R7 | R7.2 riser-diagram.ts | — | pending | snapshot |
| R7 | R7.3 floor-plan-layout.ts | — | pending | fixture |
| R7 | R7.4 10-sheet generation e2e | — | pending | e2e |
| R8 | R8.1 dimension schemas | — | pending | schema |
| R8 | R8.2 dimension-tool.tsx | — | pending | e2e |
| R8 | R8.3 auto-dim-pipes.ts | — | pending | fixture |
| R8 | R8.4 text-tool.tsx | — | pending | e2e |
| R8 | R8.5 revision-cloud-tool.tsx | — | pending | e2e |
| R9 | R9.1 dxf_export paper-space | — | pending | python |
| R9 | R9.2 dwg_export (LibreDWG) | — | pending | python |
| R9 | R9.3 layer-mapping.ts | — | pending | fixture |
| R9 | R9.4 dxf roundtrip test | — | pending | python |
| R10 | R10.1 next.config export | — | pending | build |
| R10 | R10.2 ipc.ts abstraction | — | pending | vitest |
| R10 | R10.3 fetch→invoke rewire | — | pending | e2e |
| R10 | R10.4 OpenSCAD bundling | — | pending | manual |
| R10 | R10.5 CI build-desktop.yml | — | pending | ci |
| R10 | R10.6 clean-VM install smoke | — | pending | manual |
| R11 | R11.1 second-project truth | — | pending | python |
| R11 | R11.2 cruel-test second proj | — | pending | python |
| R11 | R11.3 manual second proj run | — | pending | manual |

Total: **53 commits** across **11 phases**. Feature-flag as
needed so `main` stays shippable between phases.

---

## Part 7 — Ordering principle

If a conflict arises between "faster ship" and "correctness":
**correctness wins**. This is CAD software for AHJ-submitted
fire protection; incorrect output has life-safety implications.

If a conflict arises between "more features" and "working on
one more bid":
**one more bid wins**. An app that handles 2 real projects
cleanly > an app that handles 10 hypothetically.

---

## Part 8 — What NOT to do

Explicit non-goals so scope doesn't creep:

- **Mobile / tablet companion app** — v2.0.
- **Cloud storage + multi-user real-time** — v1.5+.
- **Revit round-trip via Forge API** — v1.5; IFC round-trip is
  MVP.
- **AutoSPRINK file import (.dwf/.spd)** — stretch goal; DWG
  underlay covers the primary migration path.
- **AHJ portal direct submission** — manual email for v1.0.
- **Custom SCAD DSL extensions** — use OpenSCAD as-is.
- **Non-NFPA codes (IFC non-sprinkler, local amendments)** —
  v1.5.
- **BIM clash detection vs HVAC / electrical** — v1.5.
- **User-customizable ribbons** — v1.5.

Everything not in Part 2 is deferred.

---

## Part 9 — Relationship to other planning docs

This doc is the **implementation-level** bridge.

- `docs/blueprints/NN_*.md` (16 files) — the SPEC. Each phase
  above references the relevant blueprint for the "what".
- `docs/CORE_ARCHITECTURE.md` — the engine-level doctrine
  (Pascal + OpenSCAD + HF Core split).
- `docs/CORE_ARCHITECTURE_GAPS.md` — the gap analysis that
  populated this plan.
- `docs/INTEGRATED_STACK_V2.md` — Tauri shell packaging (R10).
- `docs/REAL_PLAN_FORK_PASCAL.md` — historical; superseded by
  this + the blueprints.
- `docs/PHASE_COMPLETION_REPORT.md` — historical scoreboard;
  will be folded into a V2 ship report at R11.

All stored in HAL Brain with `domain: halofire-studio,
source: blueprint-*` tags so future sessions can `/recall`
any part without drift.

---

## Part 10 — First two commits (tomorrow's work)

Concretely: open a branch `claude/r1-fire-protection-nodes`
and ship:

1. **R1.1** — `packages/core/src/schema/nodes/fitting.ts` +
   extend `apps/editor/e2e/pascal-fork.spec.ts` with the 6
   FittingNode tests specified in blueprint 04 §3. Confirm:
   `bun run test` green; 38 Playwright tests pass (was 32).

2. **R1.2** — `packages/core/src/schema/nodes/valve.ts` + 4 tests.
   Confirm 42 Playwright tests pass.

After R1 (6 commits) we can demo typed-fire-protection scenes in
the existing dev editor. After R2 (3 commits) we can demo live
auto-bid spawn with typed nodes. After R5 (6 commits) we have a
real project-save loop. After R6-R8 (14 commits) we have
exportable PDFs. After R9 (4 commits) we have DWGs. After R10
(6 commits) we have the installable desktop app. After R11
(3 commits) we have a second-project validation. **Total: 53
commits to ship gate.**

At a steady 5-commit-per-session pace that's ~11 sessions; at
3-per-session it's ~18. Either way, a shippable HaloFireStudio.exe
is 2–3 weeks of focused work from this plan.
