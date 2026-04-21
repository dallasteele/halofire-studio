# Blueprint 06 — Calculation Engines

**Scope:** Hydraulic (Hardy Cross + Hazen-Williams), NFPA 13 rule
check, seismic bracing, fire-pump curves, tank sizing. TypeScript
canonical + Python mirror with CI-enforced parity.

## 1. Hydraulic engine

### 1.1 Data model

```typescript
export interface HydraulicNetwork {
  nodes: HNode[]              // junctions + heads
  edges: HEdge[]              // pipe segments with HW params
  supply: Supply              // municipal supply + optional pump + tank
  remote_area: RemoteArea     // NFPA §19 polygon
  hazard: HazardClass
  design: DesignCriteria
}

export interface HNode {
  id: string
  position_m: [number, number, number]
  elevation_ft: number
  head_ids: string[]          // sprinkler heads at this junction
  is_source: boolean          // riser base?
}

export interface HEdge {
  id: string
  from: string
  to: string
  length_ft: number
  id_in: number               // internal diameter
  c_factor: number            // Hazen-Williams
  fittings: FittingK[]        // equivalent-length K values
  elevation_delta_ft: number
}
```

### 1.2 Hardy Cross loop solver

`packages/hf-core/src/hydraulic/hardy-cross.ts`:

```typescript
export function solveHardyCross(
  network: HydraulicNetwork,
  opts: { max_iterations?: number; tolerance_gpm?: number } = {},
): HydraulicSolution
```

Algorithm:
1. Build loops from the network graph.
2. Assume initial flow distribution (proportional).
3. For each loop, compute ∑hL around the loop.
4. Compute correction ΔQ = -∑hL / (1.85 × ∑|hL|/Q).
5. Apply corrections; repeat until max |ΔQ| < tolerance.

Returns per-edge flow (gpm), pressure drop (psi), per-head
residual pressure, at-source required pressure + flow.

### 1.3 Hazen-Williams

Already landed: `hydraulic-system.ts` has
`hazenWilliamsLossPsiPerFt` + `pipeFrictionLossPsi`. Used by
Hardy Cross per-edge.

### 1.4 Equivalent lengths (fittings)

`packages/hf-core/src/hydraulic/equivalent-length.ts`:

Table from NFPA 13 Table 23.4.3.1.1:

```typescript
export const K_EQUIV_FT: Record<FittingStyle, Record<number, number>> = {
  // size_in → equivalent ft
  tee_flow_through:   { 1: 5, 1.25: 7, 1.5: 9, 2: 10, 2.5: 12, 3: 15, 4: 20, … },
  tee_branch:         { 1: 5, 1.25: 7, 1.5: 9, 2: 10, 2.5: 12, 3: 15, 4: 20, … },
  elbow_90_std:       { 1: 2, 1.25: 3, 1.5: 3, 2: 4, 2.5: 5, 3: 6, 4: 8, … },
  elbow_90_long:      { 1: 1, 1.25: 2, 1.5: 2, 2: 3, 2.5: 3, 3: 4, 4: 5, … },
  elbow_45:           { 1: 1, 1.25: 1, 1.5: 2, 2: 2, 2.5: 3, 3: 3, 4: 4, … },
  // gate valve open                             , butterfly open        , etc
}
```

### 1.5 Remote-area method (NFPA §19)

`packages/hf-core/src/hydraulic/remote-area.ts`:

```typescript
export function solveRemoteArea(
  design: Design,
  ra: RemoteArea,
): HydraulicSolution
```

Picks the 4 most hydraulically demanding heads inside `ra.polygon_m`
(furthest from riser by equivalent length) and balances flow
across them per density × coverage.

## 2. NFPA 13 rule check

### 2.1 Rule registry

`packages/hf-core/src/nfpa13/rule-check.ts`:

```typescript
export interface Rule {
  id: string                      // 'NFPA13_8.6.2.1.1'
  section: string                 // 'NFPA 13 §8.6.2.1.1'
  severity: 'error' | 'warning' | 'info'
  description: string
  check(design: Design): RuleViolation[]
}

export interface RuleViolation {
  rule_id: string
  severity: Rule['severity']
  message: string
  node_ids: string[]              // offending nodes
  quick_fix?: () => DesignEdit[]   // optional auto-fix
}
```

### 2.2 Rules v1.0

Minimum set for MVP. Expand per §N as hazard classes unlock.

