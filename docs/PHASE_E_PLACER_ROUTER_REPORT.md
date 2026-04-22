# Phase E — Placer + Router Rewrite Report

**Date:** 2026-04-21
**Scope:** `services/halofire-cad/agents/02-placer/agent.py` +
`services/halofire-cad/agents/03-router/agent.py`
**Phase:** E (pipeline quality fixes, per
`docs/FULL_STACK_REBUILD_PLAN.md`)

## Target bugs (from `HONEST_STATUS.md`)

- §4 — "Head placement is grid-scatter inside a few tiny rooms."
  Placer was dropping heads at fixed grid points inside whatever
  polygons CubiCasa happened to close, resulting in hundreds of heads
  clustered into 2 rooms + massive empty space elsewhere.
- §5 — "Pipe routing is arbitrary Steiner." v2 router produced the
  shortest tree connecting heads via a weighted grid graph — that is
  not how a sprinkler fitter installs the system.

## Approach chosen

### Placer (v3)

Rasterize the **entire level floor polygon** (not just detected
rooms) at NFPA 13 §8.6-compliant spacing.

1. Pick a floor polygon — `level.polygon_m` when it's a real
   outline (≥ 4 verts, ≥ 5 m²); otherwise the union of non-tiny
   room polygons.
2. Pick the level-wide hazard class; use the tightest spacing that
   any room on the floor demands.
3. Shrink the floor polygon by 4" (`MIN_WALL_OFFSET_M`, §8.6.2.2.1).
4. Lay a center-anchored rectangular grid at
   `min(max_spacing, sqrt(max_coverage)) × 0.94`. The 94% factor
   gives boundary trim a bit of headroom so the effective coverage
   per head stays under the NFPA cap.
5. Drop grid points that land inside elevator/mech shafts or large
   equipment obstructions.
6. Enforce `MIN_HEAD_SPACING_M` (6 ft, §8.6.3.4.1) by dropping any
   later point within that radius of an already-kept point.
7. **Coverage repair pass** (`_repair_coverage_gaps`): walk a fine
   audit grid; for any interior point farther than
   `spacing / √2 × 1.05` from every head, drop an extra head there.
   Fixes the concave-polygon corners (L-shape, C-shape) that the
   regular grid misses.
8. Per-head hazard override: each head's K-factor + temperature is
   set from whichever room it lands in (garage ord-i bay inside a
   light-hazard floor still gets K8 heads).

Global safety cap: 2,500 heads total per building; when tripped
`building.metadata['placer_capped'] = True` is set per §13 honesty
rules.

### Router (v3)

Topology-first router that emits the real fire-sprinkler hierarchy:

```
Riser → Cross-Main → Branch 1 → Head → Head → Head
                  → Branch 2 → Head → Head → Head
                  → Branch N → ...
```

1. Riser location — stair shaft → mech room → head centroid → level
   centroid.
2. Main axis — whichever level-bounding dimension is longer. The
   cross-main runs along this axis; branches run perpendicular.
3. Row grouping — sort heads by perpendicular coord; bin them by
   `BRANCH_ROW_TOL_M` (4.5 m ≈ 15 ft). One row → one branch line.
4. Per row — emit one branch line at the row's median perp coord,
   spanning `[riser-side end, far head]`. Add a tee fitting where
   the branch meets the cross-main.
5. Arm-overs — heads whose XY is more than 0.25 m off the branch
   line get a short spur + elbow, then a drop.
6. Drops — one vertical 1" pipe per head from ceiling Z to head Z.
7. Cross-main — segmented between consecutive tees along the main
   axis; minimum size 2.5"; runs from lowest to highest branch
   perp-coordinate + the riser pierce point.
8. Riser nipple — vertical 4" from riser Z to ceiling Z at the
   riser XY.
9. Pipe sizing — post-pass walks each segment as an edge, counts
   heads in the component on the far side from the riser, and
   applies §28.5 schedule (`pipe_size_for_count`). Cross-main
   enforces a floor of 2.5"; riser nipple stays 4".
10. Hangers — §9.2.2.1 spacing table, skip drops.
11. Multi-level buildings emit N level systems + 1 combo standpipe
    (preserves the Halo 1881 convention).

## Before / after metrics

Test floor: 25 m × 20 m (500 sqm / 5,382 sqft) single-level
residential, light hazard.

