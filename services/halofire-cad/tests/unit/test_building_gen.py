"""Phase J — procedural building generator tests.

Per AGENTIC_RULES §5.1 happy/empty/malformed paths + §5.2 property
invariants + §5.4 GLB smoke parse.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_BG_SPEC = importlib.util.spec_from_file_location(
    "hf_bg", ROOT / "agents" / "14-building-gen" / "agent.py",
)
assert _BG_SPEC is not None and _BG_SPEC.loader is not None
BG = importlib.util.module_from_spec(_BG_SPEC)
sys.modules["hf_bg"] = BG
_BG_SPEC.loader.exec_module(BG)

_GLB_SPEC = importlib.util.spec_from_file_location(
    "hf_bg_glb", ROOT / "agents" / "14-building-gen" / "glb.py",
)
assert _GLB_SPEC is not None and _GLB_SPEC.loader is not None
GLB = importlib.util.module_from_spec(_GLB_SPEC)
sys.modules["hf_bg_glb"] = GLB
_GLB_SPEC.loader.exec_module(GLB)

from cad.exceptions import HalofireError  # noqa: E402
from cad.schema import BuildingGenSpec, LevelGenSpec  # noqa: E402


# ── Happy paths ────────────────────────────────────────────────────


def test_default_residential_produces_full_building() -> None:
    spec = BG._default_residential_spec(170_000, stories=4, garage_levels=2)
    bldg = BG.generate_building(spec)
    assert bldg.project_id == "demo-synthetic"
    assert len(bldg.levels) == 6
    # Synthesized flag surfaces for UIs (§13)
    assert bldg.metadata["synthesized"] is True
    # 4 residential + 2 garage
    residential = [l for l in bldg.levels if l.use == "residential"]
    garage = [l for l in bldg.levels if l.use == "garage"]
    assert len(residential) == 4
    assert len(garage) == 2
    # Residential levels have unit rooms; garages have one open room
    assert all(len(l.rooms) == 20 for l in residential)
    assert all(len(l.rooms) == 1 for l in garage)


def test_small_building_still_valid() -> None:
    spec = BuildingGenSpec(
        project_id="tiny",
        total_sqft_target=2000,
        levels=[LevelGenSpec(name="Only", unit_count=4)],
        stair_shaft_count=1,
    )
    bldg = BG.generate_building(spec)
    assert len(bldg.levels) == 1
    assert len(bldg.levels[0].rooms) == 4
    # Walls: 4 exterior + some interior
    assert len(bldg.levels[0].walls) >= 4


def test_total_sqft_within_5pct_of_target() -> None:
    """§13 honesty: generator's claim of total_sqft should match."""
    for target in [10_000, 50_000, 170_000]:
        spec = BG._default_residential_spec(target, stories=3, garage_levels=1)
        bldg = BG.generate_building(spec)
        delta = abs(bldg.total_sqft - target) / target
        assert delta < 0.05, (
            f"total_sqft {bldg.total_sqft} off target {target} by {delta:.2%}"
        )


def test_stair_shafts_placed_and_span_level() -> None:
    spec = BG._default_residential_spec(50_000, stories=2, garage_levels=1)
    bldg = BG.generate_building(spec)
    for level in bldg.levels:
        assert len(level.stair_shafts) == 2
        for shaft in level.stair_shafts:
            assert shaft.top_z_m > shaft.bottom_z_m
            assert shaft.kind == "stair"


def test_mech_room_on_top_residential_level() -> None:
    spec = BG._default_residential_spec(50_000, stories=3, garage_levels=1)
    bldg = BG.generate_building(spec)
    # Top-most residential should carry a mech room
    top = bldg.levels[-1]
    assert top.use == "residential"
    assert len(top.mech_rooms) == 1


# ── Error paths (§1.3 errors as data) ──────────────────────────────


def test_zero_sqft_raises_typed_exception() -> None:
    spec = BuildingGenSpec(
        project_id="bad", total_sqft_target=0,
        levels=[LevelGenSpec(name="x")],
    )
    with pytest.raises(BG.BuildingSpecInvalid) as exc:
        BG.generate_building(spec)
    assert exc.value.code == "BUILDING_SPEC_INVALID"


def test_empty_levels_raises() -> None:
    spec = BuildingGenSpec(project_id="bad", total_sqft_target=1000, levels=[])
    with pytest.raises(BG.BuildingSpecInvalid):
        BG.generate_building(spec)


def test_zero_aspect_raises() -> None:
    spec = BuildingGenSpec(
        project_id="bad", total_sqft_target=1000,
        aspect_ratio=0.0, levels=[LevelGenSpec(name="x", unit_count=1)],
    )
    with pytest.raises(BG.BuildingSpecInvalid):
        BG.generate_building(spec)


# ── Property invariants (§5.2) ─────────────────────────────────────


@pytest.mark.property
@given(
    sqft=st.floats(min_value=2_000, max_value=500_000,
                   allow_nan=False, allow_infinity=False),
    stories=st.integers(min_value=1, max_value=8),
    garage=st.integers(min_value=0, max_value=2),
)
@settings(
    max_examples=30, deadline=3000,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_every_room_inside_level_polygon(
    sqft: float, stories: int, garage: int,
) -> None:
    spec = BG._default_residential_spec(sqft, stories, garage)
    bldg = BG.generate_building(spec)
    for level in bldg.levels:
        level_poly = Polygon(level.polygon_m).buffer(0.01)
        for room in level.rooms:
            room_poly = Polygon(room.polygon_m)
            assert level_poly.contains(room_poly.centroid), (
                f"{room.id} centroid outside {level.id}"
            )


@pytest.mark.property
@given(
    unit_count=st.integers(min_value=1, max_value=50),
)
@settings(
    max_examples=20, deadline=2000,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_grid_rooms_never_degenerate(unit_count: int) -> None:
    spec = BuildingGenSpec(
        project_id="grid", total_sqft_target=30_000,
        levels=[LevelGenSpec(
            name="probe", use="residential", unit_count=unit_count,
        )],
    )
    bldg = BG.generate_building(spec)
    for room in bldg.levels[0].rooms:
        poly = Polygon(room.polygon_m)
        assert poly.is_valid
        assert poly.area > 0.5, f"room {room.id} area {poly.area} degenerate"


# ── GLB smoke (§5.4 golden-style: round-trip must parse) ───────────


def test_glb_emits_valid_mesh(tmp_path: Path) -> None:
    spec = BG._default_residential_spec(40_000, stories=2, garage_levels=1)
    bldg = BG.generate_building(spec)
    out = tmp_path / "shell.glb"
    path = GLB.building_to_glb(bldg, out)
    assert Path(path).exists()
    assert Path(path).stat().st_size > 1000
    # Round-trip through trimesh
    import trimesh
    scene = trimesh.load(str(out))
    # Must have ≥ 1 mesh (slabs + walls + shafts)
    geom_count = len(scene.geometry) if hasattr(scene, "geometry") else 0
    assert geom_count >= 3, f"expected ≥ 3 meshes, got {geom_count}"


def test_glb_fails_cleanly_on_empty_building(tmp_path: Path) -> None:
    """§1.3 — raise typed exception, not silent junk."""
    from cad.exceptions import GLBExportError
    from cad.schema import Building
    empty = Building(project_id="empty")
    with pytest.raises(GLBExportError):
        GLB.building_to_glb(empty, tmp_path / "empty.glb")
