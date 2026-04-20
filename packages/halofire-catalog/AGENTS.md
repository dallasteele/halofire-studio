# @halofire/catalog — agent reference

Read this before you place, route, or BOM a single component.

## 1. What every catalog entry means

Every row in `CATALOG` is a real, purchaseable part. It has:

| field | meaning | AI agent uses it for |
|---|---|---|
| `sku` | stable id, also the GLB filename stem | cross-ref between BOM + viewport + IFC |
| `category` | part type (typed string union) | dispatch to placer rules, hydraulic K-table, NFPA §14 sizing |
| `mounting` | where the part physically attaches | decide attachment node in Pascal tree (ceiling/wall/floor/inline) |
| `dims_cm` | `[L, D, H]` bounding dims in cm | collision, clearance, grid placement |
| `pipe_size_in` | nominal pipe size (pipes + fittings) | size matching at connectors, pricebook lookup |
| `k_factor` | NFPA 13 K (heads only, `GPM/psi^0.5`) | hydraulic demand per head |
| `temp_rating_f` | thermal element rating (heads only) | §6.2.5 temp class selection |
| `response` | `'fast' \| 'standard'` (heads) | §11.2.3 design-area reduction |
| `connection` | `'npt' \| 'grooved' \| 'flanged' \| 'solvent_weld'` | connector type |
| `finish` | free-form finish string | → `materialFor(entry)` PBR material |

`dims_cm` is authoritative — it matches what's really in the GLB.

## 2. Material system

Do **NOT** parse `entry.finish` by hand. Call `materialFor(entry)`
from `@halofire/catalog` — it returns a typed `MaterialSpec` with:

- `color_hex` — PBR base color (for the viewport + DXF fills)
- `metalness` / `roughness` — PBR shading inputs
- `nfpa_paint_hex` — NFPA-13 regulatory paint color, or `null` if
  this part has no regulatory finish requirement. Sprinkler supply
  mains (red pipe, red valves, red enclosures) have this set;
  chrome heads and brass gauges do not.
- `description` — one-line summary for generated proposals

The item-renderer in `packages/viewer` already consumes the
`halofire_pipe_color:<hex>` tag and builds a `MeshStandardNodeMaterial`
at render time. SceneBootstrap writes both
`halofire_pipe_color:<color_hex>` and `halofire_material:<name>` on
every spawned item.

When you need to answer "what color should this be painted in the
field?" return `nfpa_paint_hex` (not `color_hex`).

## 3. Connector graph

The connector graph is how parts physically fit together. Every
placement / routing / fitting decision must round-trip through
`connectorsFor(entry)` + `canMate(a, b)` — do not eyeball geometry.

```ts
import { connectorsFor, canMate } from '@halofire/catalog'

const pipeConns = connectorsFor(pipeEntry)      // 2 connectors (end_a, end_b)
const teeConns  = connectorsFor(teeEntry)       // 3 connectors (run_in, run_out, branch)
const headConns = connectorsFor(pendantEntry)   // 1 connector (inlet, pointing +Y)

// Before placing a pipe end at a tee branch, verify compat:
const ok = canMate(pipeConns[0], teeConns[2])   // true iff size + type match
```

### Connector semantics

| role | meaning | can mate with |
|---|---|---|
| `inlet` | upstream / supply side | `outlet`, `coupling`, `branch` |
| `outlet` | downstream / discharge | `inlet`, `coupling`, `branch` |
| `branch` | lateral tap off a main (tee side-leg) | `inlet`, `outlet`, `coupling` |
| `coupling` | symmetric — either direction | anything except `tap` |
| `tap` | saddle-mount instrument tap (gauge, flow switch) | **never** mates directly — it pierces an EXISTING pipe, not a connector |

### Coordinate convention

- `position_m` is in **meters**, relative to the item's local origin
  (same frame as Pascal's `ItemNode.position`).
- `direction` is a unit outward vector. Two connectors that mate must
  point at each other: `a.direction = -b.direction` in world space.
- Default local axes per category (what you'll see in the GLB):
  - **pipes**: long axis = **+Z**, ends at `z = ±length/2`
  - **elbows 90°**: inlet face at **−X**, outlet face at **+Z**
  - **tees**: run along **X**, branch along **+Z**
  - **valves / couplings**: inline along **X**
  - **pendant / concealed heads**: thread points **+Y** (up)
  - **upright heads**: thread points **−Y** (down)
  - **sidewall heads**: thread points **−X** (into wall)

### Canonical examples

Pendant head on a branch line:
```
  pipe end_b  (+Z, 1")  ─┐
                         │   reducing bushing 1"→½" NPT
  pendant head inlet     │   (not in catalog — added by placer as
   (+Y, ½" NPT)  ────────┘   virtual fitting)
```

Tee feeding two branches:
```
         branch (+Z)  ──── to head cluster
          │
run_in (−X) ── TEE ── run_out (+X)
```

OS&Y gate valve at riser base:
```
   inlet (−X, 4" flanged)  ←  incoming 4" underground supply
   outlet (+X, 4" flanged) →  vertical riser via 90° elbow
```

## 4. What agents should NEVER do

1. **Don't** invent SKUs — every placed item must reference a real
   `CatalogEntry.sku`. If you need a component that isn't in
   `CATALOG`, open a PR to add it; don't string-concatenate a fake.
2. **Don't** guess dimensions. Use `entry.dims_cm` → meters.
3. **Don't** parse `entry.finish` with regex. Use `materialFor()`.
4. **Don't** place two items so their connectors overlap without
   calling `canMate`. Size/type mismatches break hydraulic calc and
   produce non-buildable BOMs.
5. **Don't** mate a `tap` connector to anything directly. A flow
   switch or gauge is a saddle — it attaches to an existing pipe
   node, not to another connector.

## 5. Running the smoke check

```
bash apps/editor/tests/smoke/run-viewport-smoke.sh
bun test packages/halofire-catalog/tests/catalog.test.ts
```

The catalog smoke verifies:
- every SKU resolves to a `MaterialSpec` (no "brass fallback" for
  real parts)
- every non-segment SKU has ≥ 1 connector
- pipes have exactly 2 collinear end connectors
- tees have exactly 3 connectors (2 colinear + 1 orthogonal)
- elbow 90° connectors are orthogonal
- `canMate` is symmetric and rejects size/type mismatches
