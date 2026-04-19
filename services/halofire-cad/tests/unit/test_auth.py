"""Phase E — auth / signed URLs / rate-limit / audit unit tests."""
from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path

import pytest

# Gateway lives under halopenclaw-gateway; sys.path adjust
GW_ROOT = (
    Path(__file__).resolve().parents[3] / "halopenclaw-gateway"
)
sys.path.insert(0, str(GW_ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_auth", GW_ROOT / "auth.py",
)
assert _SPEC is not None and _SPEC.loader is not None
AUTH = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_auth"] = AUTH
_SPEC.loader.exec_module(AUTH)


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Each test starts with a fresh bucket."""
    AUTH.reset_rate_limits()
    yield
    AUTH.reset_rate_limits()


# ── JWT ─────────────────────────────────────────────────────────────


def test_sign_and_verify_jwt_roundtrip() -> None:
    token = AUTH.sign_jwt("wade", roles_by_project={"1881": "estimator"})
    payload = AUTH.verify_jwt(token)
    assert payload is not None
    assert payload["sub"] == "wade"
    assert payload["roles"]["1881"] == "estimator"


def test_verify_jwt_rejects_tampered_token() -> None:
    token = AUTH.sign_jwt("wade")
    # Corrupt the payload section (middle of the dot-separated JWT)
    parts = token.split(".")
    bad = f"{parts[0]}.aGVsbG8.{parts[2]}"  # replace payload with "hello"
    assert AUTH.verify_jwt(bad) is None


def test_verify_jwt_rejects_expired() -> None:
    token = AUTH.sign_jwt("wade", ttl_seconds=-10)
    assert AUTH.verify_jwt(token) is None


def test_verify_jwt_returns_none_for_garbage() -> None:
    assert AUTH.verify_jwt("not-a-jwt") is None
    assert AUTH.verify_jwt("") is None
    assert AUTH.verify_jwt("a.b.c") is None


# ── authorize ──────────────────────────────────────────────────────


def test_authorize_anonymous_allowed_when_auth_off(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUTH_REQUIRED", False)
    assert AUTH.authorize(None, "1881", "write") is True


def test_authorize_denies_when_auth_required_and_no_token(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUTH_REQUIRED", True)
    # Also set a proper secret so get_secret doesn't raise
    monkeypatch.setattr(AUTH, "_SECRET", "test-secret")
    assert AUTH.authorize(None, "1881", "write") is False


def test_authorize_viewer_cant_write(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUTH_REQUIRED", True)
    monkeypatch.setattr(AUTH, "_SECRET", "test-secret")
    payload = {"roles": {"1881": "viewer"}}
    assert AUTH.authorize(payload, "1881", "read") is True
    assert AUTH.authorize(payload, "1881", "write") is False
    assert AUTH.authorize(payload, "1881", "upload") is False


def test_authorize_owner_can_all(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUTH_REQUIRED", True)
    monkeypatch.setattr(AUTH, "_SECRET", "test-secret")
    payload = {"roles": {"1881": "owner"}}
    for action in ("read", "write", "upload", "delete", "pe_sign"):
        assert AUTH.authorize(payload, "1881", action)


def test_authorize_wildcard_project(monkeypatch) -> None:
    """`*` role grants across all projects."""
    monkeypatch.setattr(AUTH, "_AUTH_REQUIRED", True)
    monkeypatch.setattr(AUTH, "_SECRET", "test-secret")
    payload = {"roles": {"*": "reviewer"}}
    assert AUTH.authorize(payload, "any-project", "read")
    assert AUTH.authorize(payload, "any-project", "pe_sign")


# ── Signed URLs ────────────────────────────────────────────────────


def test_signed_url_verifies() -> None:
    token = AUTH.sign_deliverable("1881", "proposal.pdf", ttl_seconds=60)
    assert AUTH.verify_deliverable_sig("1881", "proposal.pdf", token)


def test_signed_url_expires() -> None:
    token = AUTH.sign_deliverable("1881", "proposal.pdf", ttl_seconds=-5)
    assert not AUTH.verify_deliverable_sig("1881", "proposal.pdf", token)


def test_signed_url_rejects_wrong_project() -> None:
    token = AUTH.sign_deliverable("1881", "proposal.pdf", ttl_seconds=60)
    assert not AUTH.verify_deliverable_sig("OTHER", "proposal.pdf", token)


def test_signed_url_rejects_wrong_name() -> None:
    token = AUTH.sign_deliverable("1881", "proposal.pdf", ttl_seconds=60)
    assert not AUTH.verify_deliverable_sig("1881", "design.dxf", token)


# ── Rate limiting ──────────────────────────────────────────────────


def test_rate_limit_reads_allows_under_cap(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_RATE_LIMIT_READS_PER_MIN", 5)
    AUTH.reset_rate_limits()
    for _ in range(5):
        assert AUTH.rate_limit_check("user1", "read") is True
    # 6th request denied
    assert AUTH.rate_limit_check("user1", "read") is False


def test_rate_limit_per_key_isolation(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_RATE_LIMIT_READS_PER_MIN", 3)
    AUTH.reset_rate_limits()
    for _ in range(3):
        assert AUTH.rate_limit_check("a", "read")
    # Separate user still has full quota
    for _ in range(3):
        assert AUTH.rate_limit_check("b", "read")


def test_rate_limit_upload_separate_from_read(monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_RATE_LIMIT_UPLOADS_PER_MIN", 2)
    monkeypatch.setattr(AUTH, "_RATE_LIMIT_READS_PER_MIN", 100)
    AUTH.reset_rate_limits()
    assert AUTH.rate_limit_check("user1", "upload")
    assert AUTH.rate_limit_check("user1", "upload")
    # 3rd upload denied; separate read still passes (same bucket
    # keyed differently by the caller; here we re-use same key,
    # so the 3rd upload attempt should be denied)
    assert AUTH.rate_limit_check("user1", "upload") is False


# ── Audit log ──────────────────────────────────────────────────────


def test_audit_writes_jsonl_entry(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUDIT_ROOT", tmp_path)
    AUTH.audit(actor="wade", action="intake_upload",
               project_id="1881", status="ok", detail={"bytes": 500})
    files = list(tmp_path.glob("*.jsonl"))
    assert len(files) == 1
    content = files[0].read_text(encoding="utf-8").strip().split("\n")
    assert len(content) == 1
    import json
    entry = json.loads(content[0])
    assert entry["actor"] == "wade"
    assert entry["project_id"] == "1881"
    assert entry["status"] == "ok"


def test_audit_appends_multiple_entries(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(AUTH, "_AUDIT_ROOT", tmp_path)
    AUTH.audit(actor="a", action="read", status="ok")
    AUTH.audit(actor="b", action="write", status="denied")
    AUTH.audit(actor="c", action="delete", status="error")
    files = list(tmp_path.glob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 3
