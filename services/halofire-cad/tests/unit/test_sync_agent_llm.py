"""Integration-shaped test for the Gemma LLM path of sync_agent.

We don't require Ollama to be running — we patch urllib.request.urlopen
to return a canned JSON response. This verifies the contract we hold
with the LLM (prompt → JSON shape → PriceUpdate dispatch) without
needing the daemon.
"""
from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from pricing.db import SuppliesDB  # noqa: E402

_SA_SPEC = importlib.util.spec_from_file_location(
    "sync_agent_llm", _ROOT / "pricing" / "sync_agent.py",
)
assert _SA_SPEC is not None and _SA_SPEC.loader is not None
SA = importlib.util.module_from_spec(_SA_SPEC)
_SA_SPEC.loader.exec_module(SA)


@pytest.fixture
def db(tmp_path: Path) -> SuppliesDB:
    d = SuppliesDB(tmp_path / "supplies.duckdb")
    d.upsert_supplier("victaulic", "Victaulic")
    # Seed the two SKUs the fake Gemma will talk about.
    for sku, cat in (
        ("VIC-ELBOW_90-2in", "fitting_elbow_90"),
        ("VIC-TEE_EQ-2in", "fitting_tee_equal"),
    ):
        d.upsert_part({
            "sku": sku, "name": sku, "category": cat,
            "mounting": "pipe_inline", "manufacturer": "Victaulic",
            "supplier_id": "victaulic", "model": sku,
            "dim_l_cm": None, "dim_d_cm": None, "dim_h_cm": None,
            "pipe_size_in": 2.0, "k_factor": None,
            "temp_rating_f": None, "response": None,
            "connection": "grooved", "finish": "Black iron",
            "nfpa_paint_hex": None, "open_source_glb": False,
            "discontinued": False, "notes": "",
        })
    yield d
    d.close()


def _fake_ollama_response(payload: dict) -> io.BytesIO:
    body = json.dumps({"response": json.dumps(payload)}).encode("utf-8")
    r = io.BytesIO(body)
    # urlopen returns a context manager; mock supports .__enter__/__exit__
    return r


class _FakeCM:
    def __init__(self, buf: io.BytesIO) -> None:
        self._buf = buf

    def __enter__(self):
        return self._buf

    def __exit__(self, *args):  # noqa: ANN001
        return False


def test_extract_updates_parses_canned_gemma_response() -> None:
    """extract_updates_from_text — strict JSON, ignore bad rows."""
    fake_payload = {
        "updates": [
            {"sku": "VIC-ELBOW_90-2in", "unit_cost_usd": 6.15,
             "unit": "ea", "confidence": 0.92},
            {"sku": "VIC-TEE_EQ-2in", "unit_cost_usd": 9.20,
             "unit": "ea", "confidence": 0.85},
            # A malformed row the agent should skip silently
            {"sku": "", "unit_cost_usd": 100, "unit": "ea"},
        ],
    }
    with patch.object(SA.urllib.request, "urlopen",
                      return_value=_FakeCM(_fake_ollama_response(fake_payload))):
        updates = SA.extract_updates_from_text(
            "victaulic", "raw pdf text", source_sha256="abcdef",
            model="gemma3:4b",
        )
    assert len(updates) == 2
    skus = [u.sku for u in updates]
    assert "VIC-ELBOW_90-2in" in skus
    assert "VIC-TEE_EQ-2in" in skus
    # Source string carries supplier + sha prefix
    for u in updates:
        assert u.source.startswith("sync_agent:victaulic:")
        assert u.source_doc_sha256 == "abcdef"


def test_extract_updates_rejects_non_gemma_model() -> None:
    with pytest.raises(ValueError, match="Gemma-only"):
        SA.extract_updates_from_text(
            "victaulic", "text", "sha", model="qwen2.5:7b",
        )


def test_extract_updates_survives_prose_wrapped_json() -> None:
    """Gemma sometimes prefixes 'Here is the JSON:' before the body.
    The agent must locate the first '{' and retry."""
    fake_payload = {
        "updates": [
            {"sku": "VIC-ELBOW_90-2in", "unit_cost_usd": 6.15,
             "unit": "ea", "confidence": 0.9},
        ],
    }
    wrapped = (
        "Sure! Here's the extraction:\n\n"
        + json.dumps(fake_payload)
        + "\n\nLet me know if anything else."
    )
    raw = io.BytesIO(json.dumps({"response": wrapped}).encode("utf-8"))
    with patch.object(SA.urllib.request, "urlopen",
                      return_value=_FakeCM(raw)):
        updates = SA.extract_updates_from_text(
            "victaulic", "text", "sha", model="gemma3:4b",
        )
    assert len(updates) == 1
    assert updates[0].sku == "VIC-ELBOW_90-2in"


def test_extract_updates_returns_empty_on_empty_response() -> None:
    raw = io.BytesIO(json.dumps({"response": ""}).encode("utf-8"))
    with patch.object(SA.urllib.request, "urlopen",
                      return_value=_FakeCM(raw)):
        updates = SA.extract_updates_from_text(
            "victaulic", "text", "sha", model="gemma3:4b",
        )
    assert updates == []


def test_run_sync_pdf_path_accepts_llm_updates(
    tmp_path: Path, db: SuppliesDB, monkeypatch,
) -> None:
    """End-to-end: PDF path reads text → Gemma → db.apply_updates.

    Patches _read_pdf_text + the LLM call so neither pdfplumber nor
    Ollama is required. Verifies commits land in the DB."""
    pdf = tmp_path / "vic.pdf"
    pdf.write_bytes(b"fake pdf content")

    monkeypatch.setattr(SA, "_read_pdf_text",
                        lambda _p: "Victaulic price list — pretend text")

    fake_payload = {
        "updates": [
            {"sku": "VIC-ELBOW_90-2in", "unit_cost_usd": 6.15,
             "unit": "ea", "confidence": 0.9},
            {"sku": "VIC-TEE_EQ-2in", "unit_cost_usd": 9.20,
             "unit": "ea", "confidence": 0.9},
        ],
    }

    import contextlib

    @contextlib.contextmanager
    def _open_db_test(*_a, **_kw):
        yield db

    monkeypatch.setattr(SA, "open_db", _open_db_test)

    with patch.object(SA.urllib.request, "urlopen",
                      return_value=_FakeCM(_fake_ollama_response(fake_payload))):
        res = SA.run_sync(
            supplier_id="victaulic", source_path=pdf,
            model="gemma3:4b",
        )

    assert res["accepted"] == 2
    # Check DB holds the price
    row = db.price_for("VIC-ELBOW_90-2in")
    assert row is not None
    assert row.unit_cost_usd == 6.15
    assert row.confidence == pytest.approx(0.9)


def test_run_sync_refuses_non_gemma_override(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"pdf")
    with pytest.raises(ValueError, match="Gemma-only"):
        SA.run_sync(
            supplier_id="victaulic", source_path=pdf, model="qwen2.5:7b",
        )


def test_run_sync_unsupported_extension_raises(tmp_path: Path) -> None:
    bad = tmp_path / "x.docx"
    bad.write_bytes(b"noop")
    with pytest.raises(ValueError, match="unsupported source extension"):
        SA.run_sync(
            supplier_id="victaulic", source_path=bad, model="gemma3:4b",
        )
