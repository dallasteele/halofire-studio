# Halofire Studio — State of UI Audit (2026-04-21)

## TL;DR

The app is a vanilla Pascal viewer wrapped in a HaloFire-themed ribbon. The **backend pipeline genuinely works** end-to-end (PDF → design.json → proposal/GLB/DXF/IFC) and hydraulic math, NFPA rule scaffolding, 296-part catalog, OpenSCAD runtime, and agent chain are all real Python code — not stubs. The **UI wrapper is the problem**: the ribbon, layer panel, and properties panel fire DOM events that no renderer subscribes to; the LiveCalc panel 404s because the browser fallback points at a route (`/projects/:id/hydraulic`) the gateway never defined (the gateway exposes `/calculate`); and ~40% of the top/ribbon commands are DEAD (no handler at all). The viewport is empty because the scene-spawn step only fires after `renderResults()` — which requires either a completed `run Auto-Design` pipeline or a previous `design.json` on disk. The user's screenshot is the honest shape of the product: a real CAD backend with a theatre-set UI bolted to it.

The repo's own `HONEST_STATUS.md` already says this in the author's own words: *"Ribbon / palette / layer toggles fire DOM events nothing listens to. User can't click a head and move it, can't drag a pipe…"* That assessment is accurate.

## UI Inventory

