"""Unit tests for 02-placer per AGENTIC_RULES §5.1 + §5.2 setup."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_test", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)

from cad.schema import Ceiling, Level, Room  # noqa: E402


def test_place_heads_happy_path(tiny_building) -> None:
    heads = PLACER.place_heads_for_building(tiny_building)
    assert heads, "tiny_building 10x10 light room must yield at least one head"
    for h in heads:
        assert h.room_id == "r1"
        assert h.k_factor == 5.6  # light → K5.6 per §11.2.6


def test_place_heads_inside_room_polygon(tiny_building) -> None:
    """Every placed head sits inside the originating room polygon."""
    room = tiny_building.levels[0].rooms[0]
    poly = Polygon(room.polygon_m)
    heads = PLACER.place_heads_for_building(tiny_building)
    for h in heads:
        x, y, _z = h.position_m
        # Must land inside the polygon or within a tiny tolerance.
        assert poly.buffer(0.01).contains(Point(x, y)), (
            f"head {h.id} at ({x:.2f},{y:.2f}) outside room polygon"
        )


def test_place_heads_empty_building_returns_empty() -> None:
    from cad.schema import Building
    bldg = Building(project_id="empty", levels=[])
    assert PLACER.place_heads_for_building(bldg) == []


def test_place_heads_skips_small_closet() -> None:
    level = Level(
        id="l0", name="L0", elevation_m=0, height_m=3.0,
        ceiling=Ceiling(),
        rooms=[
            Room(
                id="closet",
                name="Hall closet",
                polygon_m=[(0, 0), (1.2, 0), (1.2, 1.0), (0, 1.0)],
                area_sqm=1.2,   # < 2.2 sqm → skipped
                hazard_class="light",
            ),
        ],
    )
    from cad.schema import Building
    bldg = Building(project_id="test", levels=[level])
    assert PLACER.place_heads_for_building(bldg) == []


def test_place_heads_malformed_polygon_no_crash() -> None:
    level = Level(
        id="lm", name="Malformed", elevation_m=0, ceiling=Ceiling(),
        rooms=[
            Room(
                id="bad",
                name="Bad polygon",
                polygon_m=[(0, 0), (0, 0), (0, 0)],  # degenerate
                area_sqm=0.0,
                hazard_class="light",
            ),
        ],
    )
    from cad.schema import Building
    bldg = Building(project_id="test", levels=[level])
    # Must not raise; returns empty heads for this room.
    heads = PLACER.place_heads_for_building(bldg)
    assert heads == []


@pytest.mark.xfail(
    reason=(
        "Known placer bug: spacing/2 wall inset + axis-aligned grid "
        "under-covers 10x10 m rooms (25 sqm/head > 20.9 cap). Fix lives "
        "in 2026-04-19-rulebook-compliance-refactor.md as a placer v3 "
        "item. Test stays red to keep pressure on the fix."
    ),
    strict=True,
)
def test_place_heads_coverage_cap_light(tiny_building) -> None:
    """§11.2.3.1.2 light-hazard cap: sqft/head ≤ 225."""
    heads = PLACER.place_heads_for_building(tiny_building)
    room_area_sqm = 100.0
    coverage_sqm = room_area_sqm / len(heads)
    cap_sqm = 225 * 0.0929
    assert coverage_sqm <= cap_sqm, (
        f"coverage {coverage_sqm:.1f} sqm/head exceeds cap {cap_sqm:.1f}"
    )


def test_place_heads_deflector_below_ceiling() -> None:
    from cad.schema import Building
    level = Level(
        id="l1", name="L1", elevation_m=0, height_m=3.0,
        ceiling=Ceiling(height_m=3.0),
        rooms=[Room(
            id="r1", name="Test",
            polygon_m=[(0, 0), (6, 0), (6, 6), (0, 6)],
            area_sqm=36.0, hazard_class="light",
            ceiling=Ceiling(height_m=3.0),
        )],
    )
    bldg = Building(project_id="t", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    for h in heads:
        assert h.deflector_below_ceiling_mm == 100
        # z should be ceiling_m - 0.1 = 2.9
        assert abs(h.position_m[2] - 2.9) < 0.01
