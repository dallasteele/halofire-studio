"""halofire PE sign-off agent — Phase H.

Implements the AGENTIC_RULES §13 hard gate: no "submittal-grade"
language without a named licensed Professional Engineer signature.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design, PeSignature  # noqa: E402
from cad.logging import get_logger  # noqa: E402

log = get_logger("pe_signoff")


def design_hash(design: Design) -> str:
    """Stable SHA-256 of the canonical design.

    Excludes `metadata.pe_signatures` and `metadata.status` from the
    hash (those change with every signature and must not feed back
    into the hash, or every signature would invalidate itself).
    """
    data = design.model_dump()
    meta = dict(data.get("metadata") or {})
    meta.pop("pe_signatures", None)
    meta.pop("status", None)
    data["metadata"] = meta
    payload = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def request_review(design: Design) -> Design:
    """Transition internal-alpha → pending-pe-review."""
    log.info(
        "hf.pe.request_review",
        extra={"project_id": design.project.id},
    )
    design.metadata = {**design.metadata, "status": "pending-pe-review"}
    return design


def sign(design: Design, signature: PeSignature) -> Design:
    """Record a PE signature against the current design state.

    Mutates `design.metadata.status` per the signature decision.
    Overwrites `signature.design_hash_sha256` with the current hash.
    """
    signature.design_hash_sha256 = design_hash(design)
    if not signature.signed_at:
        signature.signed_at = datetime.now(tz=timezone.utc).isoformat()

    if signature.decision == "approved":
        status = "pe-reviewed"
    elif signature.decision == "conditional":
        status = "pe-reviewed"
    elif signature.decision == "rejected":
        status = "pe-rejected"
    else:
        status = "pending-pe-review"

    existing_sigs = design.metadata.get("pe_signatures", [])
    existing_sigs.append(signature.model_dump())
    design.metadata = {
        **design.metadata,
        "status": status,
        "pe_signatures": existing_sigs,
    }
    log.info(
        "hf.pe.signed",
        extra={
            "project_id": design.project.id,
            "pe": signature.pe_name,
            "decision": signature.decision,
            "status": status,
        },
    )
    return design


def verify_signature(design: Design, signature: PeSignature) -> bool:
    """Check that `signature` is still valid against the current design.

    If the design was edited after sign-off, the stored hash will
    mismatch and this returns False. Caller's responsibility to then
    downgrade status back to pending-pe-review.
    """
    if not signature.design_hash_sha256:
        return False
    current = design_hash(design)
    return current == signature.design_hash_sha256


def watermark_required(design: Design) -> bool:
    """Return True if the NOT-FOR-CONSTRUCTION watermark must stay.

    Per §13: the ONLY path that removes the watermark is an approved
    (unconditional) PE signature whose hash still matches.
    """
    status = design.metadata.get("status", "internal-alpha")
    if status != "pe-reviewed":
        return True
    sigs = design.metadata.get("pe_signatures", [])
    if not sigs:
        return True
    # Find the latest approval
    for sig_dict in reversed(sigs):
        if sig_dict.get("decision") == "approved":
            try:
                sig = PeSignature.model_validate(sig_dict)
            except Exception:
                continue
            if verify_signature(design, sig):
                return False  # watermark removed
    return True  # conditional or rejected or no valid sig


def latest_signature(design: Design) -> PeSignature | None:
    """Return the most recent PE signature, or None."""
    sigs = design.metadata.get("pe_signatures", [])
    if not sigs:
        return None
    try:
        return PeSignature.model_validate(sigs[-1])
    except Exception:
        return None
