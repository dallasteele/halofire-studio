# Blueprint 04 — Pascal Node Types & Systems

**Scope:** Fire-protection node types added to Pascal core, the
SelectionSystem traversal extensions, the HydraulicSystem reactor.

## 1. Node type inventory

Already landed:

| Node | Shape | Discriminator | File |
|---|---|---|---|
| `SprinklerHeadNode` | K-factor + orientation + SKU | `type='sprinkler_head'` | `packages/core/src/schema/nodes/sprinkler-head.ts` |
| `PipeNode` | start/end/size/schedule/role | `type='pipe'` | `packages/core/src/schema/nodes/pipe.ts` |
| `SystemNode` | kind/hazard/supply/design/demand | `type='system'` | `packages/core/src/schema/nodes/system.ts` |

To add:

| Node | Shape | File |
|---|---|---|
| `FittingNode` | tee/elbow/cross/reducer/cap/flange/union | `fitting.ts` |
| `ValveNode` | gate/butterfly/check/alarm/rpz/ball/globe | `valve.ts` |
| `HangerNode` | clevis/trapeze/seismic-sway/c-clamp | `hanger.ts` |
| `DeviceNode` | flow/tamper/pressure switch, gauge | `device.ts` |
| `FDCNode` | stortz/threaded hose connection | `fdc.ts` |
| `RiserAssemblyNode` | composite: riser pipe + check + trim | `riser-assembly.ts` |
| `RemoteAreaNode` | NFPA §19 design-area polygon | `remote-area.ts` |
| `ObstructionNode` | duct/beam/column obstructing heads | `obstruction.ts` |
| `SheetNode` | one sheet of the submittal (see blueprint 07) | `sheet.ts` |

## 2. Common shape (template)

Every fire-protection node:

```typescript
export const FooNode = BaseNode.extend({
  id: objectId('foo'),
  type: nodeType('foo'),

  // Spatial — level-local for in-building items, world for site items.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // Catalog identity (for items that come from the catalog).
  sku: z.string().optional(),

  // Graph cross-refs into other fire-protection nodes.
  systemId: z.string().optional(),

  // Derived state the HydraulicSystem fills in on every solve.
  hydraulic: z.object({ /* domain-specific */ }).partial().optional(),

  // For catalog-backed items, a pointer to the rendered GLB.
  // Absent → use catalog default GLB.
  glb_override: z.string().optional(),
})
```

Exported via `packages/core/src/schema/index.ts`. Added to
`AnyNode` discriminated union in `types.ts`.

## 3. FittingNode details

```typescript
export const FittingNode = BaseNode.extend({
  id: objectId('fitting'),
  type: nodeType('fitting'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),                          // Catalog part
  kind: z.enum([
    'tee', 'elbow_90', 'elbow_45', 'cross',
    'reducer_concentric', 'reducer_eccentric',
    'cap', 'flange', 'union', 'nipple', 'coupling',
  ]),
  size_in: z.number(),                      // primary run size
  size_branch_in: z.number().optional(),    // reducing fittings
  connection_style: z.enum([
    'NPT_threaded', 'grooved', 'flanged_150', 'flanged_300',
    'solvent_welded', 'soldered',
  ]),

  port_connections: z.array(z.object({
    port_role: z.enum(['run_a', 'run_b', 'branch', 'drop']),
    pipe_id: z.string().optional(),
  })).default([]),

  systemId: z.string().optional(),

  hydraulic: z.object({
    equivalent_length_ft: z.number(),
    pressure_loss_psi: z.number(),
  }).partial().optional(),
})
```

## 4. ValveNode details

```typescript
export const ValveNode = BaseNode.extend({
  id: objectId('valve'),
  type: nodeType('valve'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'gate_osy', 'gate_pivy', 'butterfly', 'check_swing', 'check_wafer',
    'alarm_check_wet', 'deluge', 'preaction', 'rpz_backflow',
    'ball', 'globe', 'control_valve',
  ]),
  size_in: z.number(),
  connection_style: z.enum([
    'NPT_threaded', 'grooved', 'flanged_150', 'flanged_300',
  ]),

  // Runtime state (where known)
  state: z.enum(['open', 'closed', 'throttled']).default('open'),
  throttle_pct: z.number().min(0).max(100).optional(),
  supervised: z.boolean().default(false),   // tamper switch attached?

  systemId: z.string().optional(),

  hydraulic: z.object({
    cv_flow_coefficient: z.number().optional(),
    equivalent_length_ft: z.number().optional(),
    pressure_loss_psi: z.number().optional(),
  }).partial().optional(),
})
```

## 5. HangerNode details

```typescript
export const HangerNode = BaseNode.extend({
  id: objectId('hanger'),
  type: nodeType('hanger'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'clevis', 'split_ring', 'trapeze', 'roller',
    'seismic_sway_lateral', 'seismic_sway_longitudinal',
    'c_clamp_beam', 'c_clamp_deck', 'strap',
  ]),
  pipe_id: z.string(),                      // what pipe it supports
  size_in: z.number(),                      // sized to pipe

  structural: z.object({
    attach_to_type: z.enum(['beam', 'joist', 'deck', 'concrete', 'unistrut']),
    attach_to_id: z.string().optional(),
    load_kg: z.number().optional(),
  }).optional(),
})
```

