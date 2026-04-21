# Blueprint 03 — Catalog Engine

**Scope:** Part catalog as the authoritative bridge between
OpenSCAD geometry and Pascal scene. SCAD annotations, parser,
build pipeline, `catalog.json`, firm overrides, lint rules.

## 1. SCAD annotation grammar

Every catalog `.scad` starts with machine-readable comments.
Parser tolerates ordering; required fields must appear.

```openscad
// @part valve_butterfly_grooved
// @kind valve
// @category valve.butterfly.grooved
// @mfg victaulic
// @mfg-pn Series-761
// @listing UL FM
// @hazard-classes LH OH1 OH2 EH1 EH2
// @display-name "4\" Grooved Butterfly Valve"
// @price-usd 285.00
// @install-minutes 18
// @crew journeyman
// @weight-kg 14.5
// @param size_in enum[2,2.5,3,4,5,6,8] default=4 label="Size" unit="in"
// @param finish enum[painted,galvanized] default=painted
// @port in  position=[-0.152,0,0] direction=[-1,0,0] style=grooved size_in=4 role=run_a
// @port out position=[ 0.152,0,0] direction=[ 1,0,0] style=grooved size_in=4 role=run_b
// @thumbnail thumbnails/valve_butterfly_4in.png

size_in = 4;
finish = "painted";
// ... SCAD body
```

### 1.1 Required annotations

- `@part <slug>` — matches filename stem
- `@kind <PartKind>`
- `@category <PartCategory>`
- `@display-name "..."`
- `@param <name> <type-spec> [default=...] [label="..."] [unit="..."]`
- `@port <role> position=[x,y,z] direction=[x,y,z] style=<style> size_in=<n> role=<role>`
- At least one `@port` (except kind=structural)

### 1.2 Optional annotations

`@mfg`, `@mfg-pn`, `@listing`, `@hazard-classes`, `@price-usd`,
`@install-minutes`, `@crew`, `@weight-kg`, `@thumbnail`,
`@k-factor` (sprinklers), `@orientation` (sprinklers),
`@response` (sprinklers), `@temperature` (sprinklers),
`@k-factor-dict {size:factor,…}` (pipes for HW cache),
`@uses <other.scad>` (composability), `@tags tag1 tag2`.

### 1.3 Param type spec grammar

```
type-spec ::=
    'number'                            # any real
  | 'number[' <min> ',' <max> ']'       # bounded
  | 'enum[' <v1> ',' <v2> ',' … ']'     # constrained choices
  | 'string'
  | 'bool'
```

## 2. Parser (`packages/hf-core/src/scad/parse-params.ts`)

```typescript
export interface ParsedScad {
  source: string              // path relative to authoring/scad
  part: PartMeta              // required fields
  params: Record<string, ScadParam>
  ports: ConnectionPort[]
  warnings: string[]
}

export function parseScad(filepath: string): ParsedScad
```

- Implemented as a line-walker with regex per annotation tag.
- Invalid annotations → warnings in the result, not throws.
- Un-annotated files → `ParsedScad` with `part.kind = 'unknown'`
  and a single warning; build step logs and skips them.

## 3. Build pipeline

`scripts/build-catalog.ts`:

```
1. Walk packages/halofire-catalog/authoring/scad/*.scad
2. parseScad() each → ParsedScad[]
3. Lint (see §5). Any lint error fails the build.
4. For each part's default parameter bundle:
   - Compute cache key = sha256(scad + params)
   - Check if pre-baked GLB exists at assets/glb/SM_<slug>.glb
   - If not, invoke OpenSCAD CLI to bake it
5. Emit:
   - packages/halofire-catalog/catalog.json (pretty)
   - packages/halofire-catalog/catalog.json.gz (compressed for app)
   - packages/halofire-catalog/catalog.lock.json (hash manifest)
6. Write SCAD-coverage report (how many parts, by kind, count).
```

Registered as a Turbo task so `pnpm build` chains through it.

