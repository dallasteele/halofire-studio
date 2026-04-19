# @halofire/catalog

Fire-sprinkler component catalog for Halofire Studio. Ships:
- GLB meshes in `assets/glb/`
- Structured metadata in `src/manifest.ts`
- Query helpers in `src/query.ts`

## Scope

Only **open-authored** components (generic, generated via Blender MCP)
live in this package. Manufacturer-specific BIM (Victaulic, Tyco, etc.)
is loaded on-demand at bid time because most vendor licenses restrict
redistribution. See `HALOFIRE_TECHNICAL_PLAN.md` §catalog for the
two-tier strategy.

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

## Manufacturer imports (M2+)

When a bid requires, say, Victaulic VK102, the halopenclaw gateway
downloads the Revit family from Victaulic's BIM library, converts to
GLB via Blender headless, and registers an entry in an
`EPHEMERAL_CATALOG` scoped to that bid. This keeps us compliant with
manufacturer license terms (no redistribution).
