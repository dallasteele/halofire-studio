# HaloFire CAD — Internal Alpha → Beta Remediation Plan

**Date:** 2026-04-19
**Author:** Claude Opus (planning), in response to Codex 2026-04-19
corrective review in `CODEX_REVIEW.md`
**Rulebook:** `E:/ClaudeBot/AGENTIC_RULES.md` governs every item below
**Current release bar:** Internal Alpha. Target: Beta with one real
historical Halo bid end-to-end.

## Problem statement

Codex's 2026-04-19 review is the truthful ground state: the app is
Internal Alpha, useful pipelines exist but critical gaps block any
claim of commercial or AHJ-ready CAD. The user's direction was clear:

> "all code you build follows the correct agentic structure as a rule.
> codex must thoroughly test all core architecture. the agentic
> software must also be written with proper stress testing, code
> checkpoints and verification of I/O. we need a professional level
> of strictness to make sure we only get working code."

This plan turns that into concrete work items keyed to every blocker
Codex flagged. Each item has an owner-agent, a verification
requirement, and a gate.

## Constraints (do not violate)

- AGENTIC_RULES.md §8 verification gates apply to every phase
- No new agent ships without stress tests (§5.3)
- No new public schema ships without a golden fixture (§5.4)
- No E2E claim without a passing Playwright spec (§5.6)
- No "AHJ-ready" language until a licensed PE signs off (§13)
- Brain writeback mandatory after every completed phase (§11)

## Phases

### Phase A — Fix inherited type debt (unblocks everything)

**Why first:** Gate 2 (typecheck) cannot be trusted while packages use
`--noCheck`. Every later phase gets audit-noise from ambient errors.

- **A.1** Audit every `--noCheck` in package.json files. List each
  inherited Pascal/Three error class. Owner: Codex.
- **A.2** For each class, pick: (a) fix in place, (b) narrow type
  surface with wrapper module, (c) exclude via `tsconfig` `exclude`
  with justification comment. No "just turn it off" left standing.
  Owner: Sonnet via Agent SDK, reviewed by Codex.
- **A.3** Remove `--noCheck` from `@pascal-app/core`,
  `@pascal-app/editor`, `@pascal-app/viewer`, and the Next app.
  Commit only when `npm run check-types` passes without the flag.
- **A.4** Add a pre-commit hook that refuses any commit adding
  `--noCheck` or `// @ts-nocheck`.

**Gates for phase A:** 1, 2, 3, 7 (no files touched, no runtime
regression). Evidence: full `check-types` output pasted in commit body.

### Phase B — PDF ingest that actually reads real Halo bids

**Why second:** Wade's real bid documents will never hit L1
pdfplumber alone. Without L2/L3/L4, the intake agent produces 0
walls on the 173 MB 1881 architectural PDF.

- **B.1** `agents/00-intake/agent.py` Layer 2: pymupdf rasterizer +
  OpenCV Hough + LSD line detection. Owner: Sonnet.
- **B.2** Layer 3: CubiCasa5k integration. Owner: Sonnet, with Opus
  escalation if the MIT-licensed weights need pre-training
  adaptation.
- **B.3** Layer 4: Claude Vision annotator via Agent SDK — reads
  rasterized page + text callouts, returns structured room labels +
  dimensions. Per AGENTIC_RULES §3.2, the L4 path has a deterministic
  fallback: if vision fails, return the L1–L3 result unchanged with a
  warning code.
- **B.4** Scale detector: extend beyond title-block text to
  dimension-line inference. Property test: given a fixture page with
  a marked 25'-0" line, detected scale is within 2%.
- **B.5** Level page classifier: reads title-block text to split
  multi-page PDFs into levels. Owner: Sonnet.
- **B.6** Stress test: 200-page architectural PDF, 173 MB, max 10
  minutes total, max 4 GB RAM.
- **B.7** Golden fixture: the 1881 architectural PDF's level index
  page rendered to a known-good `building_raw.json`.

**Gates:** 1–6, 8, 10. Evidence: stress-test run log with timing
+ memory profile.

