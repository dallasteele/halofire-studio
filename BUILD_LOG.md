# HaloFire Build Log

## 2026-06-04 - Replay smoke preliminary replay follow-up

- Added a Workbench one-click default preliminary replay follow-up action for replay-scoped HaloFire SAM31 consumer-intake smoke rows after the default sprinkler review decision exists.
- The action downloads `halofire.sam31_sprinkler_preliminary_replay_artifact.v1`, saves `halofire.sam31_sprinkler_preliminary_replay_followup_decision.v1`, and exposes packet queue rows for obstruction/clash or sleeve/firestop follow-up while preserving `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, `source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id`, `source_halofire_sam31_sprinkler_review_decision_evidence_id`, and `claim_gate_effect: no_claims_cleared`.
- Added Workbench evidence detail rendering for saved smoke preliminary replay follow-up rows so employees can see replay/replacement provenance and queued packet lanes before any approval upload or packet review.
- Verified red-to-green with `npx vitest run tests/workbench-room-boundary-floor-plan-override-browser-smoke.test.js --reporter=verbose`, plus adjacent `npx vitest run tests/workbench-sam31-consumer-intake-smoke-browser.test.js --reporter=verbose`, `npx vitest run tests/workbench-evidence-detail.test.js --reporter=verbose`, `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`, `git diff --check`, `.only` scan, and GX10 prover health. This is `NO_FORMALIZABLE_CLAIM`; it proves Workbench packet routing and metadata preservation, not approval evidence.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-04 - Replay smoke default sprinkler review

- Added a Workbench one-click default internal-alpha sprinkler review action for replay-scoped HaloFire SAM31 consumer-intake smoke rows after a saved follow-up review exists.
- The action saves `halofire.sam31_sprinkler_review_decision.v1`, downloads `halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1`, and preserves `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, `source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id`, the saved smoke evidence id, and `claim_gate_effect: no_claims_cleared` in Workbench status metadata.
- Surfaced the same one-click path from both saved smoke evidence rows and replay-scoped actual-value queue rows, so employees can continue the 1881 internal-alpha sprinkler review path without manually copying evidence ids.
- Verified red-to-green with `npx vitest run tests/workbench-room-boundary-floor-plan-override-browser-smoke.test.js --reporter=verbose`, plus adjacent `npx vitest run tests/workbench-sam31-consumer-intake-smoke-browser.test.js --reporter=verbose`, `npx vitest run tests/workbench-evidence-detail.test.js --reporter=verbose`, `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`, `git diff --check`, `.only` scan, and GX10 prover health. This is `NO_FORMALIZABLE_CLAIM`; it proves Workbench packet routing and metadata preservation, not approval evidence.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-04 - Workbench supplied bid-truth browser smoke

- Added a focused Playwright smoke in [`tests/workbench-supplied-bid-truth-browser-smoke.test.js`](C:/Users/dalla/OneDrive/Documents/HaloFire/tests/workbench-supplied-bid-truth-browser-smoke.test.js) that opens the real Workbench supplied bid-truth lane for `The Cooperative 1881 - Salt Lake City UT`, downloads the exact `halofire.supplied_document_bid_truth_review_packet.v1`, saves an employee replacement, and proves the lane stays fail-closed with `claim_gate_effect: no_claims_cleared`.
- The smoke also verifies queue/evidence readback after the page action, so the browser flow and server contract agree on `employee_replacement_recorded`, the saved `replacement_ref`, and zero cleared regulated claims.
- Verified with `npx vitest run tests/workbench-supplied-bid-truth-browser-smoke.test.js --reporter=verbose` and `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`. This is `NO_FORMALIZABLE_CLAIM`; it proves a browser/UI/API review path, not a theorem-shaped invariant.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-04 - Replay smoke default follow-up review

- Added a Workbench one-click default HaloFire follow-up review action for replay-scoped `openclaw_sam31_section_to_artifacts_consumer_intake_smoke` rows.
- The action saves `halofire.sam31_consumer_intake_smoke_followup_review_decision.v1` from the existing follow-up packet issue seeds, immediately downloads the source-linked `halofire.sam31_sprinkler_review_packet.v1`, and preserves `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, the saved smoke evidence id, and `claim_gate_effect: no_claims_cleared` in status metadata.
- Added a Workbench evidence detail renderer for saved HaloFire smoke follow-up review decisions so employees can see replay/replacement provenance and resolver row counts before moving deeper into sprinkler review.
- Verified red-to-green with `npx vitest run tests/workbench-room-boundary-floor-plan-override-browser-smoke.test.js --reporter=verbose`, plus adjacent `npx vitest run tests/workbench-sam31-consumer-intake-smoke-browser.test.js --reporter=verbose` and `npx vitest run tests/workbench-evidence-detail.test.js --reporter=verbose`. This is `NO_FORMALIZABLE_CLAIM`; it is UI/provenance/packet routing, not approval evidence.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-04 - Workbench replay smoke follow-through

- Added a Workbench one-click action on replay-scoped `sam31_actual_value_replacement` rows to save HaloFire `openclaw_sam31_section_to_artifacts_consumer_intake_smoke` evidence directly from the replay replacement.
- Preserved visible `source_replay_evidence_id`, `source_sam31_actual_value_replacement_evidence_id`, source refs, and `claim_gate_effect: no_claims_cleared` in the Workbench row/status metadata and follow-up/sprinkler packet links.
- Made the replay replacement scaffold carry employee-reviewed room polygons into SAM31 sections, object hypotheses, LLM observations, vector overlays, and internal-alpha 3D model candidates before saving the replacement.
- Verified red-to-green with `npx vitest run tests/workbench-room-boundary-floor-plan-override-browser-smoke.test.js --reporter=verbose` and adjacent coverage with `npx vitest run tests/workbench-sam31-consumer-intake-smoke-browser.test.js --reporter=verbose`. This is `NO_FORMALIZABLE_CLAIM`; it is UI/provenance/packet routing, not approval evidence.
- Still blocked: AutoSprink parity, AHJ approval, PE/professional review, permit readiness, fabrication readiness, manufacturer-exact models, brand readiness, production readiness, survey-grade claims, and engineering-grade claims.

## 2026-06-04 - Supplied bid-truth downstream defaults reuse

- Changed [`workbench.html`](C:/Users/dalla/OneDrive/Documents/HaloFire/workbench.html) so the supplied document bid-truth replacement form reuses the latest saved employee replacement as its edit baseline, including reviewer, review decision, replacement ref, source file/refs, replacement values, and notes.
- Added focused browser coverage in [`tests/workbench-supplied-bid-truth-browser-smoke.test.js`](C:/Users/dalla/OneDrive/Documents/HaloFire/tests/workbench-supplied-bid-truth-browser-smoke.test.js) proving a generated sprinkler bid shows the downstream-defaults card, downloads the downstream-defaults packet, and reopens the replacement form with the saved employee replacement instead of stale workbook defaults.
- Verified with `npx vitest run tests/workbench-evidence-detail.test.js tests/workbench-supplied-bid-truth-browser-smoke.test.js --reporter=verbose`, `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py`, and `git diff --check`. This is `NO_FORMALIZABLE_CLAIM`; it is Workbench provenance/edit-baseline behavior, not a theorem-shaped invariant.
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