| ID | Section | Description |
|---|---|---|
| SPACING_MAX | §8.6.2.2.1 | Max head spacing per hazard class |
| SPACING_MIN | §8.6.3 | Min 6 ft between heads (except specific exceptions) |
| WALL_DISTANCE_MAX | §8.6.3.1 | Head ≤ half spacing from wall |
| WALL_DISTANCE_MIN | §8.6.3.1 | Head ≥ 4 in from wall |
| DEFLECTOR_BELOW_CEILING | §8.6.4.1 | 1 in to 12 in below ceiling per orientation |
| OBSTRUCTION_3x | §8.5.5.1 | Head within 3x clearance of obstruction |
| ITV_REQUIRED | §8.17 | Every system has an Inspector's Test Valve |
| DRAIN_REQUIRED | §8.16 | Every system has a main drain |
| GAUGE_REQUIRED | §8.17.3.1 | Pressure gauge at each riser + alarm valve |
| HANGER_SPACING | §17.3.1 | Max hanger spacing per pipe size |
| HANGER_END_OF_LINE | §17.3.4 | Hanger within 3 ft of end of branch |
| SEISMIC_LATERAL_40FT | §18.5.2 | Lateral brace max 40 ft spacing |
| SEISMIC_LONGITUDINAL_80FT | §18.5.4 | Long. brace max 80 ft |
| FLOW_SAFETY_MARGIN | §23.4.4.6 | 10 psi safety margin vs supply |
| HAZARD_DENSITY | §19.2.3.1.1 | Sprinkler flow ≥ design density × area |
| FDC_HEIGHT | §8.17.2.4 | FDC 18-48 in above grade |
| FDC_DISTANCE_FROM_HYDRANT | NFPA 14 | FDC within 100 ft of hydrant |

### 2.3 Run modes

- **Live (on-edit):** only fast rules run (in-memory, no sidecar).
- **Full (F10):** every rule. Runs in background worker; result
  populates RuleCheckPanel with sortable + filterable list.
- **Pre-submittal:** blocks Export if any rule has severity=error.

## 3. Seismic (NFPA 13 Ch. 18)

`packages/hf-core/src/seismic/`:

- `lateral-brace.ts` — places lateral braces every ≤ 40 ft with
  max tributary load; computes required strut angle + strut size.
- `longitudinal-brace.ts` — same for longitudinal.
- `four-way-brace.ts` — at corners + changes of direction.
- `sway-load.ts` — horizontal seismic load = 0.5W (unrestrained)
  per §18.5.9; computes brace capacity.

Input: PipeNodes of the system, structural attachment targets
(beams/joists/columns from intake).
Output: HangerNode[] with `kind: 'seismic_sway_lateral'` etc.

## 4. Fire pump curve

`packages/hf-core/src/hydraulic/pump-curve.ts`:

```typescript
export interface PumpCurve {
  churn_psi: number          // shutoff
  rated_gpm: number
  rated_psi: number
  peak_gpm: number           // 150% rated flow
  peak_psi: number           // ≥ 65% rated at 150%
  listing: 'UL' | 'FM' | 'UL_FM'
}

export function combineCurves(
  supply: Supply,             // municipal (static + residual @ Q)
  pump: PumpCurve,
): (flow_gpm: number) => number  // returns available psi
```

Enables demand-vs-available-supply plot in hydraulic report.

## 5. Tank sizing (NFPA 22)

`packages/hf-core/src/hydraulic/tank-sizing.ts`:

```typescript
export function sizeGravityTank(design: Design): TankSpec
export function sizePressureTank(design: Design): TankSpec
```

Input: system demand + duration required (NFPA 13 Table
20.15.7.1). Output: tank volume (gal), elevation (ft), fill
rate, refill time.

## 6. TS ↔ Python mirror

### 6.1 Source of truth hierarchy

- `packages/hf-core/src/hydraulic/*.ts` — canonical.
- `services/halofire-cad/cad/core_mirror/hydraulic/*.py` —
  mirror. Identical math, identical fixture outputs.

### 6.2 Golden fixtures

`packages/hf-core/tests/golden/hydraulic/*.json`:

```json
{
  "name": "1881_floor_4_branch",
  "input": {
    "network": { "nodes": [...], "edges": [...] },
    "design": { "density_gpm_ft2": 0.10, "remote_area_ft2": 1500 },
    "supply": { "static_psi": 80, "residual_psi": 65, "flow_gpm": 1200 }
  },
  "expected": {
    "required_psi": 42.3,
    "sprinkler_flow_gpm": 150,
    "safety_margin_psi": 22.7,
    "passes": true,
    "per_edge_flow_gpm": { "pipe_123": 75, … }
  },
  "tolerance": 0.5
}
```

### 6.3 CI parity job

`.github/workflows/parity.yml` runs:
1. `vitest run --run packages/hf-core/tests/golden/`
2. `pytest services/halofire-cad/tests/test_parity_*.py`

Both read the same golden JSON. If either fails OR if they
produce values that differ > `tolerance`, CI fails.

Drift policy: fix in same commit. No "we'll fix it later" on
parity.

## 7. Tests

- Hardy Cross solver against published NFPA 13 Annex F example
  (known input → published answer).
- Hazen-Williams loss matches NFPA 13 Table tables within
  0.5 psi/100 ft.
- Every rule has a PASS fixture + FAIL fixture.
- Remote area solver against a known 4-head branch @ 0.10 gpm/ft².

## 8. Open questions

- Darcy-Weisbach alternative: NFPA allows it for high-viscosity
  antifreeze. Add as v1.5. Interface identical; switch via
  `design.friction_method`.
- Partial solves vs full solves: hot loop needs incremental
  (affected-system-only). Cold runs recompute all. Document
  the call-site boundary.