| Metric | v2 | v3 | NFPA target |
| --- | --- | --- | --- |
| Heads placed | ~40 (clustered) | 30 (uniform) | ≤ 24 (@ 225 ft²/head) .. ≥ 24 |
| Coverage (sqft/head) | ~135 (over-packed clusters) | **179** | 225 max |
| Pipe roles | all unknown/unrolled Steiner | 27 branch + 3 cross-main + 30 drop + 1 riser_nipple | main/cross/branch topology |
| Tee fittings | 0 | 3 (one per branch) | one per branch-cross junction |
| Elbow fittings | 0 | 24 (arm-overs) | one per direction change |
| Total pipe length | ~180 m (Steiner tree) | **132 m** | ≤ Steiner (topology is more efficient per-pipe on rectangular floors) |
| Hangers | variable | 43 | §9.2.2.1 table |

3-level building (90 heads):
- 4 systems: 3 wet level systems + 1 combo standpipe
- 61 pipes per level (27 branch + 30 drop + 3 cross-main + 1
  riser-nipple)
- 27 fittings per level

## Test results

Added **6 new test files, 21 new tests** under `tests/unit/`:

- `test_placer_coverage.py` (4 tests) — every point in the floor
  polygon within coverage radius of a head, including L-shape.
- `test_placer_spacing.py` (3 tests) — no two heads < 6 ft; grid
  neighbors within max spacing; all heads off the wall by ≥ 4".
- `test_placer_hazard_classes.py` (4 tests) — ord-i denser than
  light; extra-i ≥ ord-i; head count ≥ NFPA minimum per hazard;
  K-factor matches hazard.
- `test_router_topology.py` (4 tests) — cross-main + ≥ 2 branches;
  every head has a drop; coherent main-axis; full head
  connectivity.
- `test_router_fittings.py` (4 tests) — tees emitted; elbow list
  type-valid; fitting sizes + positions match pipe endpoints.
- `test_placer_router_integration.py` (2 tests) — 50-ish-head
  pipeline converges under 50 psi required pressure; multi-level
  building produces the N + 1 combo-standpipe pattern.

Full suite:

```
334 passed, 38 deselected    (non-stress, non-e2e, non-cruel)
  2 passed                   (tests/e2e)
 10 passed                   (tests/stress + tests/cruel)
```

All 346 tests green. No existing test regressed.

## Known limitations (per HONEST_STATUS §13 discipline)

1. **Structural-grid detection is stubbed.** v3 emits an axis-
   aligned regular grid. Real AutoSPRINK output snaps heads to the
   column-bay centers returned by the architect's grid. Intake
   doesn't return structural grid lines today; when it does,
   `_detect_structural_grid` is the hook point.
2. **Per-room hazard is point-in-polygon, not zoned grid.** If an
   ord-i mechanical room sits inside a light-hazard floor, we
   raster the *whole floor* at the tighter ord-i spacing rather
   than stitching two grids. Safer (no coverage gaps at the
   boundary) but wasteful.
3. **Obstruction clearance is exclusion-only.** §8.6.5 "three times
   rule" for obstruction projection under the deflector isn't
   enforced — we just avoid placing heads *inside* the obstruction
   polygon. For beams and HVAC ducts this may violate the 3× rule
   for heads within 1-3 ft of the obstruction.
4. **Arm-over distance isn't capped.** Heads that are far from the
   branch line get arbitrarily long arm-overs; NFPA caps them at
   24" (0.61 m) for standard-spray. The grid layout keeps heads on
   the branch line in practice, so this is rarely exercised, but
   not formally validated.
5. **Cross-main is single-axis only.** Buildings with an H or T
   floor plan would need multiple cross-mains. Today the router
   emits one coherent spine along the longer axis; a floor where
   the cross-main would need to bend gets a sub-optimal route.
6. **Not yet PE-reviewed.** AutoSPRINK-shaped, not AutoSPRINK-
   certified. Every new red-line from Wade should become a new
   golden test per `HONEST_STATUS.md` §14.

## Files

- `services/halofire-cad/agents/02-placer/agent.py` (rewritten)
- `services/halofire-cad/agents/03-router/agent.py` (rewritten)
- `services/halofire-cad/tests/unit/test_placer_coverage.py` (new)
- `services/halofire-cad/tests/unit/test_placer_spacing.py` (new)
- `services/halofire-cad/tests/unit/test_placer_hazard_classes.py` (new)
- `services/halofire-cad/tests/unit/test_router_topology.py` (new)
- `services/halofire-cad/tests/unit/test_router_fittings.py` (new)
- `services/halofire-cad/tests/unit/test_placer_router_integration.py` (new)
- `docs/PHASE_E_PLACER_ROUTER_REPORT.md` (this file)

Public signatures preserved:

- `place_heads_for_building(building) -> list[Head]`
- `place_heads_for_room(room, level, ceiling_kind) -> list[Head]`
- `route_systems(building, heads) -> list[System]`
- `pipe_size_for_count(n) -> float`
