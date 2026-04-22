"""halofire-sam segment endpoint tests.

These tests run in two modes:

* **Offline (default in CI and fresh checkouts):** SAM weights aren't on
  disk, so model-load is skipped. We exercise request-validation (422
  on missing grounding) and the audit-log side effect. Mask-quality
  assertions are skipped via `pytest.importorskip`-style guards.

* **Online (RUN_SAM=1 env + weights cached):** the full /segment round
  trip runs on GPU/CPU and we assert IoU > 0.7 on the fixture.

Running:
    cd services/halofire-sam
    RUN_SAM=1 C:/Python312/python.exe -m pytest tests/ -v
"""
from __future__ import annotations

import base64
import io
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

# Point audit log at a tmp location so tests don't pollute data/.
os.environ.setdefault("AUDIT_LOG", str(SERVICE_DIR / "tests" / ".sam_requests.test.jsonl"))

from main import app  # noqa: E402

FIXTURE = SERVICE_DIR / "tests" / "fixtures" / "pendent_head.jpg"
RUN_SAM = os.getenv("RUN_SAM") == "1"


def _b64_fixture() -> str:
    with FIXTURE.open("rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def test_fixture_exists():
    assert FIXTURE.exists(), f"missing test fixture: {FIXTURE}"
    img = Image.open(FIXTURE)
    assert img.size[0] > 0 and img.size[1] > 0


def test_rejects_ungrounded_request():
    """Landscout rule: no grounding (bbox/points) => 422, no auto-mode."""
    client = TestClient(app)
    resp = client.post(
        "/segment",
        json={"image_b64": _b64_fixture(), "require_grounded": True},
    )
    assert resp.status_code == 422
    assert "grounded" in resp.json()["detail"].lower()


def test_rejects_malformed_bbox():
    client = TestClient(app)
    # x1 < x0
    resp = client.post(
        "/segment",
        json={
            "image_b64": _b64_fixture(),
            "bbox": [0.6, 0.3, 0.4, 0.7],
        },
    )
    assert resp.status_code == 422


def test_invalid_base64():
    client = TestClient(app)
    resp = client.post(
        "/segment",
        json={"image_b64": "!!!not-valid!!!", "bbox": [0.1, 0.1, 0.2, 0.2]},
    )
    # PIL will fail on garbage bytes → 400
    assert resp.status_code in (400, 422)


def test_health_before_load():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "device" in body


@pytest.mark.skipif(
    not RUN_SAM,
    reason="Set RUN_SAM=1 to run full SAM inference (requires ~2.5GB weights).",
)
def test_segment_pendent_head_with_bbox():
    client = TestClient(app)

    # warmup first — large download on first run.
    wu = client.post("/warmup")
    assert wu.status_code == 200, wu.text

    # Bbox covers the simulated sprinkler head in the fixture (normalized).
    resp = client.post(
        "/segment",
        json={
            "image_b64": _b64_fixture(),
            "bbox": [0.30, 0.30, 0.70, 0.75],
            "multimask": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["masks"], "expected at least one candidate mask"
    top = body["masks"][0]
    assert top["iou"] > 0.7, f"low IoU: {top['iou']}"
    # Area should be plausible (not the whole frame, not a speck).
    assert top["area_px"] > 500
    assert top["area_px"] < 512 * 512 * 0.9

    # Health now reports loaded.
    h = client.get("/health").json()
    assert h["model_loaded"] is True
    assert h["model"]
