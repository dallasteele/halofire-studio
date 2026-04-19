---
name: halofire-bom
description: Aggregate SKU quantities from a Design and apply Halo's list pricing + markup.
inputs: [Design]
outputs: [BomRow[]]
model: deterministic
budget_seconds: 2
---

# BOM Agent

## Purpose

Walk a Design and roll up quantities for every head, pipe foot,
fitting, hanger, valve, riser, and FDC. Apply list prices from the
catalog + Halo's markup to produce the extended cost column for the
proposal and XLSX workbook.

## Inputs + outputs

- In: populated `Design` with systems.heads, systems.pipes,
  systems.fittings, systems.hangers
- Out: `list[BomRow]` sorted by SKU

## BomRow shape

```
sku: str
description: str
qty: float
unit: "ea" | "ft"
unit_cost_usd: float
extended_usd: float   # qty * unit_cost * (1 + HALO_MARKUP)
```

## Pricing provenance

`LIST_PRICE_USD` dict lives inline in `agent.py`. Beta replaces it
with a versioned CSV Halo updates monthly. Current numbers are
**ballpark calibration** — see Phase F (pricing calibration) in the
remediation plan.

Markup: 35% over wholesale (Halo's typical margin).

## Known limitations

- Per-line pricing is **not calibrated against historical Halo
  bids** — Quickbid runs 23% over actual. Phase F fixes this.
- No regional pricing (AZ vs UT vs TX).
- No discount tiers for volume purchases.
- No union vs non-union labor market swap.

## Budget

- 2 seconds for any reasonable Design
- Single pass over heads + pipes + fittings + hangers

## Gateway tool binding

Not directly; consumed by `halofire_ai_pipeline` and the proposal
agent. A standalone BOM tool can be added if operators want it
independently.
