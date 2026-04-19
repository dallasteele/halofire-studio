---
name: halofire-rulecheck
description: Evaluate a Design against NFPA 13-2022 testable rules + per-AHJ amendments. Emits Violation[] sorted by severity.
inputs: [Design]
outputs: [Violation[]]
model: deterministic (YAML rules → Python predicates)
budget_seconds: 15
---

# Rulecheck Agent

## Purpose

Turn NFPA 13 + AHJ rules into programmatic checks so every
AI-generated design is audited at a level a professional plan
reviewer would expect, *before* a human engineer sees it.

## Rule sources

- `rules/nfpa13_2022.yaml` — 13 canonical NFPA 13 rules (sections
  8.3.1 through 28.6 + Ch. 19 hose allowance)
- Per-AHJ amendment files (only SLC Fire for Alpha)

Each rule has: `id`, `section`, `severity` (error|warning|info),
`title`, `check` (Python function name), and `rationale`.

## Predicates implemented (Alpha subset)

| Rule ID | Check | Status |
|---|---|---|
| NFPA13-8.3.1 | every_room_has_coverage | done |
| NFPA13-9.2.1 | omitted_rooms_documented | stub (returns []) |
| NFPA13-11.2.3.1.1 | head_spacing_max | stub |
| NFPA13-11.2.3.1.2 | head_coverage_max | done |
| NFPA13-11.2.3.2 | obstruction_clearance | done (approx.) |
| NFPA13-11.2.3.1.3 | head_wall_offset | stub |
| NFPA13-7.2.3.1 | standpipe_hose_valves | done |
| NFPA13-7.10.3 | fdc_sized | stub |
| NFPA13-9.2.2.1 | hanger_spacing | done |
| NFPA13-28.5 | pipe_schedule_method | done |
| NFPA13-28.6 | hydraulic_demand_ok | done |
| NFPA13-19.3.3 | hose_allowance | stub |
| SLC-FDC-LOC | fdc_address_side | done |

Remediation Phase G adds the remaining predicates + full property-
test coverage.

## Output

`list[Violation]` sorted errors → warnings → info. Each Violation
has `rule_id`, `section`, `severity`, `message`, `refs` (affected
node IDs). Callers append to `Design.issues`.

## Contract

- Input: full `Design` already populated by upstream agents
- No side effects on input
- Every rule runs in isolation: one crashing predicate appends a
  `RULECHECK_PREDICATE_CRASH` warning and evaluation continues

## Budget

- 15 seconds for a 500-segment / 1000-head design
- Rule predicates are O(rooms + segments) in the worst case

## Exceptions

None raised; each predicate's failure is logged via `warn_swallowed`
and surfaces as a Violation. Caller never needs to handle exceptions.

## Gateway tool binding

`halofire_validate` (existing). Pipeline wraps `check_design()`.
