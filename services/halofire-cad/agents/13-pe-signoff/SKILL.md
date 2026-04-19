---
name: halofire-pe-signoff
description: Licensed Professional Engineer review workflow. Only PE-approved designs lose the NOT-FOR-CONSTRUCTION watermark and can be submitted to an AHJ.
inputs: [Design, PE identity + license, decision, notes]
outputs: [PeSignature + updated Design.status]
model: human-in-the-loop (no LLM — must be a real licensed PE)
---

# PE Sign-off Agent (Phase H scaffold)

## Purpose

Gate between Internal Alpha / Beta output and anything that says
"submittal-grade". Per AGENTIC_RULES §13, NFPA 13 deliverables cannot
claim AHJ-readiness without a named PE signature + recorded license.
This module enforces that gate.

## Workflow

```
DESIGN.status = internal-alpha    ← default from orchestrator
     │
     ▼ estimator requests PE review
DESIGN.status = pending-pe-review
     │
     ▼ PE opens design in reviewer UI, audits violations + calc
     │   + verifies hazards + sees all manifest.warnings
     │
     ▼ PE decides
     ├─ approved    → PeSignature written, status = pe-reviewed
     │                     watermark removed, submittal allowed
     ├─ conditional → PeSignature with conditional_items list,
     │                     status = pe-reviewed BUT watermark stays
     │                     until conditions are addressed
     └─ rejected    → PeSignature with review_notes,
                           status = pe-rejected, back to estimator
```

## Design hash

Every signature binds to a specific design_hash_sha256 of the
canonical `design.json`. If anyone edits the design after sign-off,
the hash check fails and the status is auto-downgraded to
`pending-pe-review`. Zero "quiet edits after signature" attack
surface.

## Not implemented in this session

- Reviewer UI (separate Next.js route `/pe/review/[project]` —
  future work once a licensed PE partner is on board)
- Crypto-stronger signatures (currently HMAC-SHA256 over the design
  hash; real deploy uses WebAuthn or a hardware token)
- License validation against NCEES database (manual for now)

## Contract

```python
def request_review(design: Design) -> Design
def sign(design: Design, signature: PeSignature) -> Design
def verify_signature(design: Design, signature: PeSignature) -> bool
def watermark_required(design: Design) -> bool
```

See `agent.py` for the Alpha implementation. Call path: orchestrator
emits design with `status="internal-alpha"`; estimator presses
"Request PE Review" → `request_review`; PE reviews + signs →
`sign(design, pe_signature)`.

## Honesty

Until a licensed PE signs, `watermark_required(design)` returns True.
Every drafter / proposal / submittal renderer consults this function
before removing the banner. No back-door.
