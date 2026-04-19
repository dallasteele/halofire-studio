# HaloFire CAD — Rulebook Compliance Refactor

**Date:** 2026-04-19
**Driver:** `E:/ClaudeBot/AGENTIC_RULES.md`
**Status:** Active; execute before remediation plan phases B–I

## Problem statement

HaloFire CAD Studio was built fast to prove the pipeline. Several
pieces now violate the canonized rulebook. Before we build more
features, we lock the structure in compliance.

## Audit findings (2026-04-19)

| Rulebook section | Violations found |
|---|---|
| §1.1 stateless typed I/O | `intake_pdf_page` returns `dict[str, Any]`; orchestrator `run_pipeline` returns `dict` not a pydantic `PipelineSummary`; agents use `list[dict]` in places |
| §1.3 errors-as-data, no silent swallow | 29 `except Exception:` / `except:` blocks across agents and orchestrator with no named exception class and no log |
| §1.5 SKILL.md for every agent | 3/13 agents have SKILL.md (intake, classifier, placer). Missing: router, hydraulic, rulecheck, bom, labor, drafter, proposal, submittal, field, quickbid |
| §5.1 unit tests per agent | 1 test file for 10 agents that have code |
| §5.2 property tests | 0 |
| §5.3 stress tests | 0 |
| §5.4 golden fixtures | 2 (good start), need per-agent coverage |
| §5.5 E2E | 0 automated (manual curl only) |
| §5.6 Playwright | 0 |
| §7.1 pre-commit hooks | none; `--noCheck` not guarded |
| §7.3 `# TODO` without ticket | several in intake + orchestrator |
| §9.4 global mutable state | `_JOBS` + `_ORCH` in gateway `main.py` — scoped OK for in-process dev but not production; flagged |
| §8 evidence in commits | commits since 2026-04-19 pivot include evidence; earlier ones do not — acceptable baseline |

## Chosen approach

Do the structural cleanup now (low-risk, high-leverage), then unlock
the feature remediation phases B–I from the other plan.

Three batches, each independently committable:

- **Batch R1: Contract + observability** — typed outputs, named
  exceptions with logs, structured logging
- **Batch R2: Testing scaffolding** — pytest layout, hypothesis
  property tests, stress test harness, pre-commit hooks
- **Batch R3: SKILL.md coverage** — the remaining 10 agents

After R1–R3 land, Phase A (type-debt fix) from
`2026-04-19-internal-alpha-remediation.md` can start.

## Batch R1 — Contract + observability

- **R1.1** New pydantic models for all agent dicts. In
  `cad/schema.py`:
  - `PageIntakeResult` replacing `intake_pdf_page` dict return
  - `PipelineStep` + `PipelineSummary` replacing orchestrator dict
  - `JobStatus` replacing gateway `_JOBS[...]` dict
- **R1.2** `intake_pdf_page` returns `PageIntakeResult`, with
  `.to_json()` for REST compatibility.
- **R1.3** `run_pipeline` returns `PipelineSummary`. REST layer
  calls `.model_dump()` on the boundary.
- **R1.4** Global named exception class family in
  `cad/exceptions.py`: `HalofireError` root + `IngestError`,
  `RoutingError`, `HydraulicError`, `ExportError`, `PipelineError`.
  Each carries a stable `code` matching the violation dictionary.
- **R1.5** Replace every `except Exception: pass` /
  `except: <no log>` with the specific exception class + `log.warning
  ("hf.agent.degraded", extra={"code": ..., "agent": ..., "err":
  str(e)})`. If a specific exception can't be named, the code lives
  until a real repro — but the swallow becomes a `log.exception()`.
- **R1.6** Standard logger setup at `cad/logging.py`: JSON formatter
  in production, pretty formatter in dev. Every agent module calls
  `log = logging.getLogger(f"halofire.agent.{name}")`.
- **R1.7** Every stage's output JSON writes under a stable schema
  version field (`_schema_version: 1`). Future bump-adds are
  additive-only (§6.3).

Gate evidence: unit tests for each new pydantic model
round-trip; pytest confirms no silent-swallow regressions
(via a grep test that fails on new `except Exception:` without
adjacent `log.`).

## Batch R2 — Testing scaffolding

- **R2.1** `services/halofire-cad/pytest.ini` + `conftest.py`
  with shared fixtures:
  - `tiny_building` — 1 level, 1 room, 10 × 10 m, light hazard
  - `medium_building` — 4 levels, mixed hazards
  - `stress_building` — 10 levels, 1000 heads (for §5.3)
  - `supply_strong` / `supply_weak` — FlowTestData fixtures
  - `fixture_pdf_1881` — path to the committed test PDF