| Element | Location | Status | Evidence |
|---|---|---|---|
| Ribbon tab: DESIGN | `apps/editor/components/halofire/Ribbon.tsx:58-87` | WORKS (renders groups) | Local `useState<RibbonTab>` at :194 drives content |
| Ribbon tab: ANNOTATE | `Ribbon.tsx:88-117` | WORKS | Same state machine |
| Ribbon tab: ANALYZE | `Ribbon.tsx:118-144` | WORKS | Same |
| Ribbon tab: REPORT | `Ribbon.tsx:145-186` | WORKS | Same |
| "New bid" / "Load bid" / "Save bid" (top-right icon trio) | `Ribbon.tsx:233-256` | DEAD | `dispatchRibbon()` in `app/page.tsx:190-226` only handles `auto-dim-pipe-runs`, `report-*`. `bid-new` / `bid-load` / `bid-save` fire the CustomEvent but **no listener exists** anywhere (grep: zero consumers) |
| Auto-Design button (ribbon DESIGN>Auto) | `Ribbon.tsx:62-67` → emits `halofire:ribbon` | PARTIAL | No panel listens for `'auto-design'` cmd; the actual Auto-Design is in the left-sidebar panel, not the ribbon button |
| Heads / Pipes / Walls / Zones (ribbon DESIGN>Layers) | `Ribbon.tsx:72-77` | PARTIAL | `LayerPanel.tsx:100-119` toggles local state + fires `halofire:layer-visibility`, but **no renderer consumes that event** (grep below) — so toggling does nothing visible. |
| Measure (ribbon Tools) | `Ribbon.tsx:82` → `ToolOverlay.tsx` | PARTIAL | Tool mode activates but uses **hardcoded 30m-grid approximation** to convert px→meters (`ToolOverlay.tsx:52-56`); does NOT use r3f raycaster. Result is a wild estimate, not a measurement. |
| Section | `Ribbon.tsx:83` | STUB | `ToolOverlay.tsx:68-76` toggles mode but there's no cutting-plane implementation; the rest of the file is measure only |
| Snap | `Ribbon.tsx:84` (`snap-toggle`) | DEAD | No listener for `'snap-toggle'` anywhere |
| Dimension tool | `Ribbon.tsx:92-98` → Pascal's `<DimensionTool />` (page.tsx:268) | WORKS | Pascal fork's real tool |
| Text / Revision cloud | `Ribbon.tsx:103-114` → Pascal tools (page.tsx:269-270) | WORKS | Pascal fork's real tools |
| Auto-Dim Pipes | `Ribbon.tsx:121-128` → `handleAutoDim` `page.tsx:128-188` | WORKS | Reads `window.__hfScene`, calls `autoDimensionPipeRun` (real package code) |
| Calculate (Hydraulics) | `Ribbon.tsx:133` → `LiveCalc.tsx:131-140` | BROKEN (browser) | In Tauri invokes `run_hydraulic` command — OK. In **browser/dev (what the user is running)** falls through to `POST /projects/:id/hydraulic` (`ipc.ts:252`) which **does not exist on the gateway** — only `/projects/:id/calculate` exists (`main.py:508`). This is the red 404 in the screenshot. |
| Remote area | `Ribbon.tsx:134` → `RemoteAreaDraw` (page.tsx:267) | WORKS | Dedicated component imported |
| NFPA check | `Ribbon.tsx:140` (`rule-check`) | DEAD | No listener for `'rule-check'` anywhere |
| Stress test | `Ribbon.tsx:141` (`stress-test`) | DEAD | No listener |
| Proposal (REPORT) | `Ribbon.tsx:149` | DEAD | No listener for `'report-proposal'` |
| NFPA 8-Report | `Ribbon.tsx:152-156` | WORKS | `page.tsx:207-213` opens gateway deliverable URL |
| Submittal package | `Ribbon.tsx:157` | DEAD | No listener for `'report-submittal'` |
| DXF export | `Ribbon.tsx:163` | DEAD | No listener for `'report-export-dxf'` |
| IFC export | `Ribbon.tsx:164` | DEAD | No listener for `'report-export-ifc'` |
| Approve & Submit | `Ribbon.tsx:172-177` | WORKS | `page.tsx:219-225` POSTs `/approve` and opens proposal |
| Send bid | `Ribbon.tsx:178-182` | WORKS | `page.tsx:200-203` opens proposal HTML |
| Viewport toolbar LEFT (3D/2D/Split, collapse sidebar) | `packages/editor/src/components/ui/viewer-toolbar.tsx:371-378` | WORKS | Vanilla Pascal — wired to `useEditor`/`useViewer` zustand stores |
| Viewport toolbar RIGHT (Levels, Walls, Grid snap 0.50, m/ft, sun, camera mode, walkthrough, Preview) | `viewer-toolbar.tsx:380-395` | WORKS | All Pascal zustand-store backed |
| Sidebar tab "Scene" | `page.tsx:90` → `ScenePanel` (page.tsx:62-74) | STUB | Renders an italic "HaloFire work lives under the other tabs" placeholder |
| Sidebar tab "Auto-Design" | `page.tsx:91-95` → `AutoDesignPanel.tsx` | WORKS | Real preset picker + upload + pipeline dispatch + SSE poll + deliverables list. This is the one end-to-end path. |
| Sidebar tab "Project" | `page.tsx:97-100` → `ProjectBriefPanel` | PARTIAL | Imports `AiPipelineRunner` and `BuildingGenerator` — not inspected further, but note the imports of known-wrapper components |
| Sidebar tab "Catalog" | `page.tsx:102-105` → `CatalogPanel` | not inspected in detail | |
| Sidebar tab "Manual FP" | `page.tsx:107-110` → `FireProtectionPanel.tsx` | WORKS (as MCP caller) | Real `fetch('/mcp')` calls against the halopenclaw gateway using JSON-RPC, per `FireProtectionPanel.tsx:43-63` |
| LayerPanel (floating bottom-left) | `components/halofire/LayerPanel.tsx` | PARTIAL | Self-contained toggle state works; broadcasts `halofire:layer-visibility` — but **the only consumer is `SceneChangeBridge.tsx:46` (re-fires scene-changed for LiveCalc recalc) and two e2e tests**. No renderer hides layers. |
| LiveCalc / LiveHydraulic panel (bottom-right) | `components/halofire/LiveCalc.tsx` | BROKEN | Calls `ipc.runHydraulic` → in browser mode POSTs `/projects/:id/hydraulic` (`ipc.ts:246-254`); **no such route** on gateway (only `/calculate` at `main.py:508`). Produces the visible `HTTP 404: NOT_FOUND`. |
| HalofireProperties (right side, selection-driven) | `components/halofire/HalofireProperties.tsx` | WORKS | Reads `useViewer` selection + `useScene` nodes, Move/Duplicate/Delete all wire into real Pascal store operations (`setMovingNode`, `deleteNode`, `createNode`). Swap SKU / Isolate buttons only fire DOM events with no consumer (STUB). |
| CommandPalette | `components/halofire/CommandPalette.tsx` | not deeply inspected | Presumed same-event-bus as Ribbon — inherits the same dead-command problem |
| StatusBar | `components/halofire/StatusBar.tsx` | WORKS | Props-driven, renders project name/address from page.tsx:289-290 |
| Bottom toolbar (cursor/box/pin/wrench/axes/trash/pipe chips) in screenshot | not found | — | No halofire-branded bottom toolbar component exists. What the user sees is Pascal's built-in tool dock from `packages/editor/src/components/` (walkthrough/first-person-controls/floorplan-panel). Pascal's widgets work; the apparent "clipping" is `LayerPanel` positioning (`bottom-10 left-3`, `LayerPanel.tsx:187-194`) on top of Pascal's own bottom affordances. |

