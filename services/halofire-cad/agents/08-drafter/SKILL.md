---
name: halofire-drafter
description: Render AHJ sheet-set PDFs (FP-0 cover + FP-N per-level plans + FP-H hydraulic placard) from a Design.
inputs: [Design, manifest_options]
outputs: [path to sheet_set.pdf]
model: deterministic
budget_seconds: 15
---

# Drafter Agent (Alpha, Phase 0)

## Status

**Not yet its own agent module.** The renderer currently lives at
`services/halopenclaw-gateway/drafting_fp.py` and is invoked via the
`halofire_export sheet_set` gateway tool. Moving it into
`agents/08-drafter/agent.py` is a Phase D item in the remediation
plan.

## What ships today

Multi-page PDF via matplotlib `PdfPages`:

- **FP-0 Cover** — Halo Fire branded title block + project info +
  sheet index + general notes + fire systems summary
- **FP-N per-level plans** — hazard shading, pipe-size colored line
  work per industry convention, red head markers, N-arrow, legend,
  counts in title
- **FP-H Hydraulic placard** — §28.6 data plate

Every page has the "DEFERRED SUBMITTAL — NOT FOR CONSTRUCTION" legend
per AGENTIC_RULES.md §13 honesty requirements.

## What does NOT ship (Phase D → Beta)

- FP-R riser detail
- FP-S section views
- FP-D details
- FP-B BOM schedule sheet
- Title block revisions / sheet revision workflow
- Professional engineer stamp overlay (requires Phase H signoff)
- Dimensioning + callouts
- Symbol library consistency (currently basic markers only)

## Contract

- In: `Design` with systems.heads + systems.pipes populated,
  `hydraulic` attached
- Out: bytes written to `out_path`; caller receives `str(out_path)`

## Budget

- 15 seconds for a 10-level job
- Memory: matplotlib figure × level count — avoid keeping all open

## Exceptions

- `ExportError` subclass (to be created when module moves)
- Today: bubbles up matplotlib exceptions with `warn_swallowed` at
  the caller level

## Gateway tool binding

`halofire_export` with `mode: sheet_set`.
