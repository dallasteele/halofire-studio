# Real Plan — HaloFire Studio as a true Pascal fork

**Date:** 2026-04-21
**Status:** Honest re-assessment after wrapper-code drift

---

## Where I went wrong

The last ~20 commits were HaloFire-namespace **wrappers** sitting on top of an
**unmodified** Pascal core (`packages/core`) and editor (`packages/editor`).
Things like `HalofireProperties`, `HalofireNodeWatcher`, `SceneChangeBridge`,
`LayerPanel`, `LiveCalc` — every one of them is app-layer code that treats
Pascal as a black box.

The whole point of forking Pascal was to **change Pascal itself** so
fire-protection engineering is a first-class concern of the 3D framework,
not a tag on generic `ItemNode`s.

## What "the actual software" is

1. **Forked Pascal** whose schema + systems natively model fire protection
   (sprinkler heads, pipes, risers, hydraulic systems, NFPA hazard
   classifications).
2. **AutoSPRINK-parity CAD** — parametric head placement, pipe routing,
   branch / cross-main awareness, real-time hydraulics, NFPA rule checking.
3. **OpenSCAD integrated** — at runtime, not just at authoring time.
   When a user changes a pipe size, a fitting, or a head K-factor, the SCAD
   file re-evaluates via the real OpenSCAD binary (headless, cached) and the
   fresh GLB is swapped into the viewport.
4. **Autonomous 3D modeling from PDF site plans** — PDF → walls → rooms →
   hazard classification → head placement → pipe routing → hydraulic calc
   → BOM → priced proposal. The pipeline already exists in Python; what's
   missing is the Pascal-side that streams the intermediate products into
   the viewport as they land.
5. **HF software powering the auto-bid** — the CAD agent stack is real
   (350 Python tests pass, cruel-test scoreboard against 1881 truth all 4/4
   in tolerance). The last mile is the Pascal integration.

## Core fork changes (the things I should have been doing all along)

### F1. Fire-protection node types in Pascal core
**File:** `packages/core/src/schema/nodes/sprinkler-head.ts`, `pipe.ts`,
`system.ts`, `riser.ts`, `fdc.ts` — each a first-class `BaseNode.extend({...})`.

`SprinklerHeadNode`:
- `k_factor` (number, required)
- `sku` (string, required)
- `orientation` (`'pendant' | 'upright' | 'sidewall_horiz' | 'sidewall_vert'`)
- `response` (`'standard' | 'quick' | 'esfr'`)
- `temperature_f` (number, default 155)
- `coverage_ft2` (number)
- `systemId` (ref to SystemNode)
- `branchId` (ref to PipeNode — the branch line it drops off of)
- all Pascal base fields (position / rotation / parentId / etc.)