- **R2.2** One `tests/unit/test_<agent>.py` per agent with
  happy path + empty + malformed + schema-drift cases (§5.1)
- **R2.3** Hypothesis property tests in
  `tests/properties/test_<agent>_properties.py`:
  - Placer: heads inside room polygon, no two closer than
    s_min/3, heads/room ≤ max_count
  - Router: every head reachable from riser, pipe size
    monotone upstream
  - Hydraulic: Q = K√P holds at every head, pressure monotone
    upstream, flow monotone toward riser
- **R2.4** `tests/stress/test_<agent>_stress.py` marked
  `@pytest.mark.stress` — runs nightly only. Uses
  `stress_building` fixture, enforces wall-clock + memory budgets.
- **R2.5** `tests/e2e/test_full_pipeline.py` — upload fixture PDF,
  poll status, verify all 9 deliverables on disk with
  correct shape and smoke-parse success.
- **R2.6** Pre-commit hook at `.pre-commit-config.yaml`:
  - Reject any commit adding `--noCheck` / `// @ts-nocheck` /
    `# type: ignore` without an adjacent justification comment
  - Reject `except Exception: pass` without adjacent `log.`
  - Reject `print(` in `services/halofire-cad/**`
  - Run `python -m compileall -q services/halofire-cad` on changed
    files
- **R2.7** CI config (`.github/workflows/ci.yml` or equivalent)
  running lint + typecheck + pytest (unit + property) on every PR;
  stress tests nightly cron.
- **R2.8** Schema drift CI: `scripts/check_schema_drift.py` that
  compares current pydantic schemas against
  `tests/fixtures/schemas/baseline.json`. Additions OK; renames
  / removals fail the build.

Gate evidence: `pytest -q` runs green on all tiers; CI workflow
committed; first schema baseline committed.

## Batch R3 — SKILL.md coverage

10 missing SKILL.md files, each following the §1.5 template. Owner:
Sonnet via single Agent SDK run, reviewed by Codex.

- router (03)
- hydraulic (04)
- rulecheck (05)
- bom (06)
- labor (07)
- drafter (08) — still stubbed; SKILL.md frames the scope
- proposal (09)
- submittal (10)
- field (11) — not started; SKILL.md scopes it
- quickbid (12) — implemented in orchestrator.run_quickbid, move
  to its own agent + SKILL.md

Gate evidence: every agent dir contains SKILL.md with filled
sections; Codex reviews for truthfulness (no promising what isn't
built).

## Out of scope for this refactor

- Any new features — those live in the
  `2026-04-19-internal-alpha-remediation.md` plan Phases B–I.
- Rename of digit-prefix dir names (`00-intake` etc.) — the
  importlib-by-path loading works and Codex's tests pass. Revisit
  if it bites during test authoring.
- Moving `quickbid` out of orchestrator — do it in R3 alongside
  its SKILL.md.

## Verification gates for this refactor

Per AGENTIC_RULES.md §8, before calling the refactor complete:

1. Lint — `npm run lint` + `ruff check` clean
2. Typecheck — `npm run check-types` + `mypy --strict` on changed
   Python modules
3. Build — `npm run build` passes
4. Unit tests — `pytest -q tests/unit tests/properties` green
5. Stress tests — `pytest -q -m stress` green (at least one per
   agent)
6. E2E — `pytest -q tests/e2e` green
7. Service start — gateway + studio respond to health
8. Golden diff — no unexpected fixture drift (R2 freezes new
   goldens)
9. Schema drift — baseline committed, `check_schema_drift.py` green
10. Manifest truthful — any remaining degradations in
    `manifest.warnings` with codes

## Cadence

- R1 first (blocks R2 test cases). Target: one session.
- R2 after R1 lands. Target: one session.
- R3 parallelizable with R2. Target: one session.

## Definition of "refactor complete"

All of:

- [ ] R1 done — typed contracts across every boundary, zero silent
      `except Exception: pass`, structured logger in every agent
- [ ] R2 done — conftest + unit + property + stress + e2e tests
      land; CI + pre-commit hooks reject known violations
- [ ] R3 done — SKILL.md for all 13 agents, Codex-reviewed for
      truthfulness
- [ ] Schema baseline v1 committed
- [ ] Gate-1-through-10 evidence in the closing commit body

Then the 2026-04-19-internal-alpha-remediation.md plan is unblocked
and Phase A starts.
