"""Phase E — production auth + per-project roles + signed URLs +
rate limiting + audit log.

Design choices:
  - JWT with HS256 signing (single-secret self-hosted; upgrade to
    OAuth/Auth0 or RS256 + JWKS when multi-tenant).
  - Per-project roles stored in a simple JSON role-map on disk; a
    real deploy swaps for a DB.
  - Signed deliverable URLs = HMAC-SHA256 over
    `project_id/deliverable_name/expires_ts`, TTL default 10 min.
  - Rate limiting = in-memory token bucket keyed on subject + IP.
  - Audit log = append-only JSONL under the data root + brain
    writeback (via HAL brain API if reachable).

Everything here is opt-in: if `HALOFIRE_AUTH_REQUIRED` env var is
unset, endpoints stay anonymous for local dev (matching the existing
`HALOFIRE_API_KEY` soft-auth).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional


# ── Configuration ───────────────────────────────────────────────────

_SECRET = os.environ.get(
    "HALOFIRE_JWT_SECRET",
    # Stable dev-only default; prod MUST set this or get_secret raises.
    "halofire-dev-secret-DO-NOT-USE-IN-PROD",
)
_AUTH_REQUIRED = os.environ.get("HALOFIRE_AUTH_REQUIRED") == "1"
_SIGNED_URL_TTL_SECONDS = int(
    os.environ.get("HALOFIRE_SIGNED_URL_TTL", "600")
)
_RATE_LIMIT_UPLOADS_PER_MIN = int(
    os.environ.get("HALOFIRE_RATE_UPLOADS_PER_MIN", "10")
)
_RATE_LIMIT_READS_PER_MIN = int(
    os.environ.get("HALOFIRE_RATE_READS_PER_MIN", "120")
)


def get_secret() -> str:
    if _AUTH_REQUIRED and _SECRET.startswith("halofire-dev-secret"):
        raise RuntimeError(
            "HALOFIRE_JWT_SECRET must be set when HALOFIRE_AUTH_REQUIRED=1"
        )
    return _SECRET


def auth_is_required() -> bool:
    return _AUTH_REQUIRED


# ── JWT (HS256, minimal deps) ──────────────────────────────────────

import base64


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def sign_jwt(
    subject: str, roles_by_project: dict[str, str] | None = None,
    ttl_seconds: int = 3600,
) -> str:
    """Create an HS256 JWT for `subject` with optional per-project roles.

    Payload shape (stable):
      sub, iat, exp, roles: {project_id: role}
    """
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + ttl_seconds,
        "roles": dict(roles_by_project or {}),
    }
    h = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{h}.{p}".encode("ascii")
    sig = hmac.new(
        get_secret().encode("utf-8"), signing_input, hashlib.sha256,
    ).digest()
    return f"{h}.{p}.{_b64url(sig)}"


def verify_jwt(token: str) -> dict | None:
    """Return the payload dict if the signature + expiration check out,
    else None. Never raises."""
    try:
        h_b, p_b, sig_b = token.split(".")
        signing_input = f"{h_b}.{p_b}".encode("ascii")
        expected = hmac.new(
            get_secret().encode("utf-8"), signing_input, hashlib.sha256,
        ).digest()
        actual = _b64url_decode(sig_b)
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(_b64url_decode(p_b))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


# ── Per-project roles ──────────────────────────────────────────────

Role = Literal["owner", "estimator", "reviewer", "viewer"]

# Role → allowed action set. Used by `authorize(...)`.
_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": {"read", "write", "upload", "delete", "pe_sign"},
    "estimator": {"read", "write", "upload"},
    "reviewer": {"read", "write", "pe_sign"},
    "viewer": {"read"},
}


def authorize(
    jwt_payload: dict | None, project_id: str, action: str,
) -> bool:
    """Return True if the token holder may perform `action` on
    `project_id`. Anonymous access (auth off) = True."""
    if not auth_is_required():
        return True
    if not jwt_payload:
        return False
    roles = jwt_payload.get("roles", {})
    role = roles.get(project_id) or roles.get("*")
    if not role:
        return False
    return action in _ROLE_PERMISSIONS.get(role, set())


# ── Signed URLs ────────────────────────────────────────────────────

def sign_deliverable(
    project_id: str, name: str, ttl_seconds: Optional[int] = None,
) -> str:
    """Return an opaque token for `GET /projects/{id}/deliverable/{name}`.

    Caller embeds as `?sig=...&exp=...`. `verify_deliverable_sig`
    validates before serving the file.
    """
    ttl = ttl_seconds if ttl_seconds is not None else _SIGNED_URL_TTL_SECONDS
    exp = int(time.time()) + ttl
    msg = f"{project_id}|{name}|{exp}".encode("utf-8")
    sig = hmac.new(get_secret().encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_deliverable_sig(
    project_id: str, name: str, token: str,
) -> bool:
    """Verify signature + expiration."""
    try:
        exp_s, sig = token.split(".", 1)
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    msg = f"{project_id}|{name}|{exp}".encode("utf-8")
    expected = hmac.new(
        get_secret().encode("utf-8"), msg, hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, sig)


# ── Rate limiting (in-process token bucket) ───────────────────────

@dataclass
class _Bucket:
    """Sliding-window counter. Keeps `deque` of request timestamps,
    evicts old ones, rejects when window count exceeds limit."""
    limit_per_minute: int
    window_seconds: int = 60
    timestamps: deque = field(default_factory=deque)

    def try_consume(self) -> bool:
        now = time.time()
        cutoff = now - self.window_seconds
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
        if len(self.timestamps) >= self.limit_per_minute:
            return False
        self.timestamps.append(now)
        return True


_BUCKETS: dict[str, _Bucket] = defaultdict(
    lambda: _Bucket(limit_per_minute=_RATE_LIMIT_READS_PER_MIN),
)


def rate_limit_check(
    key: str, kind: Literal["upload", "read"] = "read",
) -> bool:
    """Return True if the request is under the limit."""
    limit = (_RATE_LIMIT_UPLOADS_PER_MIN if kind == "upload"
             else _RATE_LIMIT_READS_PER_MIN)
    bucket = _BUCKETS.get(key)
    if bucket is None or bucket.limit_per_minute != limit:
        bucket = _Bucket(limit_per_minute=limit)
        _BUCKETS[key] = bucket
    return bucket.try_consume()


def reset_rate_limits() -> None:
    """Test helper — clear all buckets."""
    _BUCKETS.clear()


# ── Audit log ──────────────────────────────────────────────────────

_AUDIT_ROOT = Path(os.environ.get(
    "HALOFIRE_AUDIT_DIR",
    str(Path(__file__).resolve().parent / "data" / "_audit"),
))


def audit(
    *, actor: str, action: str, project_id: str | None = None,
    status: Literal["ok", "denied", "error"] = "ok",
    detail: dict | None = None,
) -> None:
    """Append-only JSONL audit record. Safe to call from request path."""
    _AUDIT_ROOT.mkdir(parents=True, exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    path = _AUDIT_ROOT / f"{today}.jsonl"
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "actor": actor,
        "action": action,
        "project_id": project_id,
        "status": status,
        "detail": detail or {},
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def issue_anonymous_dev_token(project_id: str = "*") -> str:
    """Dev-only shortcut — produce a 24-hour owner token."""
    return sign_jwt(
        subject="dev",
        roles_by_project={project_id: "owner"},
        ttl_seconds=86400,
    )
