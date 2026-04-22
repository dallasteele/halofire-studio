# Phase D.1 — Catalog Schema Reconcile

**Date:** 2026-04-21
**Scope:** `packages/halofire-catalog/` + `packages/hf-core/src/catalog/`
**Status:** ✅ landed

## TL;DR

Prior to this change the catalog package had **two incompatible
schemas** stapled together:

1. A hand-coded `CatalogEntry` interface in
   `packages/halofire-catalog/src/types.ts` with fields like
   `dims_cm`, `mounting`, `glb_path`, `connection`, `finish`,
   `open_source`.
2. The JSON actually written to
   `packages/halofire-catalog/catalog.json` by
   `scripts/build-catalog.ts` — whose entries carry `params`, `ports`,
   `mfg_part_number`, `install_minutes`, `k_factor`, `orientation`,
   `kind`, `display_name`, etc.

The JSON shape (#2) is what every real consumer reads (via
`loadCatalog()` in `@halofire/core/catalog/load`). The TS interface
(#1) only described the legacy in-memory `CATALOG` array and three
editor panels (`CatalogPanel`, `SceneBootstrap`, `FireProtectionPanel`).
Agent docs (`AGENTS.md`) documented #1. That is the drift.

This reconcile picks the **JSON shape as canonical**, formalizes it
with a Zod schema, validates at load time, and renames the legacy
shape so it's obvious which one is the source of truth.

## The canonical schema (now)

Defined in `packages/halofire-catalog/src/types.ts` and validated by
`packages/halofire-catalog/src/schema.ts`:

```ts
interface CatalogEntry {
  sku: string                              // @part <slug>
  kind: PartKind                           // @kind <value>
  category: string                         // @category <dotted>
  display_name: string                     // @display-name "..."
  manufacturer?: string                    // @mfg
  mfg_part_number?: string                 // @mfg-pn
  listing?: string                         // @listing
  hazard_classes?: string[]                // @hazard-classes
  price_usd?: number                       // @price-usd
  install_minutes?: number                 // @install-minutes
  crew?: string                            // @crew
  weight_kg?: number
  k_factor?: number                        // @k-factor   (heads)
  orientation?: string                     // @orientation
  response?: string                        // @response
  temperature?: string                     // @temperature
  params: Record<string, CatalogParam>     // @param <name> ...
  ports: CatalogPort[]                     // @port <name> ...
  scad_source: string
  warnings: string[]
}

interface CatalogManifest {
  schema_version: 1
  catalog_version: string
  generated_at: string
  parts: CatalogEntry[]
}
```

Every field traces back to a `@`-annotation in a single `.scad` file
under `packages/halofire-catalog/authoring/scad/`. The build pipeline
is:

```
authoring/scad/*.scad  →  scripts/build-catalog.ts  →  catalog.json
                           (uses parseScad from
                           @halofire/core/scad/parse-params)
```

## The OLD wrong shape

Retained as `LegacyCatalogEntry` in the same `types.ts` with a
`@deprecated` JSDoc. Fields that existed there and do NOT exist on
the canonical `CatalogEntry`:

| legacy field | replacement |
|---|---|
| `name` | `display_name` |
| `dims_cm: [L, D, H]` | no direct replacement — derive from SCAD geometry; until then, legacy helpers still use it |
| `mounting: MountingClass` | no direct replacement — the canonical path uses `kind` + port `direction` to infer mount |
| `glb_path` | GLB filename is always `${sku}.glb`; base directory is a consumer concern |
| `pipe_size_in` | first `ports[].size_in` (all pipe ports share the same size) |
| `temp_rating_f` | `temperature` (string, so "165F" not 165) |
| `connection: 'npt' \| 'grooved' \| ...` | `ports[].style` (`NPT_threaded` / `grooved` / `flanged.150` / ...) |
| `finish` | not in canonical schema — material derivation moves to a dedicated `@material` annotation (future work) |
| `model` | not in canonical schema — use `mfg_part_number` |
| `notes` | not in canonical schema |
| `open_source` | not in canonical schema (was a distribution hint; orthogonal to the part shape) |

`LegacyComponentCategory` and `LegacyMountingClass` string unions are
likewise retained under their `Legacy*` names; the bare
`ComponentCategory` / `MountingClass` aliases stay as back-compat
exports so existing callers keep resolving.

## Call sites touched

- `packages/halofire-catalog/src/types.ts` — rewrote with canonical
  types on top, `LegacyCatalogEntry` below.
- `packages/halofire-catalog/src/schema.ts` — new file, Zod mirror
  of the canonical types + `parseCatalog` / `safeParseCatalog`.
- `packages/halofire-catalog/src/index.ts` — now exports both the
  canonical types + Zod schemas AND the legacy symbols (clearly
  sectioned with comments).
- `packages/halofire-catalog/src/manifest.ts`,
  `.../query.ts`,
  `.../connectors.ts`,
  `.../material.ts` — switched internal imports from
  `CatalogEntry` → `LegacyCatalogEntry` (they consume the legacy
  in-memory shape).
- `packages/halofire-catalog/AGENTS.md` — fully rewritten to
  document the canonical schema, the build pipeline, and the
  deprecation status of the legacy helpers.
- `packages/hf-core/package.json` — added workspace dep
  `"@halofire/catalog": "*"`.
- `packages/hf-core/src/catalog/load.ts` — `Catalog` and
  `CatalogPart` are now type-aliases of the canonical
  `CatalogManifest` / `CatalogEntry`; `loadCatalog()` now runs
  `parseCatalog(raw)` on every load path (fetch injection,
  browser fetch, Node fs fallback), gated by a
  `skipValidation` escape-hatch for fixture-based tests.
- `apps/editor/components/halofire/CatalogPanel.tsx` — only
  external consumer that imported `type CatalogEntry` from the
  package; updated to import `type LegacyCatalogEntry`.

`SceneBootstrap.tsx` and `FireProtectionPanel.tsx` import only
values (`CATALOG`, `materialFor`, `findBySku`, `findPipesBySize`,
`pipeColorFor`) — no type import to update.

## Test added

`packages/halofire-catalog/tests/schema.test.ts`:

- Loads the real on-disk `catalog.json`.
- Asserts the top-level envelope parses against
  `CatalogManifestSchema`.
- Asserts every entry parses against `CatalogEntrySchema`.
- Spot-checks that every port has a positive `size_in`, a non-empty
  `style` / `role`, and a plausibly-unit `direction`.
- Negative-cases: missing `sku`, unknown `kind`, wrong
  `schema_version` — all rejected.

Run:

```
bun test packages/halofire-catalog/tests/schema.test.ts
```

## How to not drift again

The schema test loads the actual generated file, so the drift cycle
is now:

1. Author edits `@param` / `@port` in a `.scad` file.
2. `bun run scripts/build-catalog.ts` regenerates `catalog.json`.
3. If the emitter produces a shape that doesn't match `types.ts` +
   `schema.ts`, **the schema test fails in CI**.
4. Fix whichever of (SCAD vocabulary / parser / emitter / TS types)
   lagged behind the others.

The runtime validator in `loadCatalog()` gives the same guarantee to
downstream consumers at app boot.

## Follow-ups (not in this PR)

- Migrate `CatalogPanel`, `SceneBootstrap`, `FireProtectionPanel` to
  read `catalog.json` via `loadCatalog()` and delete the in-memory
  `CATALOG` array + `LegacyCatalogEntry`.
- Add a `@material` SCAD annotation so `materialFor()` can derive
  PBR + NFPA paint from the canonical shape instead of the legacy
  `finish` string.
- Replace the geometric `connectorsFor()` helper with a thin
  `CatalogEntry.ports → Connector` mapper (the SCAD `@port`
  annotations already carry everything `connectorsFor` reconstructs
  from `dims_cm`).
