"""R4.1 — orchestrator emits Design slices per stage.

Asserts progress_callback receives a "slice" field on every stage
event (not counting the terminal "done" marker) so the editor's
AutoPilot can spawn nodes incrementally.

Uses the procedural building generator (agents/14-building-gen) to
avoid depending on PDF intake. The orchestrator's first stage is
patched to return that synthesized Building.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_orchestrator_slice", ROOT / "orchestrator.py",
)
assert _SPEC is not None and _SPEC.loader is not None
ORCH = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ORCH)

_BG_SPEC = importlib.util.spec_from_file_location(
    "hf_bg_slice", ROOT / "agents" / "14-building-gen" / "agent.py",
)
assert _BG_SPEC is not None and _BG_SPEC.loader is not None
BG = importlib.util.module_from_spec(_BG_SPEC)
sys.modules["hf_bg_slice"] = BG
_BG_SPEC.loader.exec_module(BG)

from cad.schema import BuildingGenSpec, LevelGenSpec  # noqa: E402


def _tiny_building():
    spec = BuildingGenSpec(
        project_id="slice-test",
        total_sqft_target=4000.0,
        levels=[
            LevelGenSpec(name="L1", use="residential", unit_count=2),
        ],
        stair_shaft_count=1,
        mech_room_count=0,
        include_corridor=True,
    )
    return BG.generate_building(spec)


@pytest.fixture(scope="module")
def pipeline_events(
    tmp_path_factory: pytest.TempPathFactory,
) -> list[dict]:
    events: list[dict] = []
    out = tmp_path_factory.mktemp("slice-emit")

    # Patch INTAKE to bypass PDF parsing — return a synthesized building.
    original = ORCH.INTAKE.intake_file
    bldg = _tiny_building()
    ORCH.INTAKE.intake_file = lambda pdf_path, project_id: bldg
    try:
        ORCH.run_pipeline(
            "unused.pdf", project_id="slice-test",
            out_dir=out,
            progress_callback=lambda e: events.append(e),
        )
    finally:
        ORCH.INTAKE.intake_file = original
    return events


def test_pipeline_emits_at_least_ten_events(
    pipeline_events: list[dict],
) -> None:
    """Each of the 10 stages + final 'done' marker should fire."""
    assert len(pipeline_events) >= 10, (
        f"expected >= 10 progress events, got {len(pipeline_events)}: "
        f"{[e.get('step') for e in pipeline_events]}"
    )


def test_every_done_event_has_slice_except_final(
    pipeline_events: list[dict],
) -> None:
    """Stage events carry "slice"; the terminal step='done' carries files."""
    for e in pipeline_events:
        if not e.get("done"):
            continue
        if e.get("step") == "done":
            # Terminal marker — carries 'files' instead of a slice.
            assert "files" in e, f"terminal done must carry files: {e}"
            continue
        assert "slice" in e, (
            f"stage event missing 'slice': step={e.get('step')} keys={list(e)}"
        )


def test_place_slice_has_sprinkler_heads_list(
    pipeline_events: list[dict],
) -> None:
    """The place stage slice must expose sprinkler_heads as a list."""
    place_events = [e for e in pipeline_events if e.get("step") == "place"]
    assert place_events, "pipeline must emit a 'place' event"
    slice_ = place_events[0].get("slice")
    assert isinstance(slice_, dict), f"place slice must be a dict: {slice_!r}"
    heads = slice_.get("sprinkler_heads")
    assert isinstance(heads, list), (
        f"place.slice.sprinkler_heads must be a list, got {type(heads).__name__}"
    )
