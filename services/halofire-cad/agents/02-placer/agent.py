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
        usable = _shrink(poly, spacing_m * 0.5)
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

    for i, (x, y) in enumerate(_grid_points(usable, spacing_m)):
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
        for room in level.rooms:
            if len(all_heads) >= PLACER_TOTAL_HEAD_CAP:
                capped = True
                break
            ceiling_kind = (
                room.ceiling.kind if room.ceiling else
                level.ceiling.kind
            )
            heads = place_heads_for_room(room, level, ceiling_kind)
            all_heads.extend(heads)
            stats[room.hazard_class or "light"] = (
                stats.get(room.hazard_class or "light", 0) + len(heads)
            )
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
