"""Typed, fail-closed head-count truth lookup for the HaloFire portal.

The gateway previously imported this behavior from an external
``core.hal.halofire_v2`` package that is not part of the repository or the
canonical local runtime.  This adapter reads the repository-owned HaloFire CAD
truth database lazily.  Missing records, missing expected counts, and truth DB
failures are warnings; they never manufacture a comparison target.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal, Protocol, TypedDict


class HeadTruthRecord(Protocol):
    """Minimum sealed truth record surface consumed by this adapter."""

    project_id: str
    head_count: int | None


HeadTruthStatus = Literal[
    "match",
    "mismatch",
    "truth-unavailable",
    "truth-source-unavailable",
    "invalid-actual-count",
]


class HeadCountTruthResult(TypedDict):
    """Stable portal-facing head-count comparison result."""

    projectId: str
    truthProjectId: str | None
    expectedHeadCount: int | None
    actualHeadCount: int | None
    deltaCount: int | None
    deltaPct: float | None
    status: HeadTruthStatus
    matched: bool
    warning: str | None


_CAD_ROOT = Path(__file__).resolve().parents[1] / "halofire-cad"
_TRUTH_DB_PATH = _CAD_ROOT / "truth" / "truth.duckdb"

# These aliases are already present in the repository's 1881 seed and portal
# project IDs.  They normalize identity only; the expected value still comes
# exclusively from the sealed truth DB record.
_TRUTH_PROJECT_ALIASES = {
    "1881": "1881-cooperative",
    "cooperative-1881": "1881-cooperative",
    "1881-cooperative": "1881-cooperative",
}


def _lookup_truth_record(project_id: str) -> HeadTruthRecord | None:
    """Load one sealed record without making the truth DB a startup dependency."""

    # ``truth_for`` opens DuckDB in create mode.  Treat an absent corpus as
    # unavailable before importing it so a read path can never manufacture an
    # empty file that looks like a sealed source.
    if not _TRUTH_DB_PATH.is_file():
        return None
    if str(_CAD_ROOT) not in sys.path:
        sys.path.insert(0, str(_CAD_ROOT))
    from truth.db import truth_for

    return truth_for(project_id)


def _result(
    *,
    project_id: str,
    truth_project_id: str | None,
    expected: int | None,
    actual: int | None,
    status: HeadTruthStatus,
    warning: str | None,
) -> HeadCountTruthResult:
    delta = actual - expected if actual is not None and expected is not None else None
    delta_pct = round(delta / expected * 100, 6) if delta is not None and expected else None
    return {
        "projectId": project_id,
        "truthProjectId": truth_project_id,
        "expectedHeadCount": expected,
        "actualHeadCount": actual,
        "deltaCount": delta,
        "deltaPct": delta_pct,
        "status": status,
        "matched": status == "match",
        "warning": warning,
    }


def build_head_count_truth(project_id: str, actual_heads: int) -> HeadCountTruthResult:
    """Compare an observed count to sealed project truth without guessing.

    The lookup first tries the exact project ID, then a repository-sourced 1881
    alias when applicable.  Any missing or unusable truth state remains an
    explicit mismatch warning so the portal cannot silently imply calibration.
    """

    normalized_project_id = str(project_id or "").strip()
    if isinstance(actual_heads, bool) or not isinstance(actual_heads, int) or actual_heads < 0:
        return _result(
            project_id=normalized_project_id,
            truth_project_id=None,
            expected=None,
            actual=None,
            status="invalid-actual-count",
            warning=f"Head count truth mismatch: invalid actual head count for project '{normalized_project_id}'.",
        )

    candidates = [normalized_project_id]
    alias = _TRUTH_PROJECT_ALIASES.get(normalized_project_id.lower())
    if alias and alias not in candidates:
        candidates.append(alias)
    try:
        record = next(
            (candidate_record for candidate in candidates if (candidate_record := _lookup_truth_record(candidate)) is not None),
            None,
        )
    except Exception as exc:  # typed fail-closed boundary for an optional truth store
        return _result(
            project_id=normalized_project_id,
            truth_project_id=None,
            expected=None,
            actual=actual_heads,
            status="truth-source-unavailable",
            warning=(
                f"Head count truth mismatch: sealed truth source unavailable for project "
                f"'{normalized_project_id}' ({type(exc).__name__})."
            ),
        )

    if record is None:
        return _result(
            project_id=normalized_project_id,
            truth_project_id=None,
            expected=None,
            actual=actual_heads,
            status="truth-unavailable",
            warning=(
                f"Head count truth mismatch: no sealed truth record for project "
                f"'{normalized_project_id}'; actual={actual_heads}."
            ),
        )
    expected = record.head_count
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        return _result(
            project_id=normalized_project_id,
            truth_project_id=record.project_id,
            expected=None,
            actual=actual_heads,
            status="truth-unavailable",
            warning=(
                f"Head count truth mismatch: sealed record '{record.project_id}' has no usable expected head count; "
                f"actual={actual_heads}."
            ),
        )
    if actual_heads == expected:
        return _result(
            project_id=normalized_project_id,
            truth_project_id=record.project_id,
            expected=expected,
            actual=actual_heads,
            status="match",
            warning=None,
        )
    return _result(
        project_id=normalized_project_id,
        truth_project_id=record.project_id,
        expected=expected,
        actual=actual_heads,
        status="mismatch",
        warning=(
            f"Head count truth mismatch for project '{normalized_project_id}': expected={expected}, "
            f"actual={actual_heads}, delta={actual_heads - expected} "
            f"(sealed truth project '{record.project_id}')."
        ),
    )


__all__ = ["HeadCountTruthResult", "build_head_count_truth"]