### Phase C — Hydraulic solver: remote-area + loop/grid + pump/tank

**Why third:** Gate 10 manifest truthfully says "tree-only". The
real Halo bid has 2 combo standpipes, 2 dry garages, and a manual
wet standpipe — all of which exercise the missing paths.

- **C.1** Remote-area selection per §28.6: find the 1500 sqft
  (light) / 2500 sqft (extra) window of heads with highest demand.
  Owner: Sonnet. Property test: solver output matches hand-calc on
  Appendix A worked example within 3%.
- **C.2** Loop/grid network solver (§28.7): Hardy-Cross on nx
  DiGraph with cycle detection + iterative ΔQ correction. Owner:
  Sonnet, reviewed by Opus for numerical stability.
- **C.3** Pump curve ingestion + iteration. Owner: Sonnet.
- **C.4** Backflow + PIV equivalent-length contribution. Owner:
  Sonnet.
- **C.5** Tank / gravity-fed supply mode. Owner: Sonnet.
- **C.6** Hydraulic report format: a §28.6-compliant calc sheet
  (HTML + PDF) listing every node's pressure, flow, critical path,
  fitting equiv length. Owner: Sonnet.
- **C.7** Stress test: 500-segment mixed wet/dry/looped system,
  converges within 20 iterations, memory < 1 GB.
- **C.8** Golden fixture: reference calc against a published NFPA 13
  Appendix A example.

**Gates:** 1–6, 8. Evidence: hand-calc vs solver diff in commit body.

### Phase D — CAD inspection: DXF + IFC + GLB opened in real tools

**Why:** Codex correctly flagged that we haven't inspected output
in AutoCAD / Revit / Navisworks. A DXF that passes `ezdxf` might
not open in AutoCAD 2024 with the user's expected layer structure.

