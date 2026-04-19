"""Phase B.7 — golden fixture regression for intake.

Verifies the L1 vector intake produces stable output against the
frozen snapshot in tests/fixtures/intake/fire-rfis-page0.json.
Drift beyond the tolerance band fails the test. Per AGENTIC_RULES
§5.4, golden fixtures are part of the public API and update in the
same commit as the intentional behavior change.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parent.parent
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_intake_golden", ROOT / "agents" / "00-intake" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
INTAKE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(INTAKE)


FIXTURE_PDF = (
    REPO / "apps" / "editor" / "public" / "projects"
    / "1881-cooperative" / "fire-rfis.pdf"
)
GOLDEN = ROOT / "tests" / "fixtures" / "intake" / "fire-rfis-page0.json"


@pytest.mark.skipif(
    not FIXTURE_PDF.exists(),
    reason="fixture PDF missing — ensure 1881 bid docs are in place",
)
@pytest.mark.skipif(not GOLDEN.exists(), reason="golden not generated")
def test_fire_rfis_page0_matches_golden() -> None:
    result = INTAKE.intake_pdf_page(str(FIXTURE_PDF), 0)
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert result.schema_version == golden["schema_version"], (
        "schema version drifted without golden update"
    )
    assert result.page_w_pt == golden["page_w_pt"]
    assert result.page_h_pt == golden["page_h_pt"]
    assert result.scale_ft_per_pt == golden["scale_ft_per_pt"]
    # Wall count allowed within a tolerance band (pdfplumber
    # occasionally adjusts stroke-width rounding across point releases)
    assert golden["wall_count_gte"] <= result.wall_count <= golden["wall_count_lte"], (
        f"wall_count {result.wall_count} outside golden band "
        f"[{golden['wall_count_gte']}, {golden['wall_count_lte']}]"
    )
    assert result.room_count == golden["room_count"]
    assert (len(result.warnings) == 0) == golden["warnings_empty"]