## 4. `catalog.json` shape

```typescript
export interface Catalog {
  schema_version: 1
  catalog_version: string      // semver
  generated_at: string         // ISO
  parts: Part[]
}
```

`Part` shape defined in blueprint 03; see `CORE_ARCHITECTURE.md
§4.1`.

## 5. Lint rules (must pass to build)

| Rule | Failure msg |
|---|---|
| Every `.scad` file has `@part` + `@kind` + `@category` | missing required annotation |
| `@kind` value ∈ PartKind enum | unknown kind |
| At least one `@port` (unless kind=structural) | part has no ports |
| Port `role` ∈ {`run_a`, `run_b`, `branch`, `drop`} | unknown port role |
| Port `style` ∈ ConnectionStyle enum | unknown style |
| Every `@param` has a known type + default | missing param metadata |
| `@param` enum values parse as numbers / strings per type | enum type mismatch |
| Default param value ∈ allowed set | default not in enum |
| `@price-usd` present (or default pricing table entry) | missing price |
| `@thumbnail` path exists on disk (if specified) | missing thumbnail |
| Filename stem matches `@part` slug | filename ≠ part slug |
| `@category` uses dotted form (`kind.sub.spec`) | malformed category |
| No two `.scad` files declare the same `@part` slug | duplicate part |
| If `@mfg` set, `@mfg-pn` also set | missing mfg-pn |
| Sprinkler-kind parts have `@k-factor` and `@orientation` | missing sprinkler metadata |

## 6. Firm overrides

Per-firm catalog extensions live in
`<user-docs>/HaloFireStudio/firm-catalog/*.scad` and merge on
top of the base catalog at app boot.

- Overrides can **add** new parts (new SKUs).
- Overrides can **shadow** existing parts (same slug → firm wins).
- Firm override SCAD files go through the same parse + bake
  pipeline; cached into `<app_data_dir>/firm-cache/glb/`.
- Surfaced in UI as a tab in the catalog browser:
  "Shared catalog (412)" / "Firm overrides (23)".

## 7. Project catalog lock

`catalog-lock.json` in the `.hfproj` (see blueprint 01 §2.6)
pins SKUs + prices used by THIS bid. Protects against:

- Catalog price change after AHJ submittal.
- Global catalog version bump that renames/deletes a SKU.

On open: if any locked SKU is missing from the current catalog,
show migration modal.

## 8. Live reload (dev)

File-system watcher on `authoring/scad/*.scad`. On change:
1. re-parse that file,
2. re-bake its default GLB,
3. write updated `catalog.json`,
4. emit Tauri event `catalog:updated`; frontend evicts its
   cached `Catalog` object and re-fetches.

Only in dev mode (Rust feature flag).

## 9. Catalog signing

At `pnpm release`, sign `catalog.json` with the firm's private
key (stored in CI secrets). Signature lives in
`catalog.json.sig`. App verifies on load; refuses to use a
tampered catalog.

## 10. Tests

- `packages/hf-core/tests/catalog/parse.spec.ts` — every
  annotation variant → expected `ParsedScad`.
- `packages/hf-core/tests/catalog/lint.spec.ts` — each lint
  rule has a PASS fixture and a FAIL fixture.
- `packages/hf-core/tests/catalog/round-trip.spec.ts` — parse →
  Part → serialize → parse → deep-equal.
- `scripts/build-catalog.test.ts` — builds a 3-file fixture
  catalog end-to-end, verifies output hashes stable.

## 11. Open questions

- Should the SCAD parser also produce `.thumb.png` via OpenSCAD's
  `--preview` if `@thumbnail` isn't specified? P1.
- Multi-variant parts (one SCAD → many SKUs per param value):
  should catalog emit 1 Part or N Parts? — **N Parts**, one per
  combinatorial param bundle, deduped by cache key. P0 decision.
- How much parameter space do we explode? — only `size_in` + key
  finish vars. Rarely-changed params stay default.