## 6. DeviceNode details

```typescript
export const DeviceNode = BaseNode.extend({
  id: objectId('device'),
  type: nodeType('device'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'flow_switch_paddle',
    'flow_switch_vane',
    'tamper_switch_osy',
    'tamper_switch_pivy',
    'pressure_switch',
    'pressure_gauge',
    'temperature_switch',
    'water_motor_gong',
    'test_and_drain',
  ]),

  attaches_to: z.enum(['pipe', 'valve', 'riser', 'wall']),
  attaches_to_id: z.string().optional(),

  supervised: z.boolean().default(true),
  conduit_run_id: z.string().optional(),    // fire alarm electrical
})
```

## 7. FDCNode / RiserAssemblyNode / RemoteAreaNode / ObstructionNode

See `packages/core/src/schema/nodes/*.ts` (to be authored per
blueprint); follow the template in §2.

Notable fields:

- `FDCNode.class` ∈ {stortz_5in, stortz_2_5in_single, stortz_2_5in_twin,
   threaded_2_5in}; `FDCNode.sign_id?`, `FDCNode.distance_to_hydrant_ft`.
- `RiserAssemblyNode.children_ids` — roll-up of its constituent
  pipe/valve/check/gauge nodes.
- `RemoteAreaNode.polygon_m: [number,number][]`,
  `hazard_class`, `computed_area_ft2`, `is_most_remote: boolean`.
- `ObstructionNode.kind` ∈ {duct, beam, column, joist, equipment,
   light, diffuser}; `bbox_min`, `bbox_max`; `source: 'manual' | 'ifc' | 'intake'`.

## 8. AnyNode discriminator

```typescript
// packages/core/src/schema/types.ts
export const AnyNode = z.discriminatedUnion('type', [
  // Pascal originals
  SiteNode, BuildingNode, LevelNode, WallNode, FenceNode, ItemNode,
  ZoneNode, SlabNode, CeilingNode, RoofNode, RoofSegmentNode,
  StairNode, StairSegmentNode, ScanNode, GuideNode, WindowNode, DoorNode,
  // Fire-protection (HaloFire Studio fork)
  SprinklerHeadNode, PipeNode, SystemNode,
  FittingNode, ValveNode, HangerNode, DeviceNode, FDCNode,
  RiserAssemblyNode, RemoteAreaNode, ObstructionNode,
  // Submittal
  SheetNode,
])
```

## 9. SelectionSystem extensions

Extend Pascal's selection system to support **traversal-aware
selection** via the pipe graph.

`packages/core/src/systems/selection-fp/` (new):

```typescript
// Walk downstream from a selected pipe.
export function selectDownstream(pipeId: string): string[] {
  const visited = new Set<string>()
  const stack = [pipeId]
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const pipe = getPipe(id)
    // Follow flow_direction: end_m's fittings → their run_b children
    const outFitting = findFittingAtPoint(pipe.end_m)
    if (!outFitting) continue
    for (const conn of outFitting.port_connections) {
      if (conn.pipe_id && conn.pipe_id !== id) stack.push(conn.pipe_id)
    }
  }
  return [...visited]
}
```

Exposed as ribbon command "Select downstream" (Shift+D) and
right-click context action.

Related commands:
- `selectSystem(systemId)` — every PipeNode + HeadNode + FittingNode
  with matching `systemId`.
- `selectFloor(levelId)` — everything parented under the level.
- `selectRemoteArea(raId)` — every head inside the polygon.

## 10. HydraulicSystem

Already landed at `packages/core/src/systems/hydraulic/hydraulic-system.ts`.
Integration points:

- **Install:** `installHydraulicSystem(useScene.getState())` at
  app boot (page.tsx). Returns an unsubscribe; called on unmount
  (app close).
- **Triggers:** PipeNode/HeadNode/SystemNode mutations → 300 ms
  debounce → full solve per SystemNode.
- **Outputs:** writes `.demand` onto each SystemNode via
  `updateNode`.
- **Side effects:** HalofireNodeWatcher sees the `.demand` update
  → fires `halofire:scene-changed { origin: 'hydraulic-solve' }`
  → LiveCalc re-reads and re-renders.

## 11. Tests

- `apps/editor/e2e/pascal-fork.spec.ts` — already covers
  Sprinkler + Pipe + System + HydraulicSystem. Extend with:
  - Fitting parse + port roundtrip
  - Valve parse + state transitions
  - Hanger + pipe_id reference resolution
  - selectDownstream over a 3-pipe chain golden fixture

## 12. Open questions

- Grouped nodes (user makes a "riser assembly" from several
  existing parts): is that a new RiserAssemblyNode replacing
  children, or a virtual wrapper? — **virtual wrapper** via
  `children` ref, preserves history and BOM independence.
