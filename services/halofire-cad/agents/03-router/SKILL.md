---
name: halofire-router
description: Take placed Head[] + Building → emit PipeSegment[] + Fitting[] + Hanger[] via weighted-grid Steiner tree per §28.5 schedule sizing.
inputs: [Building, Head[]]
outputs: [System[] with pipes + hangers populated]
model: deterministic (networkx Steiner approximation)
budget_seconds: 30
budget_memory_mb: 500
---

# Router Agent v2

## Purpose

Route pipe networks for every sprinkler system in a Building. One
system per level for now; combo standpipes crossing levels land in v3.

## Algorithm

1. Pick riser location per level — stair shaft preferred (§7.2
   combo standpipe path), else mech room, else level centroid.
2. Build a weighted Manhattan grid over each level at 1 m spacing.
   Elevator shafts → forbidden edges. Columns / beams → 2.5× edge
   cost multiplier.
3. Connect every head + the riser as a terminal, run greedy Steiner
   tree approximation (iterative Dijkstra from growing tree).
4. Explode the Steiner-path polylines into `PipeSegment` objects.
5. Walk the resulting tree, counting downstream heads per segment,
   and assign NFPA 13 §28.5 schedule size (1" → 1 head; up to 4").
6. Insert hangers at §9.2.2.1 max spacing per pipe size.

## Inputs

- `Building` with populated `Level.rooms`, `Level.stair_shafts`,
  `Level.mech_rooms`, `Level.obstructions`, `Level.elevator_shafts`
- `Head[]` with valid `position_m` and `room_id` linkage

## Outputs

List of `System` objects:

- `type` = `dry` for garage levels, `wet` otherwise
- `riser` with size (4" default) and position
- `pipes`, `hangers`, `heads` populated

## Known failure modes

- Non-orthogonal buildings: the axis-aligned grid under-covers; flag
  with `ROUTER_NONORTHOGONAL` in a later version
- Disconnected levels: some heads may have no path to the riser;
  logged with `ROUTER_DISCONNECTED_HEAD` via `warn_swallowed`
- Small rooms with spacing inset: the routed pipe might be degenerate
  (length < 1 cm), skipped in `_explode_polyline_to_segments`
- Loop/grid topologies (§28.7): NOT SUPPORTED yet, returns pure tree
  only

## Budget (§1.4)

- 30 seconds wall clock for up to 500-head building
- 500 MB RAM peak

## Exceptions raised

All failures are data (degradations logged via `warn_swallowed`) or
typed per `cad/exceptions.RoutingError` subclasses:

- `ROUTER_BAD_SHAFT_POLYGON` — shapely rejected an elevator shaft
- `ROUTER_BAD_OBSTRUCTION` — same for obstructions
- `ROUTER_STEINER_PATH_FAIL` — no path from head to tree
- `ROUTER_GRAPH_FAIL` — graph construction crashed
- `ROUTER_DOWNSTREAM_COUNT_FAIL` — reachability query failed

## Gateway tool binding

`halofire_route_pipe` (existing) covers manual_segment + auto_tree +
auto_loop + auto_grid modes. The `ai_designed` orchestrated call uses
`route_systems()` directly via `run_pipeline`.
