---
name: halofire-labor
description: Compute per-role labor hours from a BOM + Design using Halo's productivity rates.
inputs: [Design, BomRow[]]
outputs: [LaborRow[]]
model: deterministic
budget_seconds: 2
---

# Labor Agent

## Purpose

Turn a BOM + Design into a role-hour breakdown with extended dollar
cost, suitable for the Halo pricing workbook.

## Roles (AZ ROC union, Alpha defaults)

| Role | Rate $/hr | Default allocation |
|---|---|---|
| Foreman | 78 | 15% |
| Journeyman | 62 | 45% |
| Apprentice | 40 | 25% |
| Helper | 32 | 10% |
| Project Manager | 95 | 5% |

## Productivity constants (from Halo historicals, ballpark)

- Head install: 0.35 hr each + 0.15 hr trim
- Pipe: 0.08–0.30 hr/ft scaling with size
- Fitting: 0.25 hr elbow / 0.40 hr tee
- Hanger: 0.30 hr each
- Riser assembly: 20 hr wet / 40 hr dry
- FDC: 8 hr
- Hydro test: 4 hr per level
- Mobilization: 16 hr × 16 (8 rough + 8 trim per proposal)

Phase F calibrates against historical bids.

## Inputs + outputs

- In: `Design` (for level count → hydro tests) + BomRow[]
- Out: one `LaborRow` per role, each with hours + rate + extended $

## Budget

- 2 seconds
- Single pass over BOM

## Known limitations

- Allocation fractions are static across all jobs; no per-job
  breakdown yet
- No prevailing-wage handling (see proposal exclusion #4)
- No geographic rate multiplier

## Gateway tool binding

Consumed by `halofire_ai_pipeline` via orchestrator; not a standalone
MCP tool (yet).
