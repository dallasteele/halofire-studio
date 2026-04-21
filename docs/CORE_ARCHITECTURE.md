# HaloFire Studio — Core Architecture

**Date:** 2026-04-21
**Status:** Technical specification. Guides the construction of the
AutoSPRINK-clone core.
**Scope:** The CAD engine, the visualization layer, the bridge
between them, and everything a fire-protection engineer touches
during a day of drafting + bidding.

This document is GRANULAR — it names files, types, fields, function
signatures, and data flows. Anything abstract ("some layer will
translate") is a contract violation.

Related documents:
- `AUTOSPRINK_CLONE_PLAN_V2.md` — product-level decisions, scoreboard
- `INTEGRATED_STACK_V2.md` — shell/packaging (Tauri + PyInstaller)
- `REAL_PLAN_FORK_PASCAL.md` — Pascal schema fork plan (superseded in part by this doc)
- `CORE_ARCHITECTURE.md` (**this doc**) — the CAD engine, Pascal/OpenSCAD bridge, parts model

---

## 1. The two-engine doctrine

We don't have AutoSPRINK's source. We DO have:

- **Pascal** (forked) — a React + three.js + R3F CAD framework that
  already knows about Site / Building / Level / Slab / Wall /
  Ceiling / Door / Window / Roof / Stair / Item. Scene graph,
  selection, camera, tools, materials, 2D floorplan + 3D split
  view. We add fire-protection node types and systems on top.
- **OpenSCAD** (source, GPL v2) + **Manifold** (its boolean
  backend, MIT) — a complete parametric CAD kernel: CSG booleans,
  extrusions, sweeps, arrays, exact boolean solids, a text DSL.
  This is what fills the gap for fitting geometry, pipe bodies,
  parametric heads, custom fabrication shapes, and anything where
  the estimator needs to twist a dimension and see the mesh change.

**The boundary:**

| Concern | Owner | Rationale |
|---|---|---|
| Building shell (slabs, walls, ceilings, stairs, roofs) | Pascal | Pascal's native primitives are already perfect for this — it's literally what Pascal was built for. |
| Level stack + camera + viewport behavior | Pascal | R3F + drei + Pascal's tool system. |
| Selection, hover, ribbon, panels, command palette | Pascal + HF shell | Pascal's ToolManager + our AutoSPRINK-class ribbon/panels. |
| Sprinkler head catalog geometry | OpenSCAD | One `.scad` per orientation × K × finish = exact mesh, parametric. |
| Pipe body + grooved/threaded ends | OpenSCAD | Length + OD + schedule = one `.scad` template. |
| Fittings (tee / elbow / cross / reducer / cap / flange / union) | OpenSCAD | Port positions are derivable from the .scad parameters → the router uses them directly. |
| Valves (gate, butterfly, check, RPZ, alarm check, ball, globe) | OpenSCAD | Same story. |
| Support hardware (hangers, seismic braces, clamps) | OpenSCAD | Same story. |
| FDC, riser assemblies, compound devices | OpenSCAD | Composable from smaller SCAD primitives via `use <…>` / `include <…>`. |
| Hydraulic solve | HF Core (TS + Python) | Hazen-Williams + Darcy-Weisbach; lives outside both engines. |
| NFPA-13 rule checking | HF Core | Same. |
| Auto-design agent pipeline | HF Agents (Python) | Same. |
| Final mesh shown in viewport | Pascal | Receives the glTF the SCAD engine produced. |

Said another way: **Pascal knows the building; OpenSCAD knows the
parts; HF Core knows the rules.**

---

## 2. The three-tier OpenSCAD integration

AutoSPRINK gets away with a single render engine because everything
is in-process. We have to straddle a Rust host + WebView + Python
sidecar. That constraint forces three tiers of SCAD evaluation —
each tier optimizes for a different moment in the user's workflow.

### Tier 1 — Design-time pre-bake (ship-with-the-app)

**When:** At `tauri build` time, for every SCAD file in
`packages/halofire-catalog/authoring/scad/`.
**Engine:** Native OpenSCAD CLI (subprocess from the build script).
**Output:** One `.glb` per (SCAD file, canonical parameter bundle).
**Stored at:** `packages/halofire-catalog/assets/glb/SM_*.glb`, copied
into the Tauri resource dir at bundle time.
**Purpose:** The app always has SOMETHING to render the moment the
user selects a catalog item, even if OpenSCAD isn't installed.
These are the fallback meshes.

### Tier 2 — Interactive runtime re-render (on parameter change)

**When:** User changes a dimension (pipe size, valve size, head
K-factor) and we need a fresh mesh in < 300 ms.
**Engine (Windows/macOS/Linux desktop):** Bundled OpenSCAD binary
(`src-tauri/bin/openscad-<triple>`), invoked by the Rust
`render_scad` command with content-hash caching.
**Engine (browser / no binary):** `openscad-wasm` loaded into the
webview (last-resort fallback — STL only, slower).
**Output:** GLB written to `app_data_dir()/openscad-cache/{hash}.glb`.
**Purpose:** The "turn the knob" interactive loop.

### Tier 3 — Live preview mesh (while dragging)

**When:** The user is actively dragging an endpoint / extending a
pipe / stretching a fitting. We need updates at 30-60 fps.
**Engine:** `three-bvh-csg` / Manifold-js in the webview, operating
on cached Tier-1 meshes. No OpenSCAD round-trip.
**Output:** A transient three.js BufferGeometry held in scene.
**Purpose:** The interactive preview while a gesture is in flight.
On commit, Tier 2 replaces it with the authoritative GLB.

### Decision tree per operation

```
User action
  │
  ▼ Is it a pure transform (move, rotate, scale)?
  │   YES → three.js matrix update only. No SCAD eval. 60 fps.
  │   NO ↓
  │
  ▼ Is it a dimension change on an existing part?
  │   YES → Tier 3 for preview during drag → Tier 2 on mouseup.
  │   NO ↓
  │
  ▼ Is it a brand-new part instantiation?
  │   YES → Use Tier 1 pre-bake if catalog SKU matches →
  │         Tier 2 if SKU differs from pre-bake params.
  │   NO ↓
  │
  ▼ Is it a custom user-authored SCAD?
  │   YES → Tier 2 always. Warn if > 2 s.
```

### What we DON'T do

- **We do NOT fork OpenSCAD source into our repo.** GPL propagation
  + build-system misery + we only need ~8% of its features. We
  consume it as a subprocess. The APPROACH ("parametric SCAD files
  define parts") is what we borrow — not the compiled code.
- **We do NOT use OpenSCAD for buildings.** Slabs, walls, levels,
  ceilings stay Pascal. OpenSCAD would be a hammer for those nails.
- **We do NOT use openscad-wasm as the primary engine.** It's STL-
  only, no fonts, slower than native. It's the last-resort fallback
  when the bundled binary is missing (for whatever reason).

---

## 3. The HF Core bridge layer

New package: `packages/hf-core/`. Lives between Pascal and the
SCAD engine. TypeScript, no Three.js deps, no Python deps —
callable from both the webview and the pipeline.

### 3.1 Directory layout

```
packages/hf-core/
├─ package.json                  @halofire/core
├─ src/
│  ├─ index.ts                   Barrel
│  ├─ catalog/
│  │  ├─ index.ts                loadCatalog(), findSku(), Part
│  │  ├─ part.ts                 Part, PartKind, PartCategory
│  │  ├─ params.ts               Parameter typing + validation
│  │  ├─ ports.ts                ConnectionPort (where fittings plug in)
│  │  └─ catalog-json.ts         catalog.json loader
│  ├─ nfpa13/
│  │  ├─ spacing.ts              §8.6 spacing tables, OH1/OH2/LH/EH1/EH2
│  │  ├─ density-area.ts         §19 density / remote-area tables
│  │  ├─ hose-allowance.ts       Table 19.3.3.1.1
│  │  ├─ obstruction.ts          §8.7 obstruction rules
│  │  ├─ sprig.ts                §23.4.5 sprig rules
│  │  ├─ hydraulic.ts            Hazen-Williams, k-factor, K√P
│  │  └─ rule-check.ts           Runs all checks over a Design
│  ├─ hydraulic/
│  │  ├─ hardy-cross.ts          Loop solver
│  │  ├─ darcy-weisbach.ts       Alt friction formula
│  │  ├─ equivalent-length.ts    Fitting K tables → equiv length
│  │  ├─ pressure-node.ts        Network graph
│  │  └─ remote-area.ts          Design-area method implementation
│  ├─ scad/
│  │  ├─ types.ts                ScadParamSchema, ScadInvocation
│  │  ├─ cache-key.ts            hash(scadBytes, params) — identical to Rust
│  │  ├─ parse-params.ts         Parse `// @param …` annotations in .scad
│  │  └─ manifest.ts             scad-manifest.json loader
│  ├─ design/
│  │  ├─ design.ts               Design — the authoritative bid object
│  │  ├─ system.ts               SystemGraph — pipe network per riser
│  │  ├─ bom.ts                  assembleBom(design) → BomRow[]
│  │  └─ labor.ts                estimateLabor(design) → LaborRow[]
│  ├─ router/
│  │  ├─ graph.ts                PipeGraph — connectivity DS
│  │  ├─ route-branch.ts         Place branch lines through a room
│  │  └─ route-main.ts           Cross-main routing
│  └─ report/
│     ├─ nfpa13.ts               NFPA 13 §27 + Annex E report builder
│     ├─ hydralist.ts            Supplier .hlf export
│     └─ ahj-submittal.ts        Composite submittal bundle
└─ tests/
   ├─ catalog.spec.ts
   ├─ nfpa13.spec.ts
   ├─ hydraulic.spec.ts
   └─ golden/                    Known-input → known-output fixtures
```

### 3.2 Why TypeScript for HF Core

Python already owns the agent pipeline (intake, classifier, placer,
router, hydraulic). We keep it. But the INTERACTIVE loop runs in
the webview, and we need NFPA rule-check + hydraulic preview to
run there without a round-trip through Python. So the core
library is TypeScript, and the Python pipeline re-uses the same
TS via `quickjs-emscripten` bindings OR via a dual-compiled
transpilation (Python code that mirrors the TS for the batch path).

Pragmatic split:
- **Canonical source of truth = TypeScript** under `packages/hf-core`.
- **Python mirror** under `services/halofire-cad/cad/core_mirror/`
  re-implements the same algorithms with the same golden tests. Two
  code paths, one contract, one set of fixtures.
- CI fails if the TS + Python paths produce different numbers on
  the shared golden fixtures.

---

## 4. Part catalog — the bridge between SCAD and Pascal

This is THE most important schema in the app.

### 4.1 Part (TypeScript)

```typescript
// packages/hf-core/src/catalog/part.ts

export type PartKind =
  | 'sprinkler_head'
  | 'pipe_segment'
  | 'fitting'       // tee, elbow, cross, reducer, cap, flange, union
  | 'valve'
  | 'hanger'
  | 'device'        // flow/tamper/pressure switch, gauge
  | 'fdc'
  | 'riser_assy'
  | 'compound'      // user-composed part
  | 'structural'    // column, beam, joist — mostly intake-derived

export type PartCategory =
  | 'head.pendant.k56'
  | 'head.pendant.k80'
  | 'head.pendant.esfr.k112'
  | 'pipe.sch10.grooved'
  | 'pipe.sch10.threaded'
  | 'pipe.cpvc.blazemaster'
  | 'fitting.tee.grooved'
  | 'fitting.elbow90.grooved'
  | 'fitting.elbow45.grooved'
  | 'fitting.cross'
  | 'fitting.reducer.concentric'
  | 'fitting.reducer.eccentric'
  | 'fitting.cap'
  | 'fitting.flange.150'
  | 'fitting.union'
  | 'valve.gate.osy'
  | 'valve.butterfly.grooved'
  | 'valve.check.swing'
  | 'valve.alarm.check.wet'
  | 'valve.rpz.backflow'
  | 'hanger.clevis'
  | 'hanger.trapeze'
  | 'hanger.seismic.sway'
  | 'hanger.c.clamp.beam'
  | 'device.flow.switch'
  | 'device.tamper.switch'
  | 'device.pressure.switch'
  | 'device.gauge.liquid'
  | 'fdc.2.5in.stortz'
  // ... extensible

export type ConnectionStyle =
  | 'NPT_threaded'
  | 'grooved'
  | 'flanged.150'
  | 'flanged.300'
  | 'solvent_welded'   // CPVC
  | 'soldered'          // copper
  | 'stortz'            // FDC quick-connect
  | 'none'

export interface ConnectionPort {
  /** Local frame of the port on the part. */
  position_m: [number, number, number]
  /** Unit vector pointing OUT of the part (toward the next pipe). */
  direction: [number, number, number]
  /** What pipe style/size mates with this port. */
  style: ConnectionStyle
  size_in: number
  /** Primary run / branch identifier — router uses this. */
  role: 'run_a' | 'run_b' | 'branch' | 'drop'
}

export interface ScadSource {
  /** Relative to packages/halofire-catalog/authoring/scad/ */
  scadFile: string
  /** Allowed params + their types, extracted from `// @param` lines. */
  paramSchema: Record<string, ScadParam>
  /** Default param bundle used for the pre-baked Tier-1 GLB. */
  defaults: Record<string, number | string | boolean>
}

export interface Part {
  sku: string                     // canonical SKU — the BOM identity
  kind: PartKind
  category: PartCategory
  displayName: string
  manufacturer?: string            // 'tyco' | 'viking' | 'reliable' | …
  mfgPartNumber?: string
  scad: ScadSource
  ports: ConnectionPort[]
  nfpa: {
    k_factor?: number              // sprinklers
    orientation?: string           // sprinklers
    listing?: string               // UL / FM
    hazardClasses?: string[]       // approved for (LH, OH1, …)
  }
  pricing: {
    list_usd: number
    stale_at?: string              // ISO
    source?: 'static' | 'crawler' | 'manual'
  }
  labor: {
    minutes_install: number
    crew_role: 'foreman' | 'journeyman' | 'apprentice' | 'mixed'
  }
  weight_kg?: number
  thumbnailPng?: string
  /** Pre-baked Tier-1 GLB path (relative to catalog/assets/glb/). */
  defaultGlb: string
}
```

### 4.2 SCAD parameter schema via annotations

Every catalog `.scad` file declares its parameters at the top with
machine-readable annotations:

```openscad
// @part head_pendant_qr_k80
// @category head.pendant.k80
// @kind sprinkler_head
// @mfg tyco
// @mfg-pn TY-B TY1234
// @listing UL-fm
// @k-factor 8.0
// @orientation pendant
// @param size_in enum[0.5,0.75,1] default=0.5 label="Thread size"
// @param finish enum[brass,chrome,white,black] default=brass
// @port center position=[0,0,0] direction=[0,-1,0] style=NPT_threaded size_in=0.5 role=run_a

size_in = 0.5;
finish = "brass";
// ...
```

A parser in `packages/hf-core/src/scad/parse-params.ts` turns
these into `Part` objects at build time. The parser is
ONE FILE — everyone with a SCAD authoring environment adds a
part by authoring a .scad with annotations; the catalog generator
picks it up automatically. No JSON edits.

### 4.3 Catalog manifest

Build step `bun run catalog:build`:
1. Walks `packages/halofire-catalog/authoring/scad/*.scad`.
2. Parses annotations.
3. Validates every parameter has a type + default.
4. Pre-bakes the default GLB (Tier 1, OpenSCAD subprocess).
5. Writes `packages/halofire-catalog/catalog.json` with the full
   `Part[]` array.

Runtime consumers load `catalog.json` once (~100 KB, zstd-compressed
at build) and resolve SKUs via `findSku(sku)`.

---

## 5. Pascal node types for fire protection

Already landed: `SprinklerHeadNode`, `PipeNode`, `SystemNode`.
Still to add, as first-class Pascal node types:

```
packages/core/src/schema/nodes/
├─ fitting.ts             FittingNode — tee/elbow/cross/reducer/cap/flange/union
├─ valve.ts               ValveNode
├─ hanger.ts              HangerNode
├─ device.ts              DeviceNode — flow/tamper/pressure/gauge
├─ fdc.ts                 FDCNode
├─ riser-assembly.ts      RiserAssemblyNode — multi-part composite
└─ remote-area.ts         RemoteAreaNode — NFPA §19 design area polygon
```

Each follows the same pattern as `SprinklerHeadNode`:

```typescript
export const FittingNode = BaseNode.extend({
  id: objectId('fitting'),
  type: nodeType('fitting'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  sku: z.string(),
  kind: z.enum([
    'tee', 'elbow_90', 'elbow_45', 'cross',
    'reducer_concentric', 'reducer_eccentric',
    'cap', 'flange', 'union', 'nipple',
  ]),
  size_in: z.number(),
  sizeBranch_in: z.number().optional(),
  connectionStyle: z.enum([
    'NPT_threaded', 'grooved', 'flanged_150', 'solvent_welded',
  ]),
  // Runtime: which pipe IDs are plugged into which ports
  portConnections: z.array(z.object({
    portRole: z.enum(['run_a', 'run_b', 'branch', 'drop']),
    pipeId: z.string().optional(),
  })).default([]),
  systemId: z.string().optional(),
  hydraulic: z.object({
    equivalent_length_ft: z.number(),
    pressure_loss_psi: z.number(),
  }).partial().optional(),
})
```

`AnyNode` discriminated union now covers 10 fire-protection types
alongside Pascal's original primitives.

### 5.1 Why not just tag ItemNodes?

Because Pascal's systems (ToolManager, SelectionSystem, SnapSystem)
dispatch on `node.type`. If a pipe is an ItemNode with
`tags: ['pipe']`, selection-highlights-downstream needs to reflect
over tags. If a pipe is a `PipeNode`, selection-highlights-downstream
is a 3-line switch case and the type system enforces the fields
exist.

First-class types also let the NFPA rule checker narrow via the
discriminator: `if (node.type === 'sprinkler_head')` — no `as any`,
no tag sniff.

---

## 6. The parametric update hot path

This is the flow when a user drags a pipe endpoint. Every
millisecond matters here — this is the moment the product feels
like a CAD tool or doesn't.

```
t=0ms  MouseDown on a pipe handle
       │
       ▼ Pascal SelectionSystem → mark as "active edit"
       │
t=16ms MouseMove (first frame)
       │
       ▼ Pascal MoveTool computes new endpoint in level-local coords
       │
       ▼ Pascal updates scene store: updateNode(pipeId, { end_m: … })
       │
       ▼ HalofireNodeWatcher subscribes → detects position change
       │
       ▼ HF Core PipeGraph.updateSegment(pipeId, end_m)
       │   - recomputes length_m
       │   - marks fittings at both ends as "stale"
       │
       ▼ Tier-3 preview geometry:
       │   three.js scales the existing pipe cylinder mesh along
       │   its length, rotates to new direction. 1-matrix update.
       │
       ▼ Render frame — 60 fps maintained.
       │
t=..   MouseMove continues → repeats every frame.
       │
t=N    MouseUp — gesture committed.
       │
       ▼ HF Core invalidates fittings whose port positions no longer
       │ match incoming pipe endpoints (could be zero or more).
       │
       ▼ For each invalidated fitting:
       │   invoke('render_scad', {
       │     name: fitting.scadFile,
       │     params: { size_in: fitting.size_in,
       │               branch_size_in: fitting.sizeBranch_in,
       │               port_offset_m: computed },
       │   })
       │
       ▼ Rust render_scad — hash-keyed cache lookup.
       │   Cache hit  (likely): 2-5 ms.
       │   Cache miss: spawn openscad → 200-1500 ms depending on part.
       │
       ▼ For each new GLB: Pascal's GLTF loader swaps the mesh in place.
       │
       ▼ Background: HF Core HydraulicSystem re-solves affected
       │ SystemNode(s) (debounced 300 ms). Writes demand_gpm,
       │ safety_margin_psi back onto the SystemNode.
       │
       ▼ LiveCalc panel shows updated flow / pressure / margin /
         bid delta.
```

### 6.1 Fitting invalidation — the interesting case

When a pipe's endpoint moves, the fittings it plugs into often
don't change (same tee, same orientation — just a different pipe
length feeds it). We invalidate only when:

1. A fitting's `port_offset_m` would change to stay flush with the
   new pipe endpoint. (Some fittings have an adjustable offset
   parameter — e.g., reducers can be any length.)
2. A fitting's size changes because the new pipe size ≠ the old
   pipe size. (If the estimator up-sized a branch, the tee at its
   head needs to become a reducing tee.)
3. A fitting's orientation changes because a branch angle changed.

Only the invalidated fittings get a fresh SCAD render. Everything
else is a reference re-use.

### 6.2 Preview geometry strategy

For pipes: `three.js cylinder * matrix` covers length + direction.
Radius is constant during drag (a pipe doesn't change size
mid-gesture).

For fittings: pre-baked Tier-1 GLB + bone-less transform. Branch
angles change rarely; if they do, revert to Tier-2 re-render.

For heads: pre-baked Tier-1 GLB + position only. Heads don't have
dimension-dragging edits — they have SKU-swap (which is a new
mesh, not a deform).

---

## 7. The auto-bid pipeline (what writes the scene)

The agents already exist in Python. They produce a `Design` object
— the authoritative bid artifact. The job of the integration
layer is to translate that into Pascal scene nodes.

### 7.1 Canonical Design → Pascal scene translation

Implemented in `apps/editor/components/halofire/spawn-from-design.ts`
(new — extracted from `AutoDesignPanel.tsx`'s inlined logic).

```typescript
// Stateless: Design in, list of NodeCreateOps out.
// The store-wrap + emit happens at the call site.
export function translateDesignToScene(
  design: Design,
  opts: { site_id?: string; building_id?: string } = {},
): NodeCreateOp[]
```

The `NodeCreateOp` list is ordered so the parent tree builds
cleanly:

1. Site (if missing)
2. Building
3. For each Level in design.building.levels:
    a. LevelNode
    b. SlabNode + CeilingNode (polygon from level.polygon_m)
    c. WallNodes (perimeter + interior partitions)
    d. FittingNodes + ValveNodes (structural — columns, beams)
4. SystemNodes
5. For each System:
    a. RiserAssemblyNode
    b. PipeNodes (feed_main → cross_main → branch → drop)
    c. FittingNodes at every pipe junction
    d. HangerNodes
    e. SprinklerHeadNodes
6. DeviceNodes (flow/tamper/pressure switches)
7. RemoteAreaNode (NFPA §19 polygon) — last so it renders on top

### 7.2 Streaming progression

Each stage emits a partial Design slice:
- `intake` emits Site + Building + Levels with slabs + walls.
- `classify` emits hazard-class updates on the LevelNodes.
- `place` emits SprinklerHeadNodes.
- `route` emits PipeNodes + FittingNodes + HangerNodes.
- `hydraulic` emits SystemNode.demand and per-pipe flow_direction.
- `bom` emits no new nodes but annotates with pricing.

The viewport fills in progressively. This matches AutoSPRINK's
Auto-Design experience ("watch the sprinklers appear").

### 7.3 Bidirectional — user corrections feed back

When the user deletes a wall that intake mis-placed, or moves a
head that the placer put too close to an obstruction, we emit a
`halofire:design-correction` event. The pipeline listens and, on
the next auto-design run, seeds the corrections so they're not
overwritten.

Corrections stored in `app_data_dir/projects/{id}/corrections.jsonl`:
```json
{"type": "wall.delete", "id": "wall_xxx", "at": "2026-04-21T…"}
{"type": "head.move", "id": "head_yyy", "from": [..], "to": [..]}
{"type": "pipe.resize", "id": "pipe_zzz", "from": 2, "to": 2.5}
```

---

## 8. AutoSPRINK feature parity matrix

Mapping every tool / concept from the AutoSPRINK training docs to
our implementation. This is the checklist the product is measured
against.

| AutoSPRINK feature | Our component | Tier | Status |
|---|---|---|---|
| Main menu (File / Edit / View / …) | Ribbon top bar | Shell | ✅ done |
| Pipe Toolbar: continuous pipe, elevation lock, style | `Ribbon/PipeTab.tsx` + `tools/pipe-tool.tsx` | 2 | 🔲 new |
| Actions Toolbar: 7 fly-outs | `Ribbon/ActionsTab.tsx` | 2 | 🟡 partial |
| Finish Toolbar: label update, dimensioning, text boxes | `Ribbon/FinishTab.tsx` | 3 | 🔲 |
| View Toolbar: iso, top, zoom, camera | `ViewerToolbarLeft.tsx` + camera presets | 1 | ✅ done (Pascal) |
| Snaps Toolbar: ortho, center, endpoint, perpendicular, intersection | `packages/core/src/systems/snap/` (new) | 2 | 🔲 new |
| Hydraulics Toolbar: remote area, reports | `Ribbon/AnalyzeTab.tsx` + `LiveCalc.tsx` | 2 | 🟡 partial |
| Auto Draw: auto-fittings, auto-couplings, auto-hangers, sway bracing | `agents/03-router/` (auto) + `tools/auto-draw-tool.tsx` (manual) | 1 | 🟡 partial |
| Select Toolbar: benchmark, crossing window, Z-lock | Pascal's selection + `tools/z-lock-tool.tsx` (new) | 2 | 🔲 new |
| Location Input Window (XYZ coordinates) | `components/halofire/LocationInput.tsx` (new, docked to viewport) | 1 | 🔲 new |
| ISO Rotator tools (roll, yaw, rotate, elevation) | Pascal built-in | 1 | ✅ done (Pascal) |
| Sprinkler place (single, grid, array) | `tools/sprinkler-place-tool.tsx` (single), `tools/sprinkler-array-tool.tsx` (array) | 1 | 🔲 new |
| Pipe route (start→end, continuous, orthogonal) | `tools/pipe-route-tool.tsx` | 1 | 🔲 new |
| Branch continuous pipe between heads | `tools/branch-through-heads-tool.tsx` | 1 | 🔲 new |
| Sprinkler connection (drop from branch to head) | `tools/sprinkler-connect-tool.tsx` | 1 | 🔲 new |
| Modify pipe (split, join, trim) | `tools/pipe-modify-tool.tsx` | 2 | 🔲 new |
| Remote Area wizard | `components/halofire/RemoteAreaDraw.tsx` | 1 | 🟡 partial |
| Hydraulic calc (Hazen-Williams) | `hf-core/hydraulic/` | 1 | 🟡 partial |
| NFPA rule check | `hf-core/nfpa13/rule-check.ts` | 1 | 🟡 partial |
| Stocklist (BOM) | `hf-core/design/bom.ts` + `Ribbon/ReportTab.tsx` | 1 | ✅ done |
| Hydralist export (.hlf) | `agents/06-bom/hydralist.py` | 1 | ✅ done |
| Hydraulic report (NFPA 8-section) | `agents/10-submittal/nfpa_report.py` | 1 | ✅ done |
| Submittal package | `hf-core/report/ahj-submittal.ts` | 2 | 🔲 new |
| Pre-fab drawings | `agents/08-drafter/` + DXF export | 2 | 🟡 partial |
| 3D coordination with BIM | IFC round-trip (`@halofire/ifc`) | 3 | 🟡 partial |
| Dialog Boxes for settings | `components/halofire/settings-dialog.tsx` + sub-dialogs | 2 | 🔲 new |

Legend: ✅ complete / 🟡 partial / 🔲 not started.

---

## 9. Final monorepo layout (target)

```
halofire-studio/
├─ apps/
│  ├─ editor/                    Next.js frontend (webview content)
│  └─ halofire-studio-desktop/   Tauri 2 shell ← ships as HaloFireStudio.exe
├─ packages/
│  ├─ core/                      Pascal fork — scene graph + primitives
│  │  └─ src/schema/nodes/       + sprinkler-head, pipe, system, fitting, valve, hanger, device, fdc, riser-assembly, remote-area
│  ├─ editor/                    Pascal fork — ToolManager + shell UI
│  │  └─ src/components/tools/   + sprinkler-place, pipe-route, pipe-modify, auto-draw, snap, z-lock
│  ├─ viewer/                    Pascal fork — R3F viewport
│  ├─ hf-core/                   NEW — the bridge layer (this doc's §3)
│  ├─ halofire-catalog/          SCAD-authored parts + pre-baked GLBs
│  │  ├─ authoring/scad/         ← .scad files with @param annotations
│  │  ├─ assets/glb/             ← pre-baked GLBs (Tier 1)
│  │  └─ catalog.json            ← generated Part[] manifest
│  ├─ halofire-schema/           Zod schemas shared across TS/Python
│  ├─ halofire-halopenclaw-client/  DEPRECATED — HTTP client stays for CI
│  ├─ halofire-ai-bridge/        Claude agent wrapper
│  ├─ halofire-ifc/              IFC I/O
│  └─ ui/                        Shared design primitives
├─ services/
│  ├─ halofire-cad/              Python pipeline (agents)
│  ├─ halofire-cad/cad/core_mirror/  Python mirror of hf-core (golden-tested)
│  ├─ halopenclaw-gateway/       DEPRECATED — feature-flagged off by default
│  └─ halofire-catalog-crawler/  Supplier price crawler
└─ docs/                         Architecture + plans + process
```

---

## 10. Testing strategy

### 10.1 Layer-by-layer

| Layer | Test runner | Location | What we assert |
|---|---|---|---|
| Pascal core (schema) | Playwright (Node) | `apps/editor/e2e/pascal-fork.spec.ts` | zod round-trip, discriminator, helpers |
| HF Core algorithms | vitest | `packages/hf-core/tests/` | NFPA 13 tables, H-W, rule-check golden fixtures |
| Python pipeline | pytest | `services/halofire-cad/tests/` | Per-agent unit + e2e full pipeline |
| Catalog parser | vitest | `packages/hf-core/tests/catalog.spec.ts` | Each .scad annotation → Part |
| SCAD runtime | pytest | `services/halopenclaw-gateway/tests/` | Cache hit, fallback, detect-binary |
| Tauri commands | Rust unit + Playwright | `apps/halofire-studio-desktop/src-tauri/src/` + `apps/editor/e2e/` | invoke → expected response + event stream |
| Frontend UI | Playwright | `apps/editor/e2e/*.spec.ts` | Ribbon, LayerPanel, HalofireProperties, LiveCalc behavior |
| Cruel-test scoreboard (1881 truth) | pytest | `services/halofire-cad/tests/cruel/` | head_count / system_count / total_bid within tolerance |

### 10.2 Cross-engine golden fixtures

For every algorithm that exists in both TypeScript AND Python
(hydraulic, NFPA rule-check, BOM roll-up, labor estimate):

`packages/hf-core/tests/golden/{fixture}.json` describes a shaped
input + expected output. Both runners load the same file and
compare numerically. CI fails if either implementation drifts.

### 10.3 Live-app Playwright against the Tauri webview

Tauri 2 ships with a WebDriver that Playwright can attach to.
Smoke path tests the real integrated stack:

```typescript
// apps/halofire-studio-desktop/e2e/full-flow.spec.ts
test('drop PDF → bid', async ({ page }) => {
  // Launch the built HaloFireStudio.exe
  // page is attached to its webview
  await page.setInputFiles('[data-testid=upload]', '1881.pdf')
  await expect(page.getByText('intake')).toBeVisible()
  await expect(page.getByText('heads: 1,293')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('$595,149')).toBeVisible()
})
```

---

## 11. Execution order — atomic commit plan

This supersedes the step-list in `REAL_PLAN_FORK_PASCAL.md`. Each
item = one commit, buildable on its own, with tests.

### Phase I — Catalog is source-of-truth

1. **I1.** `packages/hf-core/src/scad/parse-params.ts` + test.
2. **I2.** `packages/hf-core/src/catalog/part.ts` + `ports.ts` +
   zod schemas + tests against every existing .scad file.
3. **I3.** Annotate the 40 existing .scad files in
   `authoring/scad/` with `@part`, `@category`, `@kind`, `@port`,
   `@param`. Commit in batches of 10.
4. **I4.** `scripts/build-catalog.ts` — walks annotations, emits
   `catalog.json`. Wire as `turbo run catalog:build`.
5. **I5.** `packages/hf-core/src/catalog/index.ts` —
   `loadCatalog()`, `findSku()`, `findCategory()`. Tests.

### Phase II — Pascal first-class fire-protection nodes

6. **II1.** `packages/core/src/schema/nodes/fitting.ts` + tests.
7. **II2.** `valve.ts` + tests.
8. **II3.** `hanger.ts` + `device.ts` + `fdc.ts` + tests.
9. **II4.** `riser-assembly.ts` (composite) + `remote-area.ts` +
   tests.
10. **II5.** AnyNode discriminator update + schema/index barrel.
11. **II6.** Pascal `SelectionSystem` extension: traverse
    downstream via `flow_direction` on PipeNode. Test.

### Phase III — Interactive tools (the AutoSPRINK moment)

12. **III1.** `packages/core/src/systems/snap/` — ortho, center,
    endpoint, perp, intersection. Test each against golden points.
13. **III2.** `tools/sprinkler-place-tool.tsx` — click ceiling →
    head. Enforces §8.6 min-distance-from-wall live.
14. **III3.** `tools/sprinkler-array-tool.tsx` — drag a rectangle
    → grid of heads on spacing pulled from hazard class.
15. **III4.** `tools/pipe-route-tool.tsx` — click-click-click
    polyline pipe routing. Orthogonal + free-angle modes.
16. **III5.** `tools/pipe-modify-tool.tsx` — split, join, trim.
17. **III6.** `tools/sprinkler-connect-tool.tsx` — branch pipe
    auto-drops to every head in a row.
18. **III7.** `LocationInput.tsx` — XYZ chip docked below the
    viewport when a placement tool is active.

### Phase IV — Core algorithms (TS + Python mirror)

19. **IV1.** `hf-core/nfpa13/spacing.ts` + `density-area.ts` +
    `hose-allowance.ts`. Python mirror in `core_mirror/nfpa13.py`.
    Golden fixtures.
20. **IV2.** `hf-core/hydraulic/hardy-cross.ts` + Python mirror.
21. **IV3.** `hf-core/hydraulic/equivalent-length.ts` + tables +
    Python mirror.
22. **IV4.** `hf-core/nfpa13/rule-check.ts` — runs all NFPA 13 §8
    rules across a Design. Python mirror. Golden fixture from the
    1881 project.

### Phase V — Live hydraulic + rule feedback

23. **V1.** Install `HydraulicSystem` from Pascal core into the
    webview — it's already written; just wire into the scene
    store on app boot.
24. **V2.** `components/halofire/RuleCheckPanel.tsx` — real-time
    violations list. Click a violation → viewport pans + selects
    the offending node.
25. **V3.** LiveCalc panel consumes hf-core hydraulic output —
    no more gateway round-trip.

### Phase VI — Auto-bid reflow

26. **VI1.** Extract `spawn-from-design.ts` from AutoDesignPanel.
    Take Design in, emit NodeCreateOp[]. Test with the 1881
    fixture.
27. **VI2.** Stream Design slices per pipeline stage. AutoPilot
    consumes the stream → viewport fills progressively.
28. **VI3.** `corrections.jsonl` round-trip — user deletes wall,
    re-run pipeline, deletion persists.

### Phase VII — AutoSPRINK ribbon completion

29. **VII1.** `Ribbon/PipeTab.tsx`.
30. **VII2.** `Ribbon/ActionsTab.tsx` with 7 fly-outs.
31. **VII3.** `Ribbon/FinishTab.tsx`.
32. **VII4.** `Ribbon/AnalyzeTab.tsx` (hydraulic + rule-check).
33. **VII5.** `Ribbon/ReportTab.tsx`.

### Phase VIII — Tauri integration (the V2 plan)

34. **VIII1.** A2 `apps/editor` static export config.
35. **VIII2.** A3 `apps/editor/lib/ipc.ts`.
36. **VIII3.** B3 Rust `run_pipeline` wired to Python sidecar.
37. **VIII4.** C2 OpenSCAD binary vendored.
38. **VIII5.** D1-D3 frontend rewire.
39. **VIII6.** E1 `tauri build` → `HaloFireStudio.msi`.

### Phase IX — AHJ submittal polish

40. **IX1.** Submittal bundle assembler (NFPA 13 §27 + Annex E
    + stamped PDFs + IFC export + BOM + Hydralist + proposal).
41. **IX2.** PE-signoff workflow.
42. **IX3.** Bid approval → submission to AHJ portal (manual
    for now; API later).

---

## 12. Non-negotiable invariants

These don't get violated without a documented ADR:

- **Pascal never knows what a K-factor is.** Fire-protection
  knowledge lives in hf-core and the fire-protection node types
  we add to Pascal's schema. Pascal systems dispatch on
  `node.type` only.
- **OpenSCAD never knows what NFPA is.** It's a geometry kernel.
  NFPA-aware placement, rule checking, and hydraulics are HF Core.
- **No two code paths compute the same hydraulic number.** One
  source (hf-core TS), a Python mirror pinned to identical
  behavior via golden fixtures. CI breaks on drift.
- **Every catalog item is traceable to a SCAD source.** No
  hardcoded meshes. No "we'll replace this with a real model
  later." If an item is in BOM, a .scad file is in the repo.
- **The desktop shell has zero localhost ports at runtime.** HTTP
  gateway survives for CI + MCP only.

---

## 13. Where to start tomorrow

Phase I — catalog. Every other phase depends on the catalog
being real, so it goes first. Specifically:

- Write I1 (parser).
- Write I2 (Part schema).
- Pick the 10 simplest SCAD files (pipe/elbow/tee/reducer/cap/
  flange/union + three head variants) and annotate them (I3).
- Generate the first catalog.json (I4).
- Feed it to the existing HalofireProperties panel → dropdowns
  populated from real data. (This gives a visible proof.)

Ship I1–I5 over ~2 commits; that's tomorrow's work.

Phase I is the foundation. Once the catalog is queryable, Phase II
(Pascal fire-protection node types) wires it into the scene, and
Phase III (tools) gives the user the click-to-place experience
that makes this an AutoSPRINK clone and not a 3D viewer.