`PipeNode`:
- `start_m`, `end_m` (3D points — level-local or world, documented)
- `size_in` (nominal pipe size — 1 / 1.25 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8)
- `role` (`'drop' | 'branch' | 'cross_main' | 'main' | 'riser_nipple' | 'feed_main' | 'sprig'`)
- `schedule` (`'SCH10' | 'SCH40' | 'CPVC_BlazeMaster' | 'copper_M'`)
- `systemId`
- `flow_direction` (unit vector — computed by hydraulic solver and stored
  so Pascal's SelectionSystem can highlight downstream pipes on selection)

`SystemNode`:
- `kind` (`'wet' | 'dry' | 'preaction' | 'deluge' | 'combo_standpipe'`)
- `hazard` (`'light' | 'OH1' | 'OH2' | 'EH1' | 'EH2'`)
- `design_density_gpmft2`
- `remote_area_ft2`
- `supply_static_psi`, `supply_residual_psi`, `supply_flow_gpm`
- `demand_gpm`, `demand_psi` — fields populated by the hydraulic solver
- `riserId` (ref)

### F2. Pascal systems layer — hydraulic + selection
**File:** `packages/core/src/systems/hydraulic-system.ts`, edits to
`selection-system.ts`.

- New `HydraulicSystem` subscribes to scene store. When any PipeNode or
  SprinklerHeadNode mutates, it re-solves Hazen-Williams on the affected
  system (debounced 500ms) and writes `demand_gpm` / `safety_margin_psi`
  onto the SystemNode. Pascal's subscription model is already how
  SlabSystem + LevelSystem keep derived state coherent.
- `SelectionSystem` extension: when a selected node is a PipeNode with
  `role='cross_main'`, all downstream PipeNodes and SprinklerHeadNodes
  (traversing by `flow_direction`) get `highlighted: true` added to their
  visual state. This is the "select a cross main → see every head it feeds"
  AutoSPRINK feature.

### F3. NFPA-aware placement coordinator
**File:** `packages/editor/src/components/tools/sprinkler-head/` (new dir).

- `SprinklerHeadTool` — click-to-place on a CeilingNode. As the cursor
  moves, the tool enforces:
  * Max spacing 15' (Light Hazard), 12' (OH2) — visualized as a red
    bubble around neighbouring heads
  * Minimum 4" from wall
  * Minimum 6' between heads (obstruction rule)
  * Deflector 1"–12" below ceiling (per hazard class)
- Uses the NFPA 13 §8.6 / §8.7 constants in a shared
  `packages/core/src/systems/nfpa13-constants.ts`.

### F4. OpenSCAD real invocation
**File:** `packages/halofire-catalog/src/authoring/openscad-runtime.ts`.

- Detect `openscad` on PATH (fall back to `OPENSCAD_PATH` env).
- `renderScadToGlb(scadPath, params, outPath)` spawns
  `openscad <scadPath> -o <outPath> -D key=value …` and returns the GLB
  path. Cached by (hash(scad + params)) so repeat renders are O(1).
- Wire into `packages/halofire-catalog/src/api/item-render.ts` so when a
  user changes a pipe size via the properties panel, the GLB
  re-renders on the fly instead of looking up a pre-baked path.
- `render_phase44_assets.py` + Trimesh stay as the pre-bake fallback for
  CI / offline environments where OpenSCAD isn't installed.

### F5. PDF autopilot — SSE streaming into the viewport
**Files:** `services/halopenclaw-gateway/main.py` (add `/intake/stream/{job_id}`
SSE endpoint), `apps/editor/components/halofire/AutoPilot.tsx` (new).

- Backend: the orchestrator already fires pipeline-stage callbacks; expose
  them as SSE events (`{stage: 'placer', heads_so_far: 47, ...}`).
- Frontend: `AutoPilot` component consumes the SSE stream. Each event
  spawns the new nodes incrementally — the user watches walls appear,
  then rooms, then hazard zones, then heads, then pipes, live. No more
  polling-then-big-bang.
- The stream also carries per-stage 2D thumbnails (walls.png,
  rooms.png, placed.png) so the user can correct intake (e.g. flag a
  false-positive stair on a mezzanine) before heads are placed on a
  floor that shouldn't have them.

### F6. Bidirectional 2D ↔ 3D correction
**File:** `packages/editor/src/components/floorplan/halofire-annotations.tsx`.

- When intake drops a suspicious wall, it's emitted with a low
  `confidence`. The 2D floorplan view highlights it amber.
- User clicks the amber segment → dialog: "Keep / Delete / Resize".
  Scene mutation flows back through Pascal's store, and the autopilot
  resumes from the classifier stage with the corrected walls.

---

## Execution order

I'm doing these **in order** — each builds on the prior. No skipping to
flashy UI until the foundation exists.

- [x] F1a. SprinklerHeadNode as first-class Pascal node (commit 1)
- [ ] F1b. PipeNode as first-class Pascal node (commit 2)
- [ ] F1c. SystemNode + NFPA hazard classification (commit 3)
- [ ] F2. HydraulicSystem wires into Pascal systems (commit 4)
- [ ] F3. SprinklerHeadTool with NFPA spacing enforcement (commit 5)
- [ ] F4. OpenSCAD runtime invocation (commit 6)
- [ ] F5. SSE autopilot streaming (commit 7)
- [ ] F6. 2D ↔ 3D correction loop (commit 8)

Each commit comes with:
- Unit tests on the Pascal schema (zod parse of valid + invalid shapes)
- Playwright test against the live editor (headless Chromium, production build)
- Python CAD-pipeline integration test where relevant
- Evidence paste: test output + manual browser probe

If a step fails, I stop and fix — no piling on more stubs.

## What NOT to do any more

- No new halofire-namespace wrapper components that add nothing Pascal
  doesn't already provide.
- No "reports that everything is shipped" until the Pascal schema has
  SprinklerHeadNode + PipeNode + SystemNode.
- No Trimesh stand-ins where OpenSCAD is what the user asked for.
- No event-bus bridges that just dispatch ceremonial CustomEvents.

## How to verify I did the real work

After each step, check:
```bash
git diff HEAD~1 --stat | grep -E "packages/(core|editor)/src/"
```

If that output is empty, the commit was wrapper-code, not a Pascal fork
change. Those commits don't count toward the "actual software" goal.
