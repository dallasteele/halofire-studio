# @halofire/catalog

Fire-sprinkler component catalog for Halofire Studio. Ships:
- GLB meshes in `assets/glb/`
- Structured metadata in `src/manifest.ts`
- Query helpers in `src/query.ts`

## Scope

This package is the catalog/model owner surface for Halo Forge Stream F.
It ships a mixed salvage catalog with explicit provenance:

- open-authored procedural parts stay `visual_reference`
- manufacturer and distributor salvage carry `source_license` records
- verified families carry `family_contract` records with GLB/IFC/DXF paths
- source ingestion remains policy-driven and license-aware

Manufacturer-specific BIM (Victaulic, Tyco, Reliable, Viking, etc.) is
only promoted when the source-license and verification gates are met.
See `SOURCES.json` and `family_contracts.json` for the current on-disk
truth surface.

## M1 contents

| Count | Category |
|---|---|
| 5 | Sprinkler heads (pendant std + QR, upright, sidewall, concealed) |
| 6 | Pipe SCH10 grooved: 1", 1¼", 1½", 2", 2½", 3" × 1m unit lengths |
| 5 | Fittings: 90° elbows (1", 2"), 2" tee, 2"×1" reducer, 2" coupling |
| 2 | Valves: 4" OS&Y gate, 4" grooved butterfly |
| 2 | Riser: 2" flow switch, pressure gauge |
| **20** | **total** |

All meshes authored with real-world dimensions (NFPA-compliant). Origins
set to the connection interface (top of stem for pendant heads, bottom of
valve body for valves, Y=0 for sidewall) so the placer tool can attach
them to host surfaces without manual offsets.

## Adding a new component

1. Write a parametric Blender script in `authoring/` that outputs to
   `assets/glb/<SKU>.glb`
2. Add a `CatalogEntry` to `src/manifest.ts` with category, mounting
   class, dims, and NFPA metadata
3. Run `bun run check-types` to verify
4. Commit with a clear message

## Ingestion policy

The canonical source ingestion policy is:

- allowed sources: procedural, manufacturer, distributor
- public/source URL, source file ref, terms summary, and usage flags are
  required for non-procedural salvage
- `default_model_status` is `visual_reference`
- `manufacturer_verified` and `dimensions_verified` must be explicit

Package consumers should use `CATALOG_SOURCE_INGESTION_POLICY` and the
runtime schemas in `src/schema.ts` rather than inferring policy from the
asset list.