## Backend Inventory

| Capability | File:line | Status |
|---|---|---|
| FastAPI gateway port 18080 | `services/halopenclaw-gateway/main.py` (837 LOC) | REAL — 18 routes mounted |
| `/health` | `main.py:139` | WORKS |
| `/mcp` JSON-RPC tool dispatcher | `main.py:159` | WORKS — routes to `tools/registry.py` TOOLS dict |
| `/intake/upload` (multipart) | `main.py:262` | WORKS |
| `/intake/status/{job_id}` | `main.py:371` | WORKS |
| `/intake/stream/{job_id}` (SSE) | `main.py:381` | WORKS |
| `/intake/dispatch` (server-path preset) | `main.py:664` | WORKS |
| `/projects/{id}/proposal.json` / `design.json` / `manifest.json` | `main.py:440,448,456` | WORKS (file reads) |
| `/projects/{id}/validate` | `main.py:487` | exists |
| `/projects/{id}/calculate` | `main.py:508` | WORKS — this is the real hydraulic re-solve endpoint |
| `/projects/{id}/hydraulic` | **NOT DEFINED** | **MISSING** — LiveCalc's browser fallback POSTs here and gets 404. Either add this route or change `ipc.ts:252` to `/calculate`. |
| `/projects/{id}/deliverable/{name}` | `main.py:551` | WORKS |
| OpenSCAD catalog (`/catalog/openscad/status|render|glb`) | `main.py:564,580,623` | WORKS — `openscad_runtime.py` auto-detects `C:/Program Files/OpenSCAD/openscad.exe`, caches by content hash, 60+ `.scad` files under `packages/halofire-catalog/authoring/scad/` |
| `/quickbid` | `main.py:647` → `orchestrator.run_quickbid` (`orchestrator.py:483-530`) | WORKS — real $/sqft heuristic |
| `/building/generate` | `main.py:725` | exists |
| `/codex/run` | `main.py:819` | exists |
| Tool: halofire_validate_nfpa13 | `tools/validate_nfpa13.py` (245 LOC) | REAL |
| Tool: halofire_ingest_pdf | `tools/ingest_pdf.py` (149 LOC) | REAL |
| Tool: halofire_place_head | `tools/place_head.py` (233 LOC) | REAL |
| Tool: halofire_route_pipe | `tools/route_pipe.py` (230 LOC) | REAL |
| Tool: halofire_calc_hydraulic | `tools/calc_hydraulic.py` (166 LOC) | REAL |
| Tool: halofire_export_pdf | `tools/export_pdf.py` (185 LOC) | REAL |
| Tool: halofire_ai_intake/ai_pipeline/ai_quickbid/ai_building_gen | `tools/ai_*.py` | REAL |
| Pipeline orchestrator | `services/halofire-cad/orchestrator.py` (542 LOC) | REAL — dynamically loads 14 agents via importlib |
| Agent 00-intake | `agents/00-intake/agent.py` (1545 LOC) | REAL but **quality-limited** per HONEST_STATUS.md — CubiCasa returns few dozen rooms, walls don't polygonize into closed cells |
| Agent 01-classifier | `agents/01-classifier/agent.py` (192 LOC) | REAL |
| Agent 02-placer | `agents/02-placer/agent.py` (495 LOC) | REAL but grid-scatter quality per HONEST_STATUS §4 |
| Agent 03-router | `agents/03-router/agent.py` (824 LOC) | REAL but "arbitrary Steiner" per HONEST_STATUS §5 |
| Agent 04-hydraulic | `agents/04-hydraulic/agent.py` + `hardy_cross.py` + `fitting_equiv.py` + `pump_curve.py` (547 LOC main) | REAL — Hazen-Williams, Hardy-Cross loops, fitting equivalents |
| Agent 05-rulecheck | `agents/05-rulecheck/agent.py` (337 LOC) + `rules/nfpa13_2022.yaml` + `rules/nfpa13_hazard_map.yaml` | REAL — subset of NFPA-13 2022 testable rules with YAML-declared checks |
| Agent 06-bom + hydralist | `agents/06-bom/*.py` | REAL |
| Agent 07-labor | 149 LOC | REAL |
| Agent 08-drafter | (dir exists, not inspected) | unknown |
| Agent 09-proposal | 377 LOC | REAL — writes proposal.pdf/xlsx/json |
| Agent 10-submittal | 445 LOC + `nfpa_report.py` | REAL — DXF/GLB/IFC export, NFPA 8-section report |
| Agent 11-field / 12-quickbid / 13-pe-signoff / 14-building-gen | dirs | REAL |
| Pascal fork (`packages/editor`, `packages/viewer`, `packages/core`) | | Mostly VANILLA Pascal with HaloFire additions: `InstancedCatalogRenderer` (`packages/viewer/src/renderers/instanced-catalog-renderer.tsx`) collapses per-SKU nodes into InstancedMesh; `packages/hf-core/src/sheets/layer-mapping.ts`; halofire-sprinkler package (`head.ts`, `placement.ts`, `hazard-class.ts`). No viewport-layer customization to consume `halofire:layer-visibility`. |
| Desktop Tauri shell | `apps/halofire-studio-desktop/src-tauri/src/commands/` (7 modules: catalog, host, hydraulic, mod, pipeline, project, scad) | REAL — but the `run_hydraulic` command is "read-only": it just reads pre-computed `design.json` from disk, not a re-solve (`hydraulic.rs` header comment confirms). |
| Parts catalog | `packages/halofire-catalog/catalog.json` (2440 LOC, 20+ SKUs shown; HONEST_STATUS says 296 total of which 276 are stubs) | PARTIAL — schema populated, pricing + install_minutes present, but `scad_source` references that may/may not render |
| OpenSCAD runtime | `services/halopenclaw-gateway/openscad_runtime.py` (311 LOC) + 60+ `.scad` files | REAL — cache by (scad-hash, params-hash) → GLB |
| NFPA rule engine | `services/halofire-cad/rules/nfpa13_2022.yaml` + `agents/05-rulecheck/agent.py` | REAL but scaffold — ~10 rules in YAML visible, many more unimplemented per comments |
| Python agent sidecar (pipeline steps intake → classify → place → route → hydraulic → rulecheck → bom → labor → proposal → submittal) | `orchestrator.py:86-368` | REAL — every step runs, every step writes artifacts |

