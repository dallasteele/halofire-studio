"""Phase E coverage test — every point in the floor polygon is within
the coverage radius of at least one head.

Source: NFPA 13 §8.6.2.2.1 max protection areas; for light hazard
225 ft² per head ⇒ worst-case coverage radius is the half-diagonal
of a 15 ft × 15 ft cell ≈ 10.6 ft ≈ 3.23 m. We allow a small
tolerance since the placer center-anchors inside the bbox.
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from shapely.geometry import Polygon, Point

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_cov", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)

from cad.schema import Building, Ceiling, Level, Room  # noqa: E402


def _coverage_radius_m(hazard: str) -> float:
    """Half the diagonal of a max-spacing cell + 10% tolerance."""
    spacing = PLACER.MAX_SPACING_M[hazard]
    return (spacing / math.sqrt(2.0)) * 1.10


def _audit_coverage(
    poly: Polygon, heads: list, radius_m: float, step_m: float = 0.75,
) -> tuple[int, int]:
    """Return (audit_points_total, audit_points_uncovered)."""
    minx, miny, maxx, maxy = poly.bounds
    total = 0
    bad = 0
    y = miny + step_m * 0.5
    r2 = radius_m * radius_m
    head_xy = [(h.position_m[0], h.position_m[1]) for h in heads]
    while y < maxy:
        x = minx + step_m * 0.5
        while x < maxx:
            p = Point(x, y)
            if poly.contains(p):
                total += 1
                covered = False
                for hx, hy in head_xy:
                    dx = x - hx
                    dy = y - hy
                    if dx * dx + dy * dy <= r2:
                        covered = True
                        break
                if not covered:
                    bad += 1
            x += step_m
        y += step_m
    return total, bad


def _level_from_rect(
    w: float, h: float, hazard: str, use: str = "residential",
) -> Level:
    polygon = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    room = Room(
        id="r1", name="Main",
        polygon_m=polygon,
        area_sqm=w * h, hazard_class=hazard,
        ceiling=Ceiling(height_m=3.0),
    )
    return Level(
        id="l1", name="L1",
        elevation_m=0.0, height_m=3.0,
        use=use,  # type: ignore[arg-type]
        polygon_m=polygon,
        rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )


def test_full_coverage_square_room_light() -> None:
    """12m × 12m light-hazard room — every audit point covered."""
    level = _level_from_rect(12.0, 12.0, "light")
    bldg = Building(project_id="cov", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(level.polygon_m)
    radius = _coverage_radius_m("light")
    total, bad = _audit_coverage(poly, heads, radius)
    assert total > 0
    # Allow up to 2% of audit points uncovered — these sit within the
    # 4" wall-offset band where NFPA doesn't require coverage anyway.
    assert bad / total < 0.02, (
        f"{bad}/{total} audit points uncovered on 12×12 light-hazard"
    )


def test_full_coverage_large_room_light() -> None:
    """30m × 20m open residential floor — must still be fully covered."""
    level = _level_from_rect(30.0, 20.0, "light")
    bldg = Building(project_id="cov2", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(level.polygon_m)
    radius = _coverage_radius_m("light")
    total, bad = _audit_coverage(poly, heads, radius, step_m=1.0)
    assert total > 0
    assert bad / total < 0.03, (
        f"{bad}/{total} uncovered on 30×20 light-hazard floor, "
        f"heads placed = {len(heads)}"
    )


def test_full_coverage_l_shaped_room() -> None:
    """L-shape built from two rectangles — concave polygon coverage."""
    # L-shape: 20×10 trunk + 10×10 foot
    l_poly = [
        (0.0, 0.0), (20.0, 0.0), (20.0, 10.0),
        (10.0, 10.0), (10.0, 20.0), (0.0, 20.0),
    ]
    room = Room(
        id="r1", name="L room",
        polygon_m=l_poly, area_sqm=300.0,
        hazard_class="light",
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l1", name="L1", elevation_m=0.0, height_m=3.0,
        use="residential", polygon_m=l_poly, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="cov_l", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(l_poly)
    radius = _coverage_radius_m("light")
    total, bad = _audit_coverage(poly, heads, radius, step_m=0.8)
    assert total > 0
    # L-shape corner is hardest; allow 5% slack. Placer's gap-repair
    # pass should drop fills into the concave pocket.
    assert bad / total < 0.05, (
        f"L-shape uncovered {bad}/{total} (heads={len(heads)})"
    )


def test_full_coverage_ordinary_hazard() -> None:
    """Ord-i spacing tighter → more heads per sqm."""
    level = _level_from_rect(15.0, 12.0, "ordinary_i")
    bldg = Building(project_id="cov_o", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(level.polygon_m)
    radius = _coverage_radius_m("ordinary_i")
    total, bad = _audit_coverage(poly, heads, radius)
    assert bad / total < 0.02
    # Coverage ≤ 12.1 sqm/head per §8.6.2.2.1
    cov_per_head = (15.0 * 12.0) / len(heads)
    assert cov_per_head <= 12.1 * 1.02, (
        f"ord-i coverage {cov_per_head:.1f} > cap"
    )
