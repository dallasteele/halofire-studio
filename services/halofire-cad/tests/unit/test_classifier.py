"""Unit tests for 01-classifier per AGENTIC_RULES §5.1."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_classifier_test",
    ROOT / "agents" / "01-classifier" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
CLASSIFIER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(CLASSIFIER)

from cad.schema import Ceiling, Room  # noqa: E402


def _room(name: str, use: str = "unknown", area: float = 20.0) -> Room:
    return Room(
        id=f"r_{name.lower()}",
        name=name,
        polygon_m=[(0, 0), (5, 0), (5, 4), (0, 4)],
        area_sqm=area,
        use_class=use,
        ceiling=Ceiling(height_m=3.0),
    )


@pytest.mark.parametrize("use,expected", [
    ("dwelling_unit", "light"),
    ("apartment", "light"),  # synonym → dwelling_unit → light
    ("parking_garage", "ordinary_i"),
    ("commercial_kitchen", "ordinary_ii"),
    ("mechanical_room", "ordinary_i"),
])
def test_classify_room_known_uses(use: str, expected: str) -> None:
    room = _room(f"Test {use}", use=use)
    hazard, source, conf = CLASSIFIER.classify_room(room)
    assert hazard == expected
    assert conf >= 0.9
    assert source in ("rule", "rule_synonym")


def test_classify_room_unknown_falls_to_default() -> None:
    room = _room("Weirdly Named Room", use="unknown_type_xyz")
    hazard, source, conf = CLASSIFIER.classify_room(room)
    assert hazard in {"light", "ordinary_i", "ordinary_ii"}
    assert source in {"default", "size", "size_parking"}
    # Default confidence is capped per §13 honesty: never inflate
    assert conf <= 0.75


def test_classify_room_name_synonym_expansion() -> None:
    # Name-based synonym path: "Kitchen" → kitchen_residential → light
    room = _room("Kitchen", use="unknown")
    hazard, source, _ = CLASSIFIER.classify_room(room)
    assert hazard == "light"
    assert source == "rule_synonym"


def test_classify_building_mutates_in_place(tiny_building) -> None:
    # tiny_building already has hazard_class set; wipe and reclassify
    for lvl in tiny_building.levels:
        for room in lvl.rooms:
            room.hazard_class = None
    out = CLASSIFIER.classify_building(tiny_building)
    assert out is tiny_building
    for lvl in tiny_building.levels:
        for room in lvl.rooms:
            assert room.hazard_class is not None


def test_classify_level_use_detects_garage(medium_building) -> None:
    # Pre-existing hazard_class on medium_building rooms drives the
    # level-use inference
    CLASSIFIER.classify_level_use(medium_building)
    uses = [l.use for l in medium_building.levels]
    assert "garage" in uses
    assert "residential" in uses
