"""V2 Phase 1.3 — sheet-ID page-type filter.

Verifies `_candidate_pages` only keeps A-1XX floor-plan-series pages
and rejects covers, elevations, sections, schedules.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_intake", ROOT / "agents" / "00-intake" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
INTAKE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(INTAKE)


class _FakePage:
    def __init__(self, sheet_no: str, width: float = 612, height: float = 792):
        self.width = width
        self.height = height
        # Place sheet-no text in the bottom-right quadrant where the
        # title-block filter expects it.
        self.chars = [
            {"text": ch, "x0": width * 0.80 + i * 3,
             "top": height * 0.90, "size": 10}
            for i, ch in enumerate(sheet_no)
        ]


class _FakePdf:
    def __init__(self, sheets: list[str]):
        self.pages = [_FakePage(s) for s in sheets]
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _patch_pdf(sheets: list[str]):
    return patch.object(
        INTAKE.pdfplumber, "open", lambda _p: _FakePdf(sheets),
    )


def test_candidate_pages_keeps_a_1xx_only() -> None:
    # Typical 1881 set: 7 prefix pages then 7 A-1XX floor plans.
    sheets = [
        "G-001", "A-000", "A-002",       # cover / general
        "A-201", "A-202",                # elevations
        "A-301", "A-302",                # sections
        "A-101", "A-102", "A-103",       # floor plans
        "A-104", "A-105", "A-106", "A-107",
    ]
    with _patch_pdf(sheets):
        kept = INTAKE._candidate_pages("fake.pdf", len(sheets), hard_cap=14)
    # Kept indices must map to the A-1XX pages only.
    assert kept == [7, 8, 9, 10, 11, 12, 13]


def test_candidate_pages_rejects_schedules_and_details() -> None:
    sheets = ["A-101", "A-401", "A-801", "A-102"]
    with _patch_pdf(sheets):
        kept = INTAKE._candidate_pages("fake.pdf", len(sheets), hard_cap=14)
    # A-401 (detail) and A-801 (schedule) must be filtered out.
    assert kept == [0, 3]


def test_candidate_pages_keeps_mep_plans() -> None:
    # MEP plans (M/P/E/FP series) are legitimate level sources.
    sheets = ["FP-101", "M-101", "P-101", "E-101", "S-101", "A-201"]
    with _patch_pdf(sheets):
        kept = INTAKE._candidate_pages("fake.pdf", len(sheets), hard_cap=14)
    # FP/M/P/E keep; S (structural) and A-201 (elevation) skip.
    assert kept == [0, 1, 2, 3]


def test_candidate_pages_falls_back_when_no_text_layer() -> None:
    # Empty chars → no sheet numbers detectable → fall back to range().
    class _BlankPage(_FakePage):
        def __init__(self):
            super().__init__("")
            self.chars = []
    class _BlankPdf:
        def __init__(self, n: int): self.pages = [_BlankPage() for _ in range(n)]
        def __enter__(self): return self
        def __exit__(self, *a): return False
    with patch.object(INTAKE.pdfplumber, "open", lambda _p: _BlankPdf(10)):
        kept = INTAKE._candidate_pages("scan.pdf", 10, hard_cap=5)
    # No classifications made → legacy range() fallback.
    assert kept == list(range(5))


def test_candidate_pages_respects_hard_cap() -> None:
    sheets = [f"A-10{i}" for i in range(9)]  # 9 floor plans
    with _patch_pdf(sheets):
        kept = INTAKE._candidate_pages("fake.pdf", len(sheets), hard_cap=4)
    # Hard cap = 4 — take first 4 A-1XX pages.
    assert kept == [0, 1, 2, 3]
