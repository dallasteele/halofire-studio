# Halofire Studio — Full-Stack Rebuild Plan (2026-04-21)

**Status:** approved; Phase A in flight.
**Owner:** Claude (dispatching parallel agents).
**Doctrine:** AutoSPRINK parity for manual CAD **+** automation pipelines.
Automatic / manual gearbox, same scene store, same deliverables.

## Why this plan exists

Audit (`STATE_OF_UI_AUDIT.md`) found backend is ~65% real but only
exposed as `run_full_pipeline()`. UI is ~30% wired, mostly orphan
ribbon commands. Prior `HONEST_STATUS.md` named the same gap: we
have infrastructure, not a brain.

This plan turns the pipeline into a library of **single-op** HTTP
endpoints that both the automation path (full pipeline) and the
manual CAD path (per-tool) can invoke against the same scene store.

## Architectural shape

```
          ┌─── Scene Store (TS + Python, event-sourced, undo/redo) ──┐
          │                                                          │
┌─────────▼──────────┐                            ┌─────────────────▼──────────┐
│  AUTO mode         │                            │  MANUAL mode                │
│                    │                            │                              │
│ POST /projects/:id │                            │  POST   /projects/:id/heads  │
│    /run            │  ← SSE progress stream →   │  POST   /projects/:id/pipes  │
│                    │                            │  PATCH  /projects/:id/pipes  │
│ runs full          │                            │  DELETE /projects/:id/nodes  │
│ orchestrator       │                            │  POST   /projects/:id/calculate │
│                    │                            │  POST   /projects/:id/rules/run │
│                    │                            │  POST   /projects/:id/bom/recompute │
└────────────────────┘                            └──────────────────────────────┘
          │                                                          │
          └──────────── same agents, same deliverables ──────────────┘
```

Both paths produce scene deltas. Both converge on:
`proposal.pdf`, `submittal.pdf`, `cut_sheets.pdf`, `prefab.pdf`,
`cut_list.csv`, `design.dxf/ifc/glb`, `bom.xlsx`.

## Phase order (decided)

1. **Phase A — backend single-op endpoints** *(first)*
2. **Phase B — manual CAD tools** *(depends on A)*
3. **Phase C — hydraulics live mode** *(depends on A)*
4. **Phase D — Parts DB UI + scraping** *(parallel with A/B)*
5. **Phase E — pipeline quality fixes** *(parallel, gates production)*
6. **Phase F — ribbon / command wiring cleanup** *(last)*

## Phase A — Single-op endpoints

Every agent gets a narrow HTTP surface. Each endpoint:
- Takes `project_id` + a typed operation payload
- Mutates the project's `design.json` / scene store
- Returns a `SceneDelta` with changed node IDs + any recalc side-effects
- Emits an SSE event so connected UIs update live

### Endpoint surface

| Path | Method | Op | Notes |
|---|---|---|---|
| `/projects/:id/heads` | POST | insert_head | xyz + SKU → placer validates coverage, returns new head node |
| `/projects/:id/heads/:nid` | PATCH | modify_head | sku / xyz / k-factor / temp |
| `/projects/:id/heads/:nid` | DELETE | delete_head | cascades: unlinked pipe segments flagged |
| `/projects/:id/pipes` | POST | insert_pipe | two endpoints + diameter → router resolves fittings, returns pipe node(s) |
| `/projects/:id/pipes/:nid` | PATCH | modify_pipe | diameter / material / type (branch/main/cross) |
| `/projects/:id/pipes/:nid` | DELETE | delete_pipe | same cascade semantics |
| `/projects/:id/fittings` | POST | insert_fitting | tee/elbow/coupling at node |
| `/projects/:id/hangers` | POST | insert_hanger | per NFPA 13 §9.2 spacing |
| `/projects/:id/braces` | POST | insert_sway_brace | longitudinal/lateral |
| `/projects/:id/remote-areas` | POST | set_remote_area | polygon → critical path selector |
| `/projects/:id/calculate` | POST | hydraulic_calc | full or scoped recalc, returns node pressures/flows |
| `/projects/:id/rules/run` | POST | rule_check | NFPA-13 violations list |
| `/projects/:id/bom/recompute` | POST | bom_recompute | from current scene |
| `/projects/:id/nodes/:nid/sku` | PATCH | swap_sku | validates compat, recomputes BOM |
| `/projects/:id/undo` | POST | undo | pops scene event log |
| `/projects/:id/redo` | POST | redo | |

Existing routes to keep: `/projects/:id/run` (orchestrator),
`/projects/:id/calculate` (rename from `/hydraulic` target in UI),
deliverable fetch routes.

### Scene store contract

Python side (`services/halopenclaw-gateway/scene_store.py` — new):
- Persists `design.json` plus event log `design.events.jsonl`
- Each mutation writes an event: `{op, before, after, ts, actor}`
- `get_current_scene(project_id)` is source of truth
- All agents accept `scene: SceneState` and return `SceneDelta`

TypeScript side (`packages/core/scene-store.ts` — new):
- Zustand store mirroring Python shape
- Optimistic apply on mutation, rollback on server error
- Subscribes to SSE `scene_delta` events

