# @halofire/ifc

IFC import for Halofire Studio. Converts architect-supplied IFC files
into Pascal's BIM node tree so sprinkler placement can begin.

## Status

**Phase M1 week 1 — scaffold only.** Types + import entry point + mapper
stub in place. Full implementation wires `@thatopen/components` IfcLoader
+ walks the spatial tree + emits Pascal nodes.

## Supported

- IFC 2x3 + IFC4 (all that `@thatopen/components` supports)
- Spatial hierarchy: `IfcSite / IfcBuilding / IfcBuildingStorey`
- Element types: `IfcWall / IfcSlab / IfcSpace / IfcColumn / IfcBeam`
- Openings via CSG: `IfcDoor / IfcWindow`

## Not supported (defer)

- `IfcFurnishingElement` — too variable; user can add via Pascal item placement
- `IfcMEP*` — existing sprinkler systems ignored; we're building our own
- Rebar / steel details — structural engineering scope
