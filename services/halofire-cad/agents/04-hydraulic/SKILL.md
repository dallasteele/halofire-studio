---
name: halofire-hydraulic
description: NFPA 13 §28.6 density-area hydraulic calc for tree sprinkler systems. Computes demand at base of riser + supply-curve safety margin.
inputs: [System, FlowTestData, hazard:str]
outputs: [HydraulicResult]
model: deterministic (Hazen-Williams + iterative flow accumulation)
budget_seconds: 10
---

# Hydraulic Agent v2 (Alpha)

## Purpose

Evaluate a single sprinkler System's hydraulic demand against its
water-supply curve. Emit a §28.6 density-area result with:

- Required flow (gpm) and pressure (psi) at base of riser
- Supply static / residual / flow at the supply point
- Safety margin (supply − demand) — must be ≥ 5 psi for pass
- Critical path (list of segment IDs)
- Per-node trace and per-segment loss for audit
- Explicit `issues` for unsupported topologies

## Algorithm

1. Pick (density, design_area_sqft) from hazard class per NFPA 13
   Fig. 19.2.3.1.1.
2. Build directed graph from System.pipes oriented toward the riser.
3. Per-head design flow: `max(density × area / n, K × √P_min)` where
   P_min = 7 psi (residential min working pressure).
4. Walk each head → riser path; accumulate flow through segments.
5. Hazen-Williams friction loss per segment + fitting equivalent
   length from §23.4.3 + elevation (0.433 psi/ft).
6. Demand at base of riser = P_min + Σ losses.
7. Linearize supply curve and compute safety margin.

## Known limitations (Alpha)

- **Tree topology only**: Loop / grid networks (§28.7) emit
  `LOOP_GRID_UNSUPPORTED` in `result.issues` and return
  `converged=False`.
- **Remote-area selection is naive**: uses *all* heads, not the most
  remote 1500 sqft. Hydraulic Beta (Phase C.1) fixes this.
- **No upsize loop**: if demand > supply, the result is reported but
  pipe sizes are not automatically increased.
- **No pump / tank / backflow modeling**.
- **No looped Hardy-Cross solver**.

These limits are explicit in `result.issues` and propagated into the
pipeline manifest per AGENTIC_RULES §2.3.

## Outputs

`HydraulicResult` pydantic model with: `design_area_sqft`,
`density_gpm_per_sqft`, `required_flow_gpm`, `required_pressure_psi`,
`supply_static_psi`, `supply_residual_psi`, `supply_flow_gpm`,
`demand_at_base_of_riser_psi`, `safety_margin_psi`,
`critical_path`, `node_trace`, `supply_curve`, `demand_curve`,
`issues`, `converged`, `iterations`.

## Budget (§1.4)

- 10 seconds per system (typical 50-head system: <1 s)
- Iteration cap: 8 outer + internal Dijkstra runs

## Exceptions

- `HydraulicError` for unrecoverable setup failures
- `HydraulicNonConvergence` (subclass) if Hardy-Cross is ever added
  and fails to converge

## Gateway tool binding

`halofire_calc` (existing). The `single_branch` mode is the legacy
demo; `calc_system()` is the production-grade entry point the
orchestrator uses.

## Next phases

Phase C of the remediation plan (2026-04-19-internal-alpha-
remediation.md) addresses: remote-area selection, Hardy-Cross
loop/grid, pump+tank+backflow, upsize loop, and a §28.6-compliant
calc report.
