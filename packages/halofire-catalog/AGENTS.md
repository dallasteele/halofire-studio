# @halofire/catalog — agent reference

Read this before you place, route, or BOM a single component.

## 0. Schema source-of-truth (Phase D.1 reconcile — 2026-04-21)

```
 ┌─────────────────────────────┐   build-catalog.ts   ┌───────────────┐
 │ authoring/scad/*.scad       │ ──────────────────▶  │ catalog.json  │
 │   @part / @kind / @category │  (parseScad)         │  parts: [...] │
 │   @mfg / @mfg-pn / @param   │                      └──────┬────────┘
 │   @port / @k-factor / ...   │                             │
 └─────────────────────────────┘                             │ loadCatalog()
                                                             │  (zod-validated)
                                                             ▼
                                                      agents / editor
```

The **`.scad` file is the source of truth**. Every field on
`CatalogEntry` traces back to a `@`-annotation in a single `.scad`
file under `authoring/scad/`. The build script walks those files,
calls `parseScad()` from `@halofire/core/scad/parse-params`, and
writes `packages/halofire-catalog/catalog.json`. Consumers read the
JSON via `loadCatalog()` from `@halofire/core/catalog/load`, which
validates the envelope against `CatalogManifestSchema` from
`@halofire/catalog`.

If any of these four layers drift — SCAD vocabulary, parser,
emitter, TS types — the schema test (`tests/schema.test.ts`) will
fail immediately and tell you which path is wrong.

**Do NOT hand-edit `catalog.json`.** Fix the annotation in the
`.scad` file and re-run `bun run scripts/build-catalog.ts`.

## 1. Canonical `CatalogEntry` fields

Each element of `catalog.parts[]` (= `CatalogEntry`):

| field | JSON type | SCAD annotation | meaning |
|---|---|---|---|
| `sku` | string | `@part <slug>` | unique id, also the .scad file stem and GLB filename stem |
| `kind` | `PartKind` | `@kind <value>` | coarse dispatch — see list below |
| `category` | string (dotted) | `@category <dotted>` | fine-grained class (e.g. `head.pendant.k56`, `pipe.sch10.grooved`) |
| `display_name` | string | `@display-name "..."` | human label shown in UI |
| `manufacturer` | string? | `@mfg <name>` | e.g. `victaulic`, `tyco`, `generic` |
| `mfg_part_number` | string? | `@mfg-pn <pn>` | part number in manufacturer's catalog |
| `listing` | string? | `@listing UL FM` | regulatory listing tokens |
| `hazard_classes` | string[]? | `@hazard-classes LH OH1 OH2` | NFPA 13 hazard classes |
| `price_usd` | number? | `@price-usd <n>` | list price, USD |
| `install_minutes` | number? | `@install-minutes <n>` | labor minutes per unit |
| `crew` | string? | `@crew <role>` | `foreman` / `journeyman` / `apprentice` / `mixed` |
| `weight_kg` | number? | `@weight-kg <n>` | mass |
| `k_factor` | number? | `@k-factor <n>` | sprinkler head K-factor (heads only) |
| `orientation` | string? | `@orientation <o>` | `pendant` / `upright` / `sidewall` / `concealed` |
| `response` | string? | `@response <r>` | `standard` / `quick` / `esfr` |
| `temperature` | string? | `@temperature <t>` | e.g. `155F`, `200F` |
| `params` | `Record<string,CatalogParam>` | `@param <name> ...` | tunable SCAD variables |
| `ports` | `CatalogPort[]` | `@port <name> ...` | connection sockets (position, direction, size, style, role) |
| `scad_source` | string | — | source file name, relative to `authoring/scad/` |
| `warnings` | string[] | — | non-fatal parser warnings |

`PartKind` enum: `sprinkler_head`, `pipe_segment`, `fitting`,
`valve`, `hanger`, `device`, `fdc`, `riser_assy`, `compound`,
`structural`, `unknown`.

### Example entry (from `coupling.scad`)