## Pipeline Gaps

- **LiveCalc panel is broken in browser mode**: `apps/editor/lib/ipc.ts:252` POSTs `/projects/:id/hydraulic`, but gateway defines only `/projects/:id/calculate` at `main.py:508`. This is the 404 in the user's screenshot. Simple fix: rename one or the other.
- **Layer panel → renderer gap**: `LayerPanel.tsx:94-96` dispatches `halofire:layer-visibility`, but no viewer renderer listens. Only `SceneChangeBridge.tsx:46` and e2e tests subscribe. The dots toggle, nothing hides. User sees "LayerPanel works but nothing happens when I click Heads off."
- **Ribbon "New/Load/Save bid" icons** (`Ribbon.tsx:233-256`): dispatch `halofire:ribbon` with `bid-new|bid-load|bid-save`, no consumer. DEAD.
- **Ribbon "Snap" / "NFPA check" / "Stress test" / "Proposal" / "Submittal package" / "DXF" / "IFC"** (`Ribbon.tsx:84,140,141,149,157,163,164`): CommandEvents fire, zero listeners. DEAD. Notably DXF + IFC are disconnected even though the submittal agent already writes both files to disk — the button just needs to call `gw + /projects/:id/deliverable/design.dxf`.
- **Measure tool uses fake px→meters scaling** (`ToolOverlay.tsx:52-56`): assumes 30m visible at default zoom, ignores actual camera. Will return wildly wrong distances at any other zoom.
- **Section tool is a mode-toggle with no implementation** (`ToolOverlay.tsx:68-76`).
- **Swap SKU / Isolate buttons** (`HalofireProperties.tsx:236-256`): fire events, no consumer.
- **Ribbon "Auto-Design"** (`Ribbon.tsx:62-67`): the only way to actually run the pipeline is from the **left sidebar "Auto-Design" panel**. The ribbon button of the same name does nothing (`dispatchRibbon` in `page.tsx:190-226` doesn't handle `'auto-design'`).
- **Empty viewport at first load**: `SceneBootstrap.tsx` claims to spawn a 20-SKU catalog showcase on first mount, but gates on `rootNodeIds.length > 0` + session storage + an `existing` tag scan. If any earlier 404'd `building_shell` artifact is in the store, `AutoDesignPanel.clearPreviousAutoDesign` wipes it on next "Render last bid"; otherwise the viewport stays empty until the user completes an Auto-Design run.

## Dead Components

Files present in `apps/editor/components/halofire/` that no runtime code imports:
- `AiPipelineRunner.tsx` — imported only by `ProjectBriefPanel.tsx` (so transitively live via Project sidebar tab, but not by page.tsx directly)
- `AutosaveManager.tsx` — imported only by its own e2e test `e2e/autosave-manager.spec.ts`. Not mounted anywhere in the app.
- `BuildingGenerator.tsx` — imported only by `ProjectBriefPanel.tsx`. Live only if Project tab is opened.
- `IfcUploadButton.tsx` / `IfcUploadButtonImpl.tsx` — imported only by `FireProtectionPanel.tsx`. Live only if the Manual FP tab is opened.

Components imported by `page.tsx` (always mounted): 18 of 23 halofire components. So ~22% of the halofire UI layer is not reachable from the default entry.

## What Actually Works End-to-End

Exactly one flow goes from click → backend → rendered result:

1. User opens sidebar tab **Auto-Design**.
2. Picks a preset PDF (e.g. `1881 - Architecturals.pdf`) or uploads one.
3. Clicks **Run Auto-Design**. `AutoDesignPanel.tsx:336-414` dispatches via `ipc.runPipeline` (Tauri) or `fetch('/intake/dispatch')` (browser).
4. Gateway kicks `orchestrator.run_pipeline`. Agents run through intake→classify→place→route→hydraulic→rulecheck→bom→labor→proposal→submittal.
5. SSE progress streamed via `AutoPilot` to viewport — it calls `translateDesignSliceToNodes` to incrementally spawn walls, heads, pipes into the Pascal scene store.
6. On `completed`, `renderResults()` fetches `/projects/:id/design.json`, runs `translateDesignToScene`, batch-creates nodes through `useScene.createNodes`. Camera framing fires.
7. User can download deliverables (proposal.pdf, design.glb, design.dxf, design.ifc) via the rendered deliverable links.

Nothing else in the UI chrome meaningfully closes a loop. The NFPA 8-Report and Approve & Submit ribbon buttons also work, but only as open-a-URL actions — no interactive flow.

## Recommended Focus Areas

Not a fix-it list — just where the real gaps cluster:

1. **UI event bus has no subscribers.** The whole `halofire:ribbon` / `halofire:layer-visibility` / `halofire:swap-sku` / `halofire:isolate` architecture is producers without consumers. Either wire a central dispatcher in `page.tsx` or delete the buttons. Over half of the ribbon is currently a visual prop.
2. **The route-name mismatch causing LiveCalc's 404.** One-line fix, but symptomatic of "wrote two sides of a contract in separate sessions and never tested the browser-mode path."
3. **No viewer-layer layer system.** Pascal's viewer doesn't know about `halofire:layer-visibility`. Needs a subscriber inside `packages/viewer/` that toggles mesh visibility per tag — or layer-aware filtering at `NodeRenderer`.
4. **Interactive editing claimed but absent.** Only `HalofireProperties` (selection-driven move/duplicate/delete) closes the edit loop. No ribbon tool places heads, draws pipes, or resizes. Moving a head triggers `halofire:scene-changed`, LiveCalc would recalc — but LiveCalc 404s, so the feedback loop is broken in browser mode.
5. **Pipeline quality, not plumbing.** The author's own `HONEST_STATUS.md` already enumerates this: CubiCasa5k intake shallow, wall→room polygonize often fails, head placement is grid-scatter, pipe routing is generic Steiner. This is the actual long-term work. The 48 commits shipped infrastructure; the CAD smarts are still placeholder algorithms.
6. **Browser vs Tauri parity.** Several UI paths (`ipc.runHydraulic`, `ipc.readDeliverable`) have Tauri commands that work and browser fallbacks that 404. The user appears to be running browser-mode dev (`npm run dev` on port 3002). Either fix all fallbacks or refuse to render them unless `detectTauri()` succeeds.