### Tests for Phase A

- Unit: each agent's single-op method returns a valid delta
- Contract: each HTTP endpoint matches OpenAPI schema
- Integration: `POST insert_head` → `POST calculate` → pressure field updates at new head
- Regression: `run_full_pipeline()` still produces identical deliverables

## Phase B — Manual CAD tools

Each tool = ribbon button → cursor/gesture → single-op endpoint.

| Tool | Ribbon | Endpoint | Gesture |
|---|---|---|---|
| Sprinkler | Tools ▸ Sprinkler | POST /heads | Click on ceiling → insert at snapped grid |
| Pipe | Tools ▸ Pipe | POST /pipes | Click start → click end → insert segment |
| Fitting | Tools ▸ Fitting | POST /fittings | Click at node intersection |
| Hanger | Tools ▸ Hanger | POST /hangers | Click along pipe |
| Sway Brace | Tools ▸ Sway Brace | POST /braces | Click along pipe run |
| Remote Area | Hydraulics ▸ Remote Area | POST /remote-areas | Polygon draw |
| Move | Edit ▸ Move | PATCH node | Drag selection |
| Resize | (context) | PATCH pipe/head | Drag size handle |
| Measure | Tools ▸ Measure | (client-only) | Two-click real raycast |
| Section | View ▸ Section | (client-only) | Cutting plane draw |

## Phase C — Hydraulics live

- LiveCalc panel: fix 404 (`/calculate`), show real P/V/F at selection
- Node-tag overlay: pressure + flow per node on 2D/3D
- System Optimizer: iterate upsize loop via repeated `/calculate`
- Auto Peak: find worst-case remote area automatically
- Reports: render the 8-section NFPA report to `reports/hydraulic.pdf`

## Phase D — Parts DB

### UI
- Left pane: Manufacturer → Category → Sub-type tree
- Thumbnail grid (render GLB → image at ingest time)
- Cut-sheet preview (embedded PDF)
- Drag to viewport → becomes insert-head intent

### Data reality check (2026-04-21)
- Canonical catalog at `packages/halofire-catalog/catalog.json` has **40 parts**, all with real manufacturer data. No author stubs.
- The "276 stubs" in `HONEST_STATUS.md` line 73 refer to **missing GLB / OpenSCAD renders** (3D-asset gap), not missing data. Separate problem.
- Phase D target is therefore **grow the catalog** from 40 → 150+ real SKUs + cover more categories. The GLB-render gap is tracked separately under a new Phase D.2.

### Data (scrape via headless)
Scrape manufacturer sites for real SKU specs. Tools available:
- `mcp__MCP_DOCKER__browser_*` (headless Playwright in Docker)
- `mcp__Claude_in_Chrome__*` (attached Chrome)
- Plain `curl` + HTML parsing fallback
- Playwright in `node_modules` (direct script)

Target manufacturers (fire sprinklers):
- Tyco (Johnson Controls), Victaulic, Viking, Reliable,
  Globe, Senju, Central (Tyco sub), Potter (valves),
  Anvil (hangers)

Per SKU capture:
- Part #, description, K-factor, temperature rating, orifice,
  coverage area, UL/FM listings, cut-sheet PDF URL, list price
  (when public), dimensions, thread type

Output: augmented `catalog.json` with real data, `cut_sheets/<sku>.pdf`
on disk. Replace the 276 stub SKUs with real data. Cache cut sheets.
Respect robots.txt; throttle. Log what succeeded/failed so we can
re-run the gaps.

If a given site blocks automation: fall back in order —
1. Playwright headless via Docker MCP
2. Attached Chrome MCP (uses user session)
3. `curl` with realistic UA + HTML parse
4. Flag SKU as "source-needed" in catalog; do not fabricate

## Phase E — Pipeline quality fixes

From `HONEST_STATUS.md`:
1. Intake: concave-hull boundary tracing instead of bbox
2. Intake: title-block OCR for real elevations
3. Placer: NFPA 13 §8.6 coverage tables, not grid scatter
4. Router: main / cross-main / branch topology, not pure Steiner
5. Golden tests: ratio / IoU against Halo reference bids, not
   absolute thresholds

## Phase F — Ribbon + palette cleanup

- Remove orphan ribbon commands OR wire them
- CommandPalette mirrors ribbon 1:1
- Every hotkey bound
- Dead component sweep (5 of 23 halofire/* unused)

## Agent dispatch (initial wave)

- **Agent 1** (Phase A backend): implement scene store + all single-op
  endpoints + agent `single_op` methods + contract tests
- **Agent 2** (Phase D data): scrape Tyco + Victaulic + Viking +
  Reliable catalogs; produce real SKU JSON + cut sheets
- **Agent 3** (Phase E intake): fix boundary tracing + title-block OCR
- **Agent 4** (Phase E placer): NFPA §8.6 coverage placer
- **Agent 5** (Phase E router): main/cross/branch topology router

Parallel where possible. Dependencies:
- Phase B agents wait on Agent 1
- Phase D UI agent waits on Agent 2
- Phase F cleanup waits on B + C + D landed
