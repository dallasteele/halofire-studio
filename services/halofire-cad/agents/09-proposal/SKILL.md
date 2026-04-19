---
name: halofire-proposal
description: Build the canonical proposal.json + render proposal.pdf + proposal.xlsx from a Design + BOM + labor rows.
inputs: [Design, BomRow[], LaborRow[], Violation[]]
outputs: [proposal.json, proposal.pdf, proposal.xlsx]
model: deterministic
budget_seconds: 10
---

# Proposal Agent

## Purpose

Emit the three artifacts the web bid viewer + Halo's internal
workflow consume:

- `proposal.json` — **canonical** structured proposal (the viewer
  reads this)
- `proposal.pdf` — Halo-formatted client-facing PDF via reportlab
- `proposal.xlsx` — Halo's pricing workbook shape via openpyxl

## Schema stability

`proposal.json` is a pinned public API (§6.3). Any change is
additive-only. Versioned via `version: 1` at the top level.

## Contract

- In: `Design`, `BomRow[]`, `LaborRow[]`, optional violations
- Out: dict payload + three file paths under `out_dir`

`build_proposal_data()` is pure — no side effects; the
`write_proposal_files()` helper does I/O.

## Honesty (AGENTIC_RULES §13)

- "Internal Alpha preview — NOT FOR CONSTRUCTION" watermark on PDF
- Disclaimer on the proposal JSON front matter
- No "AHJ-ready" / "permit-ready" language until Phase H PE sign-off

## Budget

- 10 seconds total
- reportlab and openpyxl are both fast

## Exceptions

- `IOError` / `OSError` for disk failures bubble up; orchestrator
  catches + logs
- No `ExportError` subclass yet — Phase F creates `ProposalExport
  Error`

## Gateway tool binding

Invoked by orchestrator via `halofire_ai_pipeline`. Direct MCP tool
exposure is planned but not required for Alpha.
