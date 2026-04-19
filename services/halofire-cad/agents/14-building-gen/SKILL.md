---
name: halofire-building-gen
description: Procedural parametric building generator. Input total_sqft + level spec. Output a fully-populated Building JSON with levels, rooms, walls, slabs, stair shafts, mech rooms — ready for the downstream sprinkler agents.
inputs: [BuildingGenSpec]
outputs: [Building]
model: deterministic (shapely + typed geometry)
budget_seconds: 5
---

# Building Generator Agent

## Why this exists

Every downstream agent (placer, router, hydraulic, rulecheck, drafter)
needs a populated `Building`. Without one, "auto-grid heads" runs
against an empty scene and produces nothing visible. Until now,
HaloFire required a real architect PDF for any demo — which defeated
the demo loop.

This agent produces a plausible apartment-style building from a spec:
- `total_sqft` — overall footprint target
- `level_plan` — array of level specs (use, height, unit count)
- `aspect_ratio` — footprint aspect
- `stair_shaft_count`, `mech_room_count`

Output is a full `Building` instance with `Room`s, `Wall`s,
`Shaft`s, and `polygon_m` populated per level. `Ceiling` configured
per use. Ready to pipe straight into `place_heads_for_building`.

## Algorithm

1. Compute footprint: `W = sqrt(total_sqft * ft²→m² * aspect)`,
   `L = sqrt / aspect`. Both in meters.
2. For each `LevelSpec`:
   a. Generate level polygon (rectangular footprint).
   b. Subdivide into a grid of rooms using `shapely.ops.split` or a
      direct lattice. Garage levels = one big open room (no walls).
      Residential = unit-sized rooms (≈ 60 m² each by default).
      Mech levels = 1 mech room.
   c. Emit exterior walls around the footprint + interior walls at
      each grid line.
   d. Emit slab as level polygon.
   e. Place stair shafts at designated corners.
   f. Mech rooms near center per convention.
3. Stack levels at their elevations.

## Honesty (AGENTIC_RULES §13)

- Every generated building has `Building.metadata.synthesized=True` +
  a source pointer so downstream code / UI can flag it as "not from
  architect documents."
- The `Level.name` is e.g. "Level 3 (synthetic)" so Wade sees this is
  a test building, not his real project.
- Generator is parametric; its output is a plausible fictional
  building, NOT any real job. Use for demos + regression tests only.

## Contract

```python
def generate_building(spec: BuildingGenSpec) -> Building
```

## Property invariants (tested)

- Every room polygon is inside its level polygon
- Every level has at least one room
- `Building.total_sqft` matches the spec within 5% tolerance
- Stair shafts don't overlap rooms
- Room polygons are valid (closed, CCW, non-degenerate)
