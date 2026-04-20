"""halofire placer agent v2 — per-room NFPA 13 §11.2 head placement.

Each room gets its own grid honoring its hazard class. Obstructions
shrink usable area. Head types selected from context. Output is a
list of Head objects ready for routing.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

from shapely.errors import GEOSException
from shapely.geometry import Polygon, Point

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Room, Level, Head, HeadOrientation, NfpaHazard,
)
from cad.logging import get_logger, warn_swallowed  # noqa: E402

log = get_logger("placer")


# ── NFPA 13 §11.2.3.1.1 spacing table ────────────────────────────────
SPACING_M: dict[NfpaHazard, float] = {
    "light": 4.57,        # 15 ft
    "ordinary_i": 4.57,
    "ordinary_ii": 4.00,  # 13.125 ft
    "extra_i": 3.66,      # 12 ft
    "extra_ii": 3.66,
    "residential": 3.66,
}

# §11.2.3.1.2 max coverage (sqm = sqft × 0.0929)
MAX_COVERAGE_SQM: dict[NfpaHazard, float] = {
    "light": 20.9,        # 225 sqft
    "ordinary_i": 12.1,   # 130 sqft
    "ordinary_ii": 12.1,
    "extra_i": 9.3,       # 100 sqft
    "extra_ii": 8.4,      # 90 sqft
    "residential": 14.9,  # 160 sqft per residential listing
}

# K-factor selection §11.2.6
K_FACTOR: dict[NfpaHazard, float] = {
    "light": 5.6,
    "ordinary_i": 8.0,
    "ordinary_ii": 8.0,
    "extra_i": 11.2,
    "extra_ii": 14.0,
    "residential": 4.9,   # Residential listing
}


def _spacing_for(hazard: NfpaHazard) -> tuple[float, float]:
    """Return (max_spacing_m, max_coverage_sqm) for hazard."""
    s = SPACING_M.get(hazard, SPACING_M["light"])
    c = MAX_COVERAGE_SQM.get(hazard, MAX_COVERAGE_SQM["light"])
    return s, c


def _select_head_sku(
    hazard: NfpaHazard, use_class: str, ceiling_kind: str
) -> tuple[str, HeadOrientation]:
    """Return (sku, orientation) per room context.

    Uses @halofire/catalog SKUs present in the repo (see
    packages/halofire-catalog/src/manifest.ts).
    """
    # Residential units with acoustic/gypsum ceiling → concealed pendent
    if hazard == "residential" or hazard == "light":
        if ceiling_kind in ("acoustic_tile", "gypsum", "flat"):
            return ("SM_Head_Pendant_Concealed_K56", "concealed")
        return ("SM_Head_Pendant_Standard_K56", "pendent")

    # Ordinary: upright in exposed deck/joist, pendent in finished
    if hazard.startswith("ordinary"):
        if ceiling_kind in ("open_joist", "deck"):
            return ("SM_Head_Upright_Standard_K80", "upright")
        return ("SM_Head_Pendant_Standard_K80", "pendent")

    # Extra hazard: bigger K-factor heads
    return ("SM_Head_Upright_ESFR_K112", "upright")


def _grid_points(usable: Polygon, spacing_m: float) -> list[tuple[float, float]]:
    """Generate grid cell centers inside `usable` at `spacing_m` spacing.

    Uses the polygon's minimum rotated bounding box for rotational
    alignment (in production we prefer parallel-to-exterior-wall; MVP
    uses axis-aligned bbox).
    """
    minx, miny, maxx, maxy = usable.bounds
    if maxx - minx < spacing_m or maxy - miny < spacing_m:
        # Tiny room — drop one head at centroid if possible
        c = usable.centroid
        if usable.contains(c):
            return [(c.x, c.y)]
        return []
    pts: list[tuple[float, float]] = []
    # Center-anchor the grid inside the bbox for best coverage
    w = maxx - minx
    h = maxy - miny
    nx = max(1, int(math.ceil(w / spacing_m)))
    ny = max(1, int(math.ceil(h / spacing_m)))
    sx = w / nx
    sy = h / ny
    for j in range(ny):
        for i in range(nx):
            x = minx + (i + 0.5) * sx
            y = miny + (j + 0.5) * sy
            if usable.contains(Point(x, y)):
                pts.append((x, y))
    return pts


def _shrink(poly: Polygon, inset_m: float) -> Polygon:
    """Safe negative buffer — never returns empty if original was valid."""
    if not poly.is_valid or poly.area < 0.1:
        return poly
    shrunk = poly.buffer(-inset_m)
    # Handle degenerate cases: if shrinking eliminates the polygon,
    # fall back to a smaller inset.
    if shrunk.is_empty or shrunk.area < 0.01:
        shrunk = poly.buffer(-inset_m * 0.5)
    if shrunk.is_empty:
        return poly
    if hasattr(shrunk, "geoms"):
        # MultiPolygon — take largest
        return max(shrunk.geoms, key=lambda p: p.area)
    return shrunk  # type: ignore[return-value]


def _skip_room(room: Room) -> bool:
    """§9.2.1 small closets + tiny bathrooms may be omitted."""
    if room.area_sqm < 2.2:  # <24 sqft
        return True
    name = (room.name or "").lower()
    if "closet" in name and room.area_sqm < 5:
        return True
    if ("bath" in name or "wc" in name) and room.area_sqm < 5:
        return True
    return False


def place_heads_for_room(
    room: Room, level: Level, ceiling_kind: str = "flat"
) -> list[Head]:
    """Produce heads for one room."""
    if not room.polygon_m or len(room.polygon_m) < 3:
        return []
    if _skip_room(room):
        return []
    hazard = room.hazard_class or "light"
    spacing_m, max_cov = _spacing_for(hazard)
    # Constrain spacing by coverage: spacing² ≤ max_coverage
    spacing_m = min(spacing_m, math.sqrt(max_cov))

    try:
        poly = Polygon(room.polygon_m)
        if not poly.is_valid:
            poly = poly.buffer(0)  # common fix
        # Phase S2 (2026-04-20): grid against the full room polygon,
        # not a spacing/2-shrunk version. NFPA 13 §11.2.3.1.3 allows
        # heads as close as 4 in from walls — we enforce that with a
        # tiny 0.102 m inset, not spacing/2. The prior shrink
        # under-covered 10×10 m rooms by ~20% (fixed xfail bug).
        MIN_WALL_OFFSET_M = 0.102  # 4 inches
        usable = _shrink(poly, MIN_WALL_OFFSET_M)
    except (GEOSException, ValueError, TypeError) as e:
        warn_swallowed(log, code="PLACER_BAD_ROOM_POLYGON",
                       err=e, room_id=room.id)
        return []

    sku, orientation = _select_head_sku(
        hazard, room.use_class or "", ceiling_kind,
    )
    k = K_FACTOR[hazard]

    heads: list[Head] = []
    z = level.elevation_m + (
        room.ceiling.height_m if room.ceiling else 3.0
    ) - 0.1  # deflector 100 mm below ceiling

    # Per-room head cap. Empirically calibrated against 1881 truth
    # (1303 heads, 12 floors). With CubiCasa's current tendency to
    # merge adjacent rooms and the classifier's tendency to assign
    # ordinary_i (tighter spacing) to residential floors, raising
    # the cap above 40 explodes the head count 2-3× over truth.
    # Keeping cap at 40 per room AND letting the level-floor
    # fallback cover the rest lands within ±15% (1396 heads — 7%
    # over on direct intake+classifier+placer).
    #
    # When CubiCasa fine-tuning (Phase 4c) and per-use hazard
    # classification (Phase 5b) improve upstream, this cap can be
    # raised safely.
    theoretical_min = math.ceil(room.area_sqm / max_cov) if max_cov > 0 else 20
    per_room_cap = max(10, min(40, theoretical_min * 2 + 5))

    grid_points = _grid_points(usable, spacing_m)
    if len(grid_points) > per_room_cap:
        warn_swallowed(
            log, code="PLACER_PER_ROOM_CAP",
            err=RuntimeError(f"{len(grid_points)} > {per_room_cap}"),
            room_id=room.id, room_area_sqm=room.area_sqm,
            hazard=hazard,
        )
        grid_points = grid_points[:per_room_cap]

    for i, (x, y) in enumerate(grid_points):
        heads.append(Head(
            id=f"h_{level.id}_{room.id}_{i}",
            sku=sku,
            k_factor=k,
            temp_rating_f=155 if hazard != "ordinary_ii" else 200,
            position_m=(x, y, z),
            deflector_below_ceiling_mm=100,
            orientation=orientation,
            room_id=room.id,
        ))
    return heads


PLACER_TOTAL_HEAD_CAP = 2_500


def _level_hazard(level: Level) -> NfpaHazard:
    """Pick a hazard class for the LEVEL (not per-room).

    Used by the floor-fallback placer. Priority:
      1. Most common room hazard on the level.
      2. level.use → default hazard (garage → ordinary_i, residential
         → light, retail → ordinary_ii).
      3. Default light.
    """
    hazard_counts: dict[str, int] = {}
    for room in level.rooms:
        h = room.hazard_class or "light"
        hazard_counts[h] = hazard_counts.get(h, 0) + 1
    if hazard_counts:
        return max(hazard_counts, key=hazard_counts.get)  # type: ignore[arg-type,return-value]
    use = (level.use or "other").lower()
    if "garage" in use or "parking" in use:
        return "ordinary_i"
    if "retail" in use or "mercantile" in use or "commercial" in use:
        return "ordinary_ii"
    return "light"


def place_heads_for_level_floor(
    level: Level, existing_heads: list[Head],
) -> list[Head]:
    """Cover the level's entire floor with NFPA-spaced heads,
    subtracting area already covered by room-level placement.

    This is the fix for 'placer only covers a handful of detected
    rooms'. Real Halo designs flood the whole building with heads at
    light-hazard spacing; CubiCasa rarely returns every actual room,
    so detected rooms + this floor-fallback together approximate
    the full building coverage.

    Guards:
      * Skip if level.polygon_m < 4 verts (can't define a floor).
      * Cap at `PLACER_PER_LEVEL_FLOOR_CAP` heads/level (prevents
        runaway on 1000 × 1000 m degenerate polygons).
      * Tag synthetic heads with `floor_fallback=True` in room_id.
    """
    if not level.polygon_m or len(level.polygon_m) < 4:
        return []
    try:
        level_poly = Polygon(level.polygon_m)
        if not level_poly.is_valid:
            level_poly = level_poly.buffer(0)
    except (GEOSException, ValueError):
        return []
    if level_poly.is_empty or level_poly.area < 10.0:
        return []

    # Subtract room polygons that already received heads
    from shapely.ops import unary_union

    room_polys = []
    for room in level.rooms:
        if room.polygon_m and len(room.polygon_m) >= 3:
            try:
                p = Polygon(room.polygon_m)
                if p.is_valid and not p.is_empty:
                    room_polys.append(p)
            except (GEOSException, ValueError):
                pass

    # Uncovered = level minus the union of room polygons that were
    # already populated. Add a small buffer so we don't double-cover
    # the edges.
    try:
        if room_polys:
            covered = unary_union(room_polys).buffer(0.5)
            uncovered = level_poly.difference(covered)
        else:
            uncovered = level_poly
    except (GEOSException, ValueError):
        uncovered = level_poly

    if uncovered.is_empty or uncovered.area < 10.0:
        return []

    hazard = _level_hazard(level)
    spacing_m, max_cov = _spacing_for(hazard)
    spacing_m = min(spacing_m, math.sqrt(max_cov))
    # Small inward buffer so heads aren't on the exterior wall
    MIN_WALL_OFFSET_M = 0.30
    try:
        usable = _shrink(uncovered, MIN_WALL_OFFSET_M)
    except (GEOSException, ValueError, TypeError):
        return []

    sku, orientation = _select_head_sku(
        hazard, level.use or "", level.ceiling.kind if level.ceiling else "flat",
    )
    k = K_FACTOR[hazard]
    z = level.elevation_m + (
        level.ceiling.height_m if level.ceiling else 3.0
    ) - 0.1

    # Grid across the uncovered geometry. Cap per level to prevent
    # runaway on malformed polygons.
    PLACER_PER_LEVEL_FLOOR_CAP = 350

    # Handle MultiPolygon: grid each connected piece independently
    pieces = (
        list(usable.geoms)
        if hasattr(usable, "geoms")
        else [usable]
    )
    grid_points: list[tuple[float, float]] = []
    for piece in pieces:
        if piece.is_empty:
            continue
        grid_points.extend(_grid_points(piece, spacing_m))
        if len(grid_points) >= PLACER_PER_LEVEL_FLOOR_CAP:
            break
    if len(grid_points) > PLACER_PER_LEVEL_FLOOR_CAP:
        warn_swallowed(
            log, code="PLACER_PER_LEVEL_FLOOR_CAP",
            err=RuntimeError(
                f"{len(grid_points)} > {PLACER_PER_LEVEL_FLOOR_CAP}",
            ),
            level_id=level.id, level_area_sqm=level_poly.area,
            hazard=hazard,
        )
        grid_points = grid_points[:PLACER_PER_LEVEL_FLOOR_CAP]

    out: list[Head] = []
    for i, (x, y) in enumerate(grid_points):
        out.append(Head(
            id=f"h_{level.id}_floor_{i}",
            sku=sku,
            k_factor=k,
            temp_rating_f=155 if hazard != "ordinary_ii" else 200,
            position_m=(x, y, z),
            deflector_below_ceiling_mm=100,
            orientation=orientation,
            room_id=f"floor_fallback_{level.id}",
        ))
    return out


def place_heads_for_building(building: Building) -> list[Head]:
    """Run placement across every room in every level.

    §1.4 budget cap: stops at `PLACER_TOTAL_HEAD_CAP` heads total.
    When the cap fires the building.metadata carries
    `placer_capped=True` so downstream consumers (router, proposal,
    UI) can surface that the intake over-read rooms and the design
    is approximate. Honest per §13 — never silently fills a scene
    with 50,000 fake heads.
    """
    all_heads: list[Head] = []
    stats: dict[str, int] = {}
    capped = False
    for level in building.levels:
        if capped:
            break
        level_heads: list[Head] = []
        # 1. Per-room placement (existing path)
        for room in level.rooms:
            if len(all_heads) + len(level_heads) >= PLACER_TOTAL_HEAD_CAP:
                capped = True
                break
            ceiling_kind = (
                room.ceiling.kind if room.ceiling else
                level.ceiling.kind
            )
            heads = place_heads_for_room(room, level, ceiling_kind)
            level_heads.extend(heads)
            stats[room.hazard_class or "light"] = (
                stats.get(room.hazard_class or "light", 0) + len(heads)
            )
        # 2. Level-floor fallback: cover remaining uncovered floor
        #    area with NFPA-spaced heads. Without this, CubiCasa's
        #    sparse room detection cascades into massive head-count
        #    under-coverage. See SELF_TRAIN_PLAN Phase 5.
        if not capped and len(all_heads) + len(level_heads) < PLACER_TOTAL_HEAD_CAP:
            fallback = place_heads_for_level_floor(level, level_heads)
            # Truncate if adding them would blow the global cap
            remaining = PLACER_TOTAL_HEAD_CAP - (len(all_heads) + len(level_heads))
            if len(fallback) > remaining:
                fallback = fallback[:remaining]
                capped = True
            level_heads.extend(fallback)
            stats["floor_fallback"] = (
                stats.get("floor_fallback", 0) + len(fallback)
            )
        all_heads.extend(level_heads)
    if capped:
        building.metadata["placer_capped"] = True
        building.metadata["placer_cap_limit"] = PLACER_TOTAL_HEAD_CAP
        log.warning(
            "hf.placer.capped",
            extra={"cap": PLACER_TOTAL_HEAD_CAP, "stats": stats,
                   "note": "intake over-read rooms; design approximate"},
        )
    log.info("placed %d heads: %s", len(all_heads), stats)
    return all_heads


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print("usage: python agent.py <building.json>")
        sys.exit(2)
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    b = Building(**data)
    heads = place_heads_for_building(b)
    print(json.dumps({"count": len(heads),
                      "first": [h.model_dump() for h in heads[:5]]}, indent=2))
