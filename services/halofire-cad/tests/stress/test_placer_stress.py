"""Stress tests for the placer agent per AGENTIC_RULES §5.3.

Gated under ``@pytest.mark.stress``. Run via
``pytest -q -m stress services/halofire-cad/tests/stress``. Default
test run skips these.

Budget (§1.4): 10-level 200-room building, placer completes < 20 s,
produces heads for every room that has polygon > 2 sqm.
"""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_stress", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)


@pytest.mark.stress
@pytest.mark.slow
def test_placer_handles_stress_building(stress_building) -> None:
    """10 levels × 20 rooms → heads in < 20 s."""
    start = time.perf_counter()
    heads = PLACER.place_heads_for_building(stress_building)
    elapsed = time.perf_counter() - start

    # Budget enforcement (§1.4)
    assert elapsed < 20.0, (
        f"placer stress run took {elapsed:.1f} s (budget: 20 s)"
    )

    # Coverage invariant: the stress fixture has 200 rooms at 80 sqm
    # each, all light-hazard. Every room should yield ≥ 1 head.
    total_rooms = sum(len(l.rooms) for l in stress_building.levels)
    assert len(heads) >= total_rooms, (
        f"only {len(heads)} heads for {total_rooms} rooms"
    )

    # Every head must have a valid room_id pointer
    room_ids = {r.id for l in stress_building.levels for r in l.rooms}
    for h in heads:
        assert h.room_id in room_ids
