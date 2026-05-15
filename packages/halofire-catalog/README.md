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

The catalog owner pipeline also emits `source_coverage_ledger.json` and
`THIRD_PARTY_NOTICES.md` under `data/halofire/brand/components/` so
vendor/model coverage gaps, rejected candidates, missing downloads, and
open-source STEP provenance stay explicit.

The catalog package now also exposes a typed source-research and
correction workflow contract. Use it when you need to track the exact
internet-backed URLs, captured files, license/redistribution status, and
human correction decisions that led to a model staying in
`visual_reference`, `dimensioned_parametric`, or `manufacturer_verified`.
The step.parts directory is tracked as an open-source STEP source
candidate only; it is not manufacturer approval and cannot self-promote a
sprinkler family.
The checked-in replay artifact lives at
`data/halofire/brand/components/source_research_ledger.json`.
The replay artifact is generated from
`scripts/build_halofire_catalog_source_research.py` and the checked-in
seed at `data/halofire/brand/components/source_research_seed.json`.

## Legacy M1 contents

Historical starter set from the original salvage pass. The authoritative live
truth surface is `SOURCES.json`, `component_map.json`, and
`family_contracts.json`; use those files for current status, licensing, and
verification counts.

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
- all source licenses keep `allowed_internal_use=true` and
  `allowed_client_render=true`
- `dimensions_verified` must be explicit for any promoted family
- distributor-backed families may stop at `dimensioned_parametric`
  and must not be promoted to `manufacturer_verified` or
  `halo_fire_approved` without a manufacturer-backed evidence path
- manufacturer and distributor source records are internal-use only:
  `allowed_download=false` and `redistribution_blocked=true`
- `manufacturer_verified` still requires manufacturer-backed evidence
- `manufacturer_verified` and `dimensions_verified` must be explicit
- component, source-license, and family-contract `model_status` fields
  must match for every promoted family

Package consumers should use `CATALOG_SOURCE_INGESTION_POLICY` and the
runtime schemas in `src/schema.ts` rather than inferring policy from the
asset list.

## Source research and correction workflow

`src/source-research.ts` defines the typed research ledger and correction
records used by the Stream F owner pipeline.

Use it to record:

- the source URL and captured file ref for each product or STEP candidate
- license and redistribution status
- disposition changes caused by human review or missing evidence
- explicit blocked promotions when a distributor or open-source STEP
  candidate cannot become manufacturer verified

The ledger is intentionally stricter than the coverage file:

- procedural salvage stays `visual_reference`
- distributor salvage can land at `dimensioned_parametric`
- manufacturer verification requires a manufacturer-backed evidence path
- open-source STEP assets remain source candidates until provenance proves
  the exact product or authority