```json
{
  "sku": "coupling",
  "kind": "fitting",
  "category": "fitting.union",
  "display_name": "Grooved Coupling (2\")",
  "manufacturer": "victaulic",
  "mfg_part_number": "Style-77",
  "price_usd": 7.2,
  "install_minutes": 5,
  "params": {
    "size_in": {
      "name": "size_in",
      "type": { "kind": "enum", "values": [1, 1.25, 1.5, 2, 2.5, 3, 4] },
      "default": 2,
      "label": "Size",
      "unit": "in"
    }
  },
  "ports": [
    { "name": "in",  "position_m": [-0.04, 0, 0], "direction": [-1, 0, 0],
      "style": "grooved", "size_in": 2, "role": "run_a" },
    { "name": "out", "position_m": [ 0.04, 0, 0], "direction": [ 1, 0, 0],
      "style": "grooved", "size_in": 2, "role": "run_b" }
  ],
  "scad_source": "coupling.scad",
  "warnings": []
}
```

## 2. Canonical port vocabulary

`CatalogPort.style` ∈ {
 `NPT_threaded`, `grooved`, `flanged.150`, `flanged.300`,
 `solvent_welded`, `soldered`, `stortz`, `none`
}.

`CatalogPort.role` ∈ { `run_a`, `run_b`, `branch`, `drop` }.

Coordinate convention:
- `position_m` is in **meters**, relative to the part's local origin
  (same frame as Pascal's `ItemNode.position`).
- `direction` is a unit vector pointing **outward** from the part.
  Two mating ports must point at each other:
  `a.direction = -b.direction` in world space.
- Local axes per part-kind (as rendered by the .scad templates):
  - **pipes**: long axis = **+Z**, ends at `z = ±length/2`
  - **elbows 90°**: inlet at **−X**, outlet at **+Z**
  - **tees**: run along **X**, branch along **+Z**
  - **valves / couplings**: inline along **X**
  - **pendant / concealed heads**: thread points **+Y**
  - **upright heads**: thread points **−Y**
  - **sidewall heads**: thread points **−X**

## 3. Runtime validation

```ts
import { parseCatalog } from '@halofire/catalog'
import { loadCatalog } from '@halofire/core/catalog/load'

const catalog = await loadCatalog()  // already validated
// or, validating raw JSON yourself:
const catalog2 = parseCatalog(rawJson)
```

`loadCatalog()` calls `parseCatalog()` under the hood. If the
generated JSON drifts from the schema, you get a `ZodError` with
the exact path (e.g. `parts[17].ports[0].size_in`) — not a silent
`undefined` at first use.

The schema test (`tests/schema.test.ts`) runs this against the real
on-disk `catalog.json` in CI.

## 4. What agents should NEVER do

1. **Don't invent SKUs.** Every placed item must reference a real
   `CatalogEntry.sku` that exists in `catalog.json`. If you need a
   component that isn't there, add a new `.scad` file (or a new
   `@param` variant) and re-run the build.
2. **Don't hand-edit `catalog.json`** — it is generated.
3. **Don't mate two ports without a `size_in` / `style` match.**
4. **Don't read legacy fields on new code.** The pre-reconcile shape
   (`dims_cm`, `mounting`, `glb_path`, `connection`, `finish`,
   `open_source`) lives on `LegacyCatalogEntry` and is only there
   to keep the old in-memory `CATALOG` array + three editor panels
   (`CatalogPanel`, `SceneBootstrap`, `FireProtectionPanel`)
   compiling. New work must go through the JSON / `CatalogEntry`
   path.

## 5. Legacy helpers (deprecated — do not extend)

Until the three editor consumers migrate, the package still exports
the pre-reconcile helpers against `LegacyCatalogEntry`:

- `CATALOG` — hard-coded array in `src/manifest.ts`
- `findBySku`, `findByCategory`, `findByName`, `findPipesBySize`,
  `findHeadsByKFactor` — query helpers
- `materialFor(entry)` — PBR + NFPA paint color (derived from
  legacy `finish` string)
- `connectorsFor(entry)` / `canMate(a, b)` — geometric connector
  graph (derived from legacy `dims_cm` + `category`)

New agents must read `CatalogEntry.ports` directly. The
`connectorsFor` helper predates the SCAD `@port` annotation and will
be retired once all callers cut over.

## 6. Running the tests

```
bun test packages/halofire-catalog/tests/catalog.test.ts   # legacy metadata
bun test packages/halofire-catalog/tests/schema.test.ts    # canonical schema
bash apps/editor/tests/smoke/run-viewport-smoke.sh         # end-to-end
```
