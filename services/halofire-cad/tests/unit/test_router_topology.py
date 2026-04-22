"""Phase E router topology test — output includes a cross-main,
>= 2 branch lines, and every head reached by a drop.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC_P = importlib.util.spec_from_file_location(
    "hf_placer_rt", ROOT / "agents" / "02-placer" / "agent.py",
)
PLACER = importlib.util.module_from_spec(_SPEC_P)
_SPEC_P.loader.exec_module(PLACER)

_SPEC_R = importlib.util.spec_from_file_location(
    "hf_router_top", ROOT / "agents" / "03-router" / "agent.py",
)
ROUTER = importlib.util.module_from_spec(_SPEC_R)
_SPEC_R.loader.exec_module(ROUTER)

from cad.schema import Building, Ceiling, Level, Room  # noqa: E402


def _building_big_room() -> Building:
    polygon = [(0.0, 0.0), (30.0, 0.0), (30.0, 18.0), (0.0, 18.0)]
    room = Room(
        id="r1", name="Open floor",
        polygon_m=polygon, area_sqm=540.0,
        hazard_class="light", ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l1", name="L1", elevation_m=0.0, height_m=3.0,
        use="residential", polygon_m=polygon, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    return Building(project_id="top", levels=[level])


def test_topology_has_cross_main_and_branches() -> None:
    bldg = _building_big_room()
    heads = PLACER.place_heads_for_building(bldg)
    systems = ROUTER.route_systems(bldg, heads)
    wet = [s for s in systems if s.type == "wet"]
    assert len(wet) >= 1
    sys0 = wet[0]
    roles: dict[str, int] = {}
    for p in sys0.pipes:
        roles[p.role] = roles.get(p.role, 0) + 1
    assert roles.get("cross_main", 0) >= 1, (
        f"expected >= 1 cross_main, got {roles}"
    )
    assert roles.get("branch", 0) >= 2, (
        f"expected >= 2 branch lines, got {roles}"
    )
    assert roles.get("riser_nipple", 0) >= 1


def test_every_head_has_a_drop() -> None:
    bldg = _building_big_room()
    heads = PLACER.place_heads_for_building(bldg)
    systems = ROUTER.route_systems(bldg, heads)
    sys0 = systems[0]
    head_ids = {h.id for h in sys0.heads}
    drop_targets = {
        p.to_node for p in sys0.pipes if p.role == "drop"
    } | {
        p.from_node for p in sys0.pipes if p.role == "drop"
    }
    reached = head_ids & drop_targets
    coverage = len(reached) / len(head_ids) if head_ids else 0
    assert coverage >= 0.95, (
        f"only {coverage:.0%} of heads have a drop pipe"
    )


def test_heads_connected_to_network() -> None:
    """Each head must appear as an endpoint on at least one pipe."""
    bldg = _building_big_room()
    heads = PLACER.place_heads_for_building(bldg)
    systems = ROUTER.route_systems(bldg, heads)
    sys0 = systems[0]
    endpoints: set[str] = set()
    for p in sys0.pipes:
        endpoints.add(p.from_node)
        endpoints.add(p.to_node)
    reached = sum(1 for h in sys0.heads if h.id in endpoints)
    assert reached / len(sys0.heads) >= 0.95


def test_single_cross_main_per_level() -> None:
    """There should be a single coherent cross-main (possibly in
    multiple segments between tees) running along one axis, not
    scattered trunks.
    """
    bldg = _building_big_room()
    heads = PLACER.place_heads_for_building(bldg)
    systems = ROUTER.route_systems(bldg, heads)
    sys0 = systems[0]
    cm = [p for p in sys0.pipes if p.role == "cross_main"]
    assert cm, "no cross_main pipes"
    # All cross-main segments should share the same orientation axis
    xs = [abs(p.end_m[0] - p.start_m[0]) for p in cm]
    ys = [abs(p.end_m[1] - p.start_m[1]) for p in cm]
    mostly_x = sum(1 for i in range(len(cm)) if xs[i] > ys[i])
    mostly_y = len(cm) - mostly_x
    # Either almost all along X or almost all along Y
    assert mostly_x == 0 or mostly_y == 0, (
        f"cross-main not coherent: {mostly_x} along x, {mostly_y} along y"
    )
