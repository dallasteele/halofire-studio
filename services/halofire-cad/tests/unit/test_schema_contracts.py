"""Unit tests for the typed agent I/O contracts added in R1.

Covers AGENTIC_RULES §1.1 (stateless typed I/O) by round-tripping the
pydantic models through JSON and asserting the schema version is
pinned.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from cad.schema import (  # noqa: E402
    JobStatus, PageIntakeResult, PipelineStep, PipelineSummary,
    RoomCandidate, SCHEMA_VERSION, WallCandidate,
)


def test_page_intake_result_happy_roundtrip() -> None:
    original = PageIntakeResult(
        pdf_path="/tmp/sample.pdf",
        page_index=0,
        page_w_pt=612.0,
        page_h_pt=792.0,
        raw_line_count=250,
        wall_count=2,
        room_count=1,
        scale_ft_per_pt=0.3333,
        walls=[WallCandidate(x0=0, y0=0, x1=100, y1=0)],
        rooms=[RoomCandidate(
            polygon_pt=[(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)],
            area_pt2=5000.0,
        )],
        warnings=[],
    )
    dumped = original.model_dump_json()
    reloaded = PageIntakeResult.model_validate_json(dumped)
    assert reloaded.schema_version == SCHEMA_VERSION
    assert reloaded.wall_count == 2
    assert reloaded.rooms[0].area_pt2 == 5000.0


def test_page_intake_result_empty_defaults() -> None:
    result = PageIntakeResult(pdf_path="x.pdf", page_index=5)
    assert result.schema_version == SCHEMA_VERSION
    assert result.walls == []
    assert result.rooms == []
    assert result.warnings == []


def test_page_intake_result_rejects_malformed() -> None:
    # Polygon points must be tuples of (float, float). Pydantic v2
    # coerces sequences, but an outright non-list fails.
    with pytest.raises(Exception):
        PageIntakeResult.model_validate({
            "pdf_path": "x",
            "page_index": 0,
            "rooms": "not a list",
        })


def test_pipeline_summary_roundtrip() -> None:
    summary = PipelineSummary(
        project_id="1881-test",
        steps=[
            PipelineStep(step="intake", ok=True, stats={"levels": 6}),
            PipelineStep(step="classify", ok=True, stats={"hazards": 45}),
            PipelineStep(step="place", ok=False, error="no rooms"),
        ],
        files={"design": "/out/design.json"},
        status="completed",
    )
    as_json = json.loads(summary.model_dump_json())
    assert as_json["schema_version"] == SCHEMA_VERSION
    assert as_json["status"] == "completed"
    assert len(as_json["steps"]) == 3
    assert as_json["steps"][2]["ok"] is False


def test_job_status_default_is_queued() -> None:
    job = JobStatus(job_id="abc", project_id="p")
    assert job.status == "queued"
    assert job.percent == 0
    assert job.steps_complete == []


def test_job_status_carries_nested_summary() -> None:
    job = JobStatus(
        job_id="xyz", project_id="p",
        status="completed",
        summary=PipelineSummary(project_id="p", status="completed"),
    )
    dumped = job.model_dump()
    assert dumped["summary"]["project_id"] == "p"
    assert dumped["summary"]["schema_version"] == SCHEMA_VERSION
