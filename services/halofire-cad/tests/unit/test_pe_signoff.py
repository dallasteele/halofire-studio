"""Phase H — PE sign-off workflow tests."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_pe", ROOT / "agents" / "13-pe-signoff" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PE = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_pe"] = PE
_SPEC.loader.exec_module(PE)

from cad.schema import (  # noqa: E402
    Building, Design, PeSignature, Project,
)


@pytest.fixture
def pristine_design() -> Design:
    return Design(
        project=Project(
            id="test", name="Test", address="1 Test St",
            ahj="Test AHJ", code="NFPA 13 2022",
        ),
        building=Building(project_id="test"),
    )


def test_pristine_design_requires_watermark(pristine_design) -> None:
    assert PE.watermark_required(pristine_design)


def test_request_review_transitions_status(pristine_design) -> None:
    d = PE.request_review(pristine_design)
    assert d.metadata["status"] == "pending-pe-review"
    # Still requires watermark
    assert PE.watermark_required(d)


def test_approved_signature_removes_watermark(pristine_design) -> None:
    d = PE.request_review(pristine_design)
    sig = PeSignature(
        pe_name="Jane Doe PE",
        pe_license_number="UT-12345",
        pe_license_state="UT",
        signed_at="",
        decision="approved",
    )
    d = PE.sign(d, sig)
    assert d.metadata["status"] == "pe-reviewed"
    assert not PE.watermark_required(d), "approved design must drop watermark"


def test_conditional_signature_keeps_watermark(pristine_design) -> None:
    d = PE.request_review(pristine_design)
    sig = PeSignature(
        pe_name="Jane Doe PE",
        pe_license_number="UT-12345",
        pe_license_state="UT",
        signed_at="",
        decision="conditional",
        conditional_items=["Add riser bracing per §9.3"],
    )
    d = PE.sign(d, sig)
    # Conditional → status is pe-reviewed BUT watermark stays until
    # conditions are addressed
    assert d.metadata["status"] == "pe-reviewed"
    assert PE.watermark_required(d)


def test_rejected_signature_keeps_watermark(pristine_design) -> None:
    sig = PeSignature(
        pe_name="Jane Doe PE",
        pe_license_number="UT-12345",
        pe_license_state="UT",
        signed_at="",
        decision="rejected",
        review_notes="Demand exceeds supply on sys_1",
    )
    d = PE.sign(pristine_design, sig)
    assert d.metadata["status"] == "pe-rejected"
    assert PE.watermark_required(d)


def test_edit_after_signoff_invalidates(pristine_design) -> None:
    """If anyone edits the design post-approval, watermark returns."""
    d = PE.request_review(pristine_design)
    sig = PeSignature(
        pe_name="Jane Doe PE",
        pe_license_number="UT-12345",
        pe_license_state="UT",
        signed_at="",
        decision="approved",
    )
    d = PE.sign(d, sig)
    assert not PE.watermark_required(d)
    # Mutate the design
    d.project.address = "DIFFERENT ADDRESS"
    # Hash mismatch — watermark returns
    assert PE.watermark_required(d), (
        "design was edited post-signoff but watermark did not return"
    )


def test_latest_signature_returns_most_recent(pristine_design) -> None:
    d = PE.request_review(pristine_design)
    d = PE.sign(d, PeSignature(
        pe_name="First PE", pe_license_number="UT-1", pe_license_state="UT",
        signed_at="", decision="rejected",
    ))
    d = PE.sign(d, PeSignature(
        pe_name="Second PE", pe_license_number="UT-2", pe_license_state="UT",
        signed_at="", decision="approved",
    ))
    latest = PE.latest_signature(d)
    assert latest is not None
    assert latest.pe_name == "Second PE"
    assert latest.decision == "approved"


def test_design_hash_is_stable(pristine_design) -> None:
    h1 = PE.design_hash(pristine_design)
    h2 = PE.design_hash(pristine_design)
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex


def test_design_hash_changes_on_edit(pristine_design) -> None:
    h1 = PE.design_hash(pristine_design)
    pristine_design.project.name = "Edited"
    h2 = PE.design_hash(pristine_design)
    assert h1 != h2
