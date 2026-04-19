"""Shared pytest fixtures for halofire-cad tests.

Per AGENTIC_RULES §5.1, these fixtures are reused across unit /
property / stress / e2e test layers so each layer exercises the same
agent contracts without per-test scaffolding drift.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cad.schema import (  # noqa: E402
    Building, Ceiling, FlowTestData, Level, Room, Shaft,
)


# ── Buildings (size tiers) ──────────────────────────────────────────


@pytest.fixture
def tiny_building() -> Building:
    """One level, one 10×10 m light-hazard room.

    The canonical "does anything at all work" fixture. Every agent's
    happy-path test uses this.
    """
    level = Level(
        id="l1",
        name="Level 1",
        elevation_m=0.0,
        height_m=3.0,
        use="residential",
        ceiling=Ceiling(height_m=3.0, kind="flat"),
        rooms=[
            Room(
                id="r1",
                name="Unit 101 Living",
                polygon_m=[(0, 0), (10, 0), (10, 10), (0, 10)],
                area_sqm=100.0,
                use_class="dwelling_unit",
                hazard_class="light",
                ceiling=Ceiling(height_m=3.0, kind="flat"),
            ),
        ],
    )
    return Building(
        project_id="tiny-test",
        levels=[level],
        construction_type="Type V-A",
        total_sqft=1076,
    )


@pytest.fixture
def medium_building() -> Building:
    """4 levels, mixed hazards, ~20 rooms.

    Approximates a small 4-story residential with a garage level.
    Exercises per-level routing + classifier level-use inference.
    """
    levels: list[Level] = []
    for idx in range(4):
        use = "garage" if idx == 0 else "residential"
        hazard = "ordinary_i" if idx == 0 else "light"
        rooms = [
            Room(
                id=f"l{idx}_r{j}",
                name=f"Level {idx} Room {j}",
                polygon_m=[
                    (j * 12, 0), ((j + 1) * 12, 0),
                    ((j + 1) * 12, 10), (j * 12, 10),
                ],
                area_sqm=120.0,
                use_class="parking_garage" if use == "garage" else "dwelling_unit",
                hazard_class=hazard,
                ceiling=Ceiling(height_m=3.0, kind="flat"),
            )
            for j in range(5)
        ]
        lvl = Level(
            id=f"l{idx}",
            name=f"Level {idx}",
            elevation_m=idx * 3.0,
            height_m=3.0,
            use=use,
            polygon_m=[(0, 0), (60, 0), (60, 10), (0, 10)],
            rooms=rooms,
            ceiling=Ceiling(height_m=3.0, kind="flat"),
            stair_shafts=[Shaft(
                id=f"stair_l{idx}",
                kind="stair",
                polygon_m=[(55, 4), (60, 4), (60, 8), (55, 8)],
                top_z_m=(idx + 1) * 3.0,
                bottom_z_m=idx * 3.0,
            )],
        )
        levels.append(lvl)
    return Building(
        project_id="medium-test",
        levels=levels,
        construction_type="Type III-B over I-A",
        total_sqft=25830,
    )


@pytest.fixture
def stress_building() -> Building:
    """10 levels × 20 rooms — stress harness input.

    Marked under @pytest.mark.stress to exclude from default test runs.
    Exercises scaling behavior for placer + router + rulecheck.
    """
    levels: list[Level] = []
    for idx in range(10):
        rooms = [
            Room(
                id=f"sl{idx}_r{j}",
                name=f"L{idx} Unit {j}",
                polygon_m=[
                    (j * 10, 0), ((j + 1) * 10, 0),
                    ((j + 1) * 10, 8), (j * 10, 8),
                ],
                area_sqm=80.0,
                use_class="dwelling_unit",
                hazard_class="light",
                ceiling=Ceiling(height_m=3.0, kind="flat"),
            )
            for j in range(20)
        ]
        levels.append(Level(
            id=f"sl{idx}",
            name=f"Stress Level {idx}",
            elevation_m=idx * 3.0,
            height_m=3.0,
            use="residential",
            polygon_m=[(0, 0), (200, 0), (200, 8), (0, 8)],
            rooms=rooms,
            ceiling=Ceiling(height_m=3.0, kind="flat"),
        ))
    return Building(
        project_id="stress-test",
        levels=levels,
        total_sqft=172000,
    )


# ── Supply curves ───────────────────────────────────────────────────


@pytest.fixture
def supply_strong() -> FlowTestData:
    """Generous municipal supply — no pump required."""
    return FlowTestData(
        static_psi=85, residual_psi=65, flow_gpm=1500,
        test_date="2025-01-15", location="1881 W North Temple (simulated)",
    )


@pytest.fixture
def supply_weak() -> FlowTestData:
    """Marginal supply — exercises the upsize loop."""
    return FlowTestData(
        static_psi=50, residual_psi=30, flow_gpm=300,
        test_date="2025-01-15", location="synthetic weak",
    )
