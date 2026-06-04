# HaloFire Build Log

## 2026-06-03 - Replay-scoped SAM31 queue isolation

- Changed `openclaw.sam31.actual_value_resolver_queue` and readback packets so `sourceReplayEvidenceId` filters replay replacement queue items, exposes `source_replay_evidence_filter_id`, and preserves the same scope in filtered replacement-readback download hrefs.
- Added a focused 1881 replay test that records two replay replacements and proves the LandScout queue readback returns only the requested replay evidence row while keeping `claim_gate_effect: no_claims_cleared`.
- Verified with the focused 1881 API replay test, adjacent SAM31 queue/readback API tests, the room-boundary Workbench browser smoke, `node --check`, `git diff --check`, no `.only` scan, `verify_agentic_rules.py`, and GX10 prover health. This slice has `NO_FORMALIZABLE_CLAIM` because it is route/filter/readback plumbing.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, and survey-grade claims.
