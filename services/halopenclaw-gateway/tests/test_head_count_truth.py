"""Fail-closed tests for the gateway's sealed head-count truth adapter."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import head_count_truth as subject  # noqa: E402


@dataclass(frozen=True)
class _Record:
    project_id: str
    head_count: int | None


def test_missing_truth_stays_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subject, "_lookup_truth_record", lambda _project_id: None)
    result = subject.build_head_count_truth("alpha", 8)
    assert result == {
        "projectId": "alpha",
        "truthProjectId": None,
        "expectedHeadCount": None,
        "actualHeadCount": 8,
        "deltaCount": None,
        "deltaPct": None,
        "status": "truth-unavailable",
        "matched": False,
        "warning": "Head count truth mismatch: no sealed truth record for project 'alpha'; actual=8.",
    }


def test_absent_truth_store_is_read_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = tmp_path / "sealed" / "truth.duckdb"
    monkeypatch.setattr(subject, "_TRUTH_DB_PATH", missing)
    assert subject._lookup_truth_record("1881-cooperative") is None
    assert not missing.exists()


def test_1881_alias_reads_sealed_record_and_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def lookup(project_id: str) -> _Record | None:
        calls.append(project_id)
        return _Record("1881-cooperative", 1420) if project_id == "1881-cooperative" else None

    monkeypatch.setattr(subject, "_lookup_truth_record", lookup)
    result = subject.build_head_count_truth("cooperative-1881", 1420)
    assert calls == ["cooperative-1881", "1881-cooperative"]
    assert result["status"] == "match"
    assert result["matched"] is True
    assert result["warning"] is None
    assert result["truthProjectId"] == "1881-cooperative"


def test_mismatch_reports_exact_delta(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subject, "_lookup_truth_record", lambda _project_id: _Record("1881-cooperative", 1420))
    result = subject.build_head_count_truth("1881", 243)
    assert result["status"] == "mismatch"
    assert result["expectedHeadCount"] == 1420
    assert result["actualHeadCount"] == 243
    assert result["deltaCount"] == -1177
    assert result["deltaPct"] == -82.887324
    assert "Head count truth mismatch" in str(result["warning"])


def test_missing_expected_count_does_not_invent_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subject, "_lookup_truth_record", lambda _project_id: _Record("project-a", None))
    result = subject.build_head_count_truth("project-a", 12)
    assert result["status"] == "truth-unavailable"
    assert result["expectedHeadCount"] is None
    assert "no usable expected head count" in str(result["warning"])


@pytest.mark.parametrize("actual", [-1, True, 3.5])
def test_invalid_actual_count_rejects(actual: object, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subject, "_lookup_truth_record", lambda _project_id: _Record("project-a", 12))
    result = subject.build_head_count_truth("project-a", actual)  # type: ignore[arg-type]
    assert result["status"] == "invalid-actual-count"
    assert result["actualHeadCount"] is None
    assert result["matched"] is False


def test_truth_source_failure_is_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(_project_id: str) -> _Record | None:
        raise RuntimeError("offline")

    monkeypatch.setattr(subject, "_lookup_truth_record", broken)
    result = subject.build_head_count_truth("project-a", 12)
    assert result["status"] == "truth-source-unavailable"
    assert result["warning"] == (
        "Head count truth mismatch: sealed truth source unavailable for project 'project-a' (RuntimeError)."
    )