- **D.1** Inspect current DXF output in AutoCAD 2024 / LibreCAD /
  QCAD. Fix any layer/color drift. Add a smoke-test that opens the
  DXF headlessly (ezdxf's readfile + audit) in CI.
- **D.2** Upgrade IFC export: add `IfcProductDefinitionShape` +
  `IfcLocalPlacement` + real swept-solid geometry for pipes + block
  geometry for heads. Owner: Sonnet. Opus if IfcOpenShell 0.8 API
  requires low-level entity construction.
- **D.3** Inspect IFC in BlenderBIM + Navisworks. Verify clash
  detection works against an architect's IFC.
- **D.4** GLB: verify in Khronos glTF Validator + load in Blender.
  Report any warnings in `manifest.warnings`.
- **D.5** Golden fixtures: one DXF + one IFC + one GLB from a
  canonical small bid, re-emitted on every CI run and byte-diff'd.
- **D.6** Playwright test: web viewer loads the generated GLB with
  no console errors, renders within 3 seconds.

**Gates:** 1–6, 8, 10. Evidence: screenshots from AutoCAD /
BlenderBIM / Three.js viewer.

### Phase E — Production auth + per-project permissions

**Why:** AGENTIC_RULES.md §13 forbids the word "production" without
auth. The current `HALOFIRE_API_KEY` env var is fine for local-only;
it is not an auth model.

- **E.1** Pick an auth scheme. Options: OAuth via Auth0 (fast, cost),
  self-hosted with argon2 + JWT + httpOnly cookies (slow, free), or
  passwordless magic-link (middle). Owner: Opus (decision) +
  Sonnet (implementation).
- **E.2** Per-project permissions: `project_roles[project_id][user_id]
  = "owner" | "estimator" | "reviewer" | "viewer"`. Enforce at the
  gateway REST + MCP layer.
- **E.3** Signed URLs for deliverables — short-TTL signatures that
  the bid viewer embeds in its Halo Fire-branded download links.
- **E.4** Rate limiting (FastAPI middleware): 10 uploads / min /
  user, 100 status polls / min / user.
- **E.5** Audit log: every mutation + every deliverable download
  stored in brain + a local append-only file.

**Gates:** 1–6, 8, E2E auth flow. Evidence: Playwright auth spec
passing.

### Phase F — Pricing calibration against real Halo bids

**Why:** Quickbid $662k vs real $538k is 23% over. Calibration is
arithmetic — just needs the data.

- **F.1** Collect 5–10 historical Halo bid proposals (XLSX or PDF).
  Extract per-line-item pricing + role-hour totals.
- **F.2** Fit `LIST_PRICE_USD` and `rate_per_sqft` tables by
  ordinary-least-squares regression on the corpus.
- **F.3** Split: train on 70% of bids, test on 30%. Success = test
  mean absolute error < 10%.
- **F.4** Store the calibrated rates in a versioned JSON; regenerate
  on new data.
- **F.5** Property test: monotonicity (bigger building → higher
  price, at constant hazard mix).

**Gates:** 1–5, 8. Evidence: fit summary + test MAE in commit body.

### Phase G — Playwright E2E + broader golden fixtures

**Why:** AGENTIC_RULES.md §5.5 + §5.6 requires it before any feature
claim of "works E2E."

- **G.1** Playwright suite: upload PDF → poll job → download
  proposal PDF → open bid viewer → verify all deliverable links
  200 → verify industry pipe colors in 3D viewport → resize to
  mobile viewport → verify tabbed layout.
- **G.2** Golden: one canonical small bid fixture run through the
  entire pipeline; every deliverable byte-diffed against stored
  golden on every CI run.
- **G.3** Orchestrator concurrency stress: 10 concurrent pipeline
  runs, verify no data bleed, no deadlocks. Per §5.3.

**Gates:** 1–6, 8, 10. Evidence: `playwright show-report` output
+ concurrency stress log.

### Phase H — PE review pipeline

**Why:** §13 forbids "AHJ-ready" language without a named PE. We
need a process, not just a disclaimer.

- **H.1** Sign-off workflow in the bid viewer: PE reviews Design →
  signs with recorded identity + license number → Design
  transitions from `status: "internal-alpha"` to `status:
  "pe-reviewed"`.
- **H.2** `signed_by` field on Design, cryptographically verifiable
  if we go that far (likely out of scope for beta).
- **H.3** The only path that emits the word "submittal" is a
  PE-signed Design. Everything else says "preview" or "draft".
- **H.4** Submittal watermark removal: only PE-signed outputs omit
  "NOT FOR CONSTRUCTION".

**Gates:** 1–6, 8, plus a legal review (out-of-band).

### Phase I — Documentation + brain writeback

- **I.1** Update `CODEX_REVIEW.md` after each phase lands with:
  what changed, which gates passed, remaining risks.
- **I.2** `BUILD_LOG.md` entries per phase, per AGENTIC_RULES §12.
- **I.3** Brain writeback after each phase: decisions, rationale,
  failure modes. Tag `project:halofire, phase:<letter>`.
- **I.4** Update the plan doc (this file) checkboxes. Checked
  boxes live; unchecked boxes are still real work.

## Dependency graph

```
A (type debt) ──┬─▶ B (PDF ingest) ──┐
                │                    ├─▶ D (CAD inspection) ──▶ G (E2E)
                └─▶ C (hydraulic)  ──┘                          │
                                                                │
E (auth) ──── independent, can run parallel                     │
F (pricing) ── independent, needs corpus                        │
H (PE workflow) ── needs G + legal review ──────────────────────┘
```

A and E unblock everything else. B and C are parallelizable and
should be owned by separate Sonnet runs.

## Risk register

| Risk | Phase | Likelihood | Mitigation |
|---|---|---|---|
| CubiCasa5k weights drift / licensing | B.2 | medium | Pin to a specific release tag; add a fallback to L2 if weights missing |
| Hardy-Cross non-convergence on pathological nets | C.2 | medium | Iteration cap with `Issue("HYDRAULIC_NO_CONVERGE")`, no silent failure |
| IfcOpenShell 0.8 API churn | D.2 | medium | Pin version; unit test entity creation against pinned version |
| Historical Halo bids unavailable | F.1 | low-medium | Fallback: synthetic corpus from public sprinkler cost data |
| Playwright flakiness in CI | G.1 | medium | Retry-on-fail twice, capture video on failure, triage weekly |
| PE cost/time blocker | H | low | Draft workflow standalone; identify PE partner early |

## Testing escalation (per §5)

Every phase ships with, at minimum:

- Unit tests for the new code (§5.1)
- Property tests for numeric output (§5.2)
- A stress test entry in `tests/stress/` (§5.3)
- A golden fixture under `tests/fixtures/<domain>/` (§5.4)
- An E2E test or Playwright spec that exercises the phase through
  HTTP (§5.5, §5.6)

Phases that skip tests are not considered "done." Codex reviews
must reject non-tested code per AGENTIC_RULES §15.

## Honesty contract (per §13)

- Every phase's completion claim includes the 10-gate evidence.
- Every "production" or "AHJ-ready" claim requires PE sign-off
  (Phase H).
- Every confidence number comes from measurement, not authorial
  vibes.
- Every known limitation is in `manifest.warnings`, not buried in
  a doc footnote.

## Definition of "Beta-ready"

All of:

- [ ] Phase A complete — no `--noCheck` in any package
- [ ] Phase B complete — 1881 full arch PDF produces a non-trivial
      Building JSON with correct hazards
- [ ] Phase C complete — hydraulic report matches hand-calc on a
      reference problem within 3%
- [ ] Phase D complete — DXF opens in AutoCAD, IFC opens in
      BlenderBIM, GLB validates in Khronos validator
- [ ] Phase E complete — auth + per-project roles enforced
- [ ] Phase F complete — quickbid MAE < 10% on held-out historical
      Halo bids
- [ ] Phase G complete — Playwright suite + concurrency stress
      passing in CI
- [ ] One real historical Halo bid run end-to-end with Wade's
      comparison vs Studio's output captured in a case study

Until all boxes check, the release bar stays at Internal Alpha and
the UI says so.

## Definition of "Commercial-ready" (not this plan)

Beyond Beta:

- Native DWG read
- AHJ sheet revision workflows
- PE sign-off integration (Phase H complete)
- Jurisdictional rule packs beyond SLC
- Multi-tenant + billing
- On-call runbook
- SLO / error budget
- Third-party security audit

These are out of scope for this plan — captured for sequencing only.

## Owner assignments

| Phase | Planning | Implementation | Review |
|---|---|---|---|
| A | Opus | Sonnet + Codex | Codex |
| B | Opus | Sonnet (per sub-task) | Codex |
| C | Opus | Sonnet + Opus (C.2) | Codex + licensed FP engineer |
| D | Opus | Sonnet | Codex + manual AutoCAD inspection |
| E | Opus | Sonnet | Codex + security-pass review |
| F | Sonnet | Sonnet | Codex |
| G | Sonnet | Sonnet | Codex |
| H | Opus | Sonnet | Legal + Codex |
| I | Claude | Claude | always-on |

"Sonnet + Codex" = Sonnet drives implementation via Agent SDK,
Codex reviews + commits. Codex is the final gate on every
phase per §15.

## Cadence

- Phase A: start immediately (blocker for everything)
- Phases B + C + E + F: parallel starts after A lands
- Phase D: after B (needs real extracted geometry to test exports)
- Phase G: after B + C + D land
- Phase H: after G lands + legal review
- Phase I: continuous

Target: Beta release by end of 2026-Q3.

## Evidence requirement

Each phase's completion PR must include:

1. The 10 verification-gate outputs (§8)
2. A BUILD_LOG entry (§12)
3. A brain writeback confirmation (§11)
4. A CODEX_REVIEW.md amendment with: what shipped, what's
   verified, what remains

Without that evidence, the phase is not complete. Self-reports
without evidence do not close boxes on this plan.

---

*This plan is the contract between the user, Claude, HAL, and Codex
for moving HaloFire CAD from Internal Alpha to Beta. Every rule
referenced is in `E:/ClaudeBot/AGENTIC_RULES.md`. When this plan
conflicts with the rulebook, the rulebook wins and this plan gets
fixed in the same session.*
