# HaloFire Build Log

## 2026-06-04 - Workbench replay smoke follow-through

- Added a Workbench one-click action on replay-scoped `sam31_actual_value_replacement` rows to save HaloFire `openclaw_sam31_section_to_artifacts_consumer_intake_smoke` evidence directly from the replay replacement.
- Preserved visible `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, source refs, and `claim_gate_effect: no_claims_cleared` in the Workbench row/status metadata and follow-up/sprinkler packet links.
- Made the replay replacement scaffold carry employee-reviewed room polygons into SAM31 sections, object hypotheses, LLM observations, vector overlays, and internal-alpha 3D model candidates before saving the replacement.
- Verified red-to-green with `npx vitest run tests/workbench-room-boundary-floor-plan-override-browser-smoke.test.js --reporter=verbose` and adjacent coverage with `npx vitest run tests/workbench-sam31-consumer-intake-smoke-browser.test.js --reporter=verbose`. This is `NO_FORMALIZABLE_CLAIM`; it is UI/provenance/packet routing, not approval evidence.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-03 - Settings floor-plan override action download fix

- Fixed the Settings room-boundary override download lane in [`settings.html`](C:/Users/dalla/OneDrive/Documents/HaloFire/settings.html) to normalize stored local `/api/...` hrefs before calling the page API helper, matching the resolved-gate audit path and preventing local `/api/api/...` requests.
- Filled the resolver-queue contract gap in [`src/api/server.js`](C:/Users/dalla/OneDrive/Documents/HaloFire/src/api/server.js) by adding `floor_plan_override_action.download_href`, so Settings can fetch the exact `halofire.room_boundary_floor_plan_override_action_packet.v1` packet for the selected room-boundary review row.
- Added focused coverage in [`tests/settings-signed-reviewer-browser-smoke.test.js`](C:/Users/dalla/OneDrive/Documents/HaloFire/tests/settings-signed-reviewer-browser-smoke.test.js) and [`tests/pdf-inspect-api.test.js`](C:/Users/dalla/OneDrive/Documents/HaloFire/tests/pdf-inspect-api.test.js) proving the Settings row renders, downloads the override packet, and exposes the source-linked packet href through the resolver queue.
- Verified with `npx vitest run tests/settings-evidence-wizard-static.test.js tests/settings-signed-reviewer-browser-smoke.test.js tests/pdf-inspect-api.test.js`, `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`, and `git diff --check`. `NO_FORMALIZABLE_CLAIM`: this slice is UI/API packet routing, not a theorem-shaped invariant.
- Still blocked: AutoSprink parity, AHJ approval beyond explicit signed evidence for one gate lane, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-03 - Settings resolved-gate audit download fix

- Fixed the Settings resolved signed-reviewer audit download path to normalize stored `/api/...` hrefs before calling the local API helper, so the page no longer requests a broken `/api/api/...` route when downloading cleared-gate audit packets.
- Added a focused Playwright browser smoke that resolves a signed AHJ evidence row, opens [`settings.html`](C:/Users/dalla/OneDrive/Documents/HaloFire/settings.html), proves the resolved-gate row renders, and verifies the audit-packet download status updates with `claim_gate_effect gate_cleared_after_explicit_signed_validation`.
- Verified with `npx vitest run tests/settings-evidence-wizard-static.test.js tests/settings-signed-reviewer-browser-smoke.test.js`, `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`, and `git diff --check`.
- Still blocked: AutoSprink parity, AHJ approval beyond explicit signed evidence for one gate lane, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-03 - Replay-scoped SAM31 queue isolation

- Changed `openclaw.sam31.actual_value_resolver_queue` and readback packets so `sourceReplayEvidenceId` filters replay replacement queue items, exposes `source_replay_evidence_filter_id`, and preserves the same scope in filtered replacement-readback download hrefs.
- Added a focused 1881 replay test that records two replay replacements and proves the LandScout queue readback returns only the requested replay evidence row while keeping `claim_gate_effect: no_claims_cleared`.
- Verified with the focused 1881 API replay test, adjacent SAM31 queue/readback API tests, the room-boundary Workbench browser smoke, `node --check`, `git diff --check`, no `.only` scan, `verify_agentic_rules.py`, and GX10 prover health. This slice has `NO_FORMALIZABLE_CLAIM` because it is route/filter/readback plumbing.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, and survey-grade claims.

## 2026-06-04 - Replay replacement smoke provenance

- Changed replay-scoped `sam31_actual_value_replacement` intake so employee replacement values with SAM31 sections, object hypotheses, vector overlays, and 3D model candidates produce the same `openclaw.sam31.section_to_artifacts_contract.v1` summary as normal replacements.
- Exposed replay replacement section-to-artifacts handoffs in the resolver queue and allowed HaloFire consumer-intake smoke rows to be saved from replay replacement evidence.
- Carried `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, source refs, and `claim_gate_effect: no_claims_cleared` through saved smoke evidence, HaloFire follow-up packets/reviews, resolver rows, and sprinkler review packets.
- Verified red-to-green with the focused 1881 replay test. This remains `NO_FORMALIZABLE_CLAIM`; the slice only preserves provenance and queue/packet routing for internal-alpha review.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.
