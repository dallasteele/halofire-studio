---
name: halofire-quickbid
description: 60-second fast-path estimator from sqft + hazard mix + add-ons → ballpark total.
inputs: [total_sqft, project_id, level_count, standpipe_count, dry_systems, hazard_mix]
outputs: [quickbid summary dict with total_usd + breakdown + confidence]
model: deterministic
budget_seconds: 1
---

# Quickbid Agent

## Status

**Implemented** inline at `orchestrator.run_quickbid()`. A future
refactor moves it into `agents/12-quickbid/agent.py` for symmetry —
tracked as an R3 follow-up.

## Purpose

Produce a ballpark proposal price in under a second so Wade can
triage incoming RFP sheets before committing to a full takeoff.

## Algorithm

```
materials_labor = Σ(total_sqft × hazard_frac × $/sqft_for_hazard)
standpipe_cost  = standpipe_count × $12,500
dry_cost        = dry_systems × $35,000
fdc_cost        = $2,850
permit          = $3,250
mobilizations   = 16 × $650   # 8 rough + 8 trim per proposal
subtotal        = Σ above
taxes           = subtotal × 0.072   # AZ default rate
total           = subtotal + taxes
```

Rates per hazard: `rate_per_sqft` in `orchestrator.py` —
`light=$2.95, ordinary_i=$3.60, ordinary_ii=$4.25, extra_i=$6.50,
extra_ii=$8.75, residential=$2.70`.

## Honesty (AGENTIC_RULES §13)

Confidence reported as **0.80**, not 0.95. Note field explicitly
says "full design (10–30 min) will refine ±5–10%". Quickbid is not
a substitute for a real takeoff.

## Budget

- 1 second wall clock (trivial arithmetic)

## Calibration

**Currently uncalibrated.** 1881 Cooperative quickbid returns
$662,863 vs Halo's actual $538,792 (+23%). Phase F of the remediation
plan calibrates `rate_per_sqft` + add-on costs against a held-out set
of 5–10 historical Halo bids to target < 10% MAE.

## Gateway tool binding

- `halofire_quickbid` (MCP)
- `POST /quickbid` (REST)

## Tests

`tests/e2e/test_full_pipeline.py::test_quickbid_returns_sane_total`
asserts total falls in [$300k, $1.5M] for a 170k-sqft job. Phase F
upgrades to MAE ≤ 10% on held-out historical corpus.
