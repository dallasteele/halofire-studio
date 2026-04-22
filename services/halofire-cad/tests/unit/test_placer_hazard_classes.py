"""Phase E hazard-class test — light / ordinary-i / extra-i produce
head counts matching their NFPA 13 §8.6 max coverage areas.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_hz", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)

from cad.schema import Building, Ceiling, Level, Room  # noqa: E402


def _count_for(hazard: str, w: float = 20.0, h: float = 15.0) -> int:
    polygon = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    room = Room(
        id="r1", name="Main", polygon_m=polygon,
        area_sqm=w * h, hazard_class=hazard,
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l1", name="L1", elevation_m=0.0, height_m=3.0,
        use="residential", polygon_m=polygon, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="hz", levels=[level])
    return len(PLACER.place_heads_for_building(bldg))


def test_ordinary_i_denser_than_light() -> None:
    n_light = _count_for("light")
    n_ord = _count_for("ordinary_i")
    assert n_ord > n_light, (
        f"ord-i heads ({n_ord}) should exceed light ({n_light})"
    )


def test_extra_i_denser_than_ordinary() -> None:
    n_ord = _count_for("ordinary_i")
    n_extra = _count_for("extra_i")
    assert n_extra >= n_ord, (
        f"extra-i heads ({n_extra}) should meet or exceed "
        f"ord-i ({n_ord}) — extra-i spacing is tighter"
    )


def test_head_count_within_nfpa_cap_for_each_class() -> None:
    """head count × max_coverage_sqm ≥ floor area (within ~5% slack)."""
    for hazard in ("light", "ordinary_i", "extra_i"):
        w, h = 20.0, 15.0
        n = _count_for(hazard, w, h)
        max_cov = PLACER.MAX_COVERAGE_SQM[hazard]
        min_required = (w * h) / max_cov
        assert n >= min_required * 0.95, (
            f"{hazard}: placed {n} heads, NFPA §8.6.2.2.1 needs "
            f">= {min_required:.1f}"
        )


def test_k_factor_matches_hazard() -> None:
    """Each head's k_factor reflects the hazard it sits in."""
    expected = {
        "light": 5.6,
        "ordinary_i": 8.0,
        "extra_i": 11.2,
    }
    for hazard, k in expected.items():
        polygon = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
        room = Room(
            id="r1", name="M", polygon_m=polygon,
            area_sqm=100.0, hazard_class=hazard,
            ceiling=Ceiling(height_m=3.0),
        )
        level = Level(
            id="l1", name="L", elevation_m=0.0, height_m=3.0,
            polygon_m=polygon, rooms=[room],
            ceiling=Ceiling(height_m=3.0),
        )
        bldg = Building(project_id="k", levels=[level])
        heads = PLACER.place_heads_for_building(bldg)
        assert heads, f"no heads placed for {hazard}"
        for hd in heads:
            assert hd.k_factor == k, (
                f"{hazard}: head k={hd.k_factor} expected {k}"
            )
