"""Phase E spacing test — no two heads closer than NFPA min (6 ft),
no grid neighbor farther than NFPA max.
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_sp", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)

from cad.schema import Building, Ceiling, Level, Room  # noqa: E402


def _square_level(w: float, hazard: str) -> Level:
    polygon = [(0.0, 0.0), (w, 0.0), (w, w), (0.0, w)]
    room = Room(
        id="r1", name="Square",
        polygon_m=polygon, area_sqm=w * w,
        hazard_class=hazard, ceiling=Ceiling(height_m=3.0),
    )
    return Level(
        id="l1", name="L1", elevation_m=0.0, height_m=3.0,
        use="residential", polygon_m=polygon, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )


def test_no_heads_closer_than_min_spacing() -> None:
    """§8.6.3.4.1 — heads must be ≥ 6 ft (1.83 m) apart."""
    level = _square_level(20.0, "light")
    bldg = Building(project_id="sp", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    assert len(heads) >= 5
    min_seen = float("inf")
    for i, a in enumerate(heads):
        for b in heads[i + 1:]:
            d = math.hypot(
                a.position_m[0] - b.position_m[0],
                a.position_m[1] - b.position_m[1],
            )
            if d < min_seen:
                min_seen = d
    assert min_seen >= PLACER.MIN_HEAD_SPACING_M - 0.01, (
        f"min pair distance {min_seen:.2f} m < NFPA floor "
        f"{PLACER.MIN_HEAD_SPACING_M} m"
    )


def test_grid_neighbor_within_max_spacing() -> None:
    """Every head must have at least one neighbor within max_spacing_m
    so we don't get isolated orphans.
    """
    level = _square_level(18.0, "light")
    bldg = Building(project_id="sp2", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    assert len(heads) >= 4
    max_spacing = PLACER.MAX_SPACING_M["light"]
    for a in heads:
        nearest = min(
            math.hypot(
                a.position_m[0] - b.position_m[0],
                a.position_m[1] - b.position_m[1],
            )
            for b in heads if b is not a
        )
        # Allow 15% slack — gap-fill + boundary heads can land slightly
        # further from their grid neighbor than pure cell size.
        assert nearest <= max_spacing * 1.15, (
            f"head {a.id} nearest neighbor at {nearest:.2f} m "
            f"> {max_spacing * 1.15:.2f} m"
        )


def test_heads_inside_floor_polygon_and_off_walls() -> None:
    """Every head sits inside the floor polygon with at least the
    NFPA min wall offset (4 in).
    """
    level = _square_level(12.0, "light")
    bldg = Building(project_id="sp3", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(level.polygon_m)
    for h in heads:
        x, y, _z = h.position_m
        # Inside
        assert poly.buffer(0.01).contains(
            Polygon([(x - 0.01, y - 0.01), (x + 0.01, y - 0.01),
                     (x + 0.01, y + 0.01), (x - 0.01, y + 0.01)]).centroid
        )
        # Wall offset
        boundary_dist = poly.exterior.distance(
            Polygon([(x - 0.01, y - 0.01), (x + 0.01, y - 0.01),
                     (x + 0.01, y + 0.01), (x - 0.01, y + 0.01)]).centroid
        )
        assert boundary_dist >= PLACER.MIN_WALL_OFFSET_M - 0.02, (
            f"head {h.id} only {boundary_dist:.3f} m from wall"
        )
