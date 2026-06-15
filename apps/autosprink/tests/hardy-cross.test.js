import { describe, expect, it } from 'vitest';
import {
  pipeResistance,
  headLoss,
  findLoops,
  hardyCross,
  analyzeGraphLoops,
  HW_EXP,
  HW_CONST,
} from '../src/engine/hardy-cross.js';
import { buildGraph } from '../src/engine/network-solve.js';

// ===========================================================================
// 🔬 GOLDEN known-answer tests for the Hardy-Cross loop/grid balance.
//
// The TEXTBOOK 2-loop network used below has its converged flows derived
// INDEPENDENTLY by Newton's method on the two loop-energy residuals (a global
// 2x2 Jacobian solve) — algebraically distinct from the module's per-loop
// Gauss-Seidel sweep. So when the per-loop solver lands on the same numbers, two
// independent methods agree on the answer. The derivation script lives in the
// session notes; the converged values are hard-coded here as the golden truth.
//
// Network (A = supply, C = sole withdrawal of 100 gpm; B, D interior junctions):
//   1: A->B   2: B->C   3: A->D   4: D->C   5: B->D (the bridge between the loops)
//   Loop I  = A->B->D->A     Loop II = B->C->D->B
//
// Two golden fixtures:
//   (a) clean r·Q^1.852 resistances r=[1,2,2,1,3]  -> symmetric flows
//   (b) REAL Hazen-Williams resistances from length/diameter (pipeResistance)
// ===========================================================================

const TWO_LOOP_R = [
  { from: 'A', to: 'B', r: 1.0 },
  { from: 'B', to: 'C', r: 2.0 },
  { from: 'A', to: 'D', r: 2.0 },
  { from: 'D', to: 'C', r: 1.0 },
  { from: 'B', to: 'D', r: 3.0 }, // bridge
];
const DEMANDS = { A: -100, B: 0, C: 100, D: 0 };

// Newton-derived converged flows (gpm) for the r=[1,2,2,1,3] / n=1.852 network.
const GOLDEN_R = {
  'A->B': 56.745241,
  'B->C': 43.254759,
  'A->D': 43.254759,
  'D->C': 56.745241,
  'B->D': 13.490482,
};

// Newton-derived converged flows for the REAL Hazen-Williams network:
//   1: L100 d6   2: L150 d4   3: L150 d4   4: L100 d6   5: L120 d3
const TWO_LOOP_HW = [
  { from: 'A', to: 'B', length: 100, diameterIn: 6 },
  { from: 'B', to: 'C', length: 150, diameterIn: 4 },
  { from: 'A', to: 'D', length: 150, diameterIn: 4 },
  { from: 'D', to: 'C', length: 100, diameterIn: 6 },
  { from: 'B', to: 'D', length: 120, diameterIn: 3 },
];
const GOLDEN_HW = {
  'A->B': 59.556822,
  'B->C': 40.443178,
  'A->D': 40.443178,
  'D->C': 59.556822,
  'B->D': 19.113644,
};

const flowMap = (res) => {
  const m = {};
  for (const f of res.flows) m[`${f.from}->${f.to}`] = f.Q;
  return m;
};

describe('Hazen-Williams pipe resistance (h_f = r·Q^1.852)', () => {
  it('constants are the published HW values (n=1.852, K=4.52)', () => {
    expect(HW_EXP).toBe(1.852);
    expect(HW_CONST).toBe(4.52);
  });
  it('r for 1 ft of 2.067in (2" sch40) C=120 equals hwLossPsiPerFt at 1 gpm·foot basis', () => {
    // r·1^1.852 = r ; and r = 4.52·1 / (120^1.852 · 2.067^4.8704)
    const r = pipeResistance(1, 2.067, 120);
    const expected = (4.52) / (Math.pow(120, 1.852) * Math.pow(2.067, 4.8704));
    expect(r).toBeCloseTo(expected, 12);
  });
  it('head loss is signed by flow direction', () => {
    const r = pipeResistance(100, 4, 120);
    expect(headLoss(r, 50)).toBeCloseTo(-headLoss(r, -50), 9);
    expect(headLoss(r, 0)).toBe(0);
  });
  it('100 gpm over 100 ft of 6in C=120 — independent hand value', () => {
    // h_f = 4.52·100 / (120^1.852·6^4.8704) · 100^1.852
    const r = pipeResistance(100, 6, 120);
    const hf = Math.abs(headLoss(r, 100));
    const hand = (4.52 * 100 / (Math.pow(120, 1.852) * Math.pow(6, 4.8704))) * Math.pow(100, 1.852);
    expect(hf).toBeCloseTo(hand, 6);
  });
});

describe('findLoops — cycle-space identification', () => {
  it('2-loop network has cyclomatic number 2 (E−N+components)', () => {
    const fl = findLoops(TWO_LOOP_R, ['A', 'B', 'C', 'D']);
    expect(fl.components).toBe(1);
    expect(fl.cyclomatic).toBe(5 - 4 + 1); // = 2
    expect(fl.loops.length).toBe(2);
  });
  it('a pure tree has zero loops (cyclomatic 0)', () => {
    const tree = [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'B', to: 'D' },
    ];
    const fl = findLoops(tree, ['A', 'B', 'C', 'D']);
    expect(fl.loops.length).toBe(0);
    expect(fl.cyclomatic).toBe(0);
  });
  it('a single triangle is exactly one loop', () => {
    const tri = [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
    ];
    const fl = findLoops(tri, ['A', 'B', 'C']);
    expect(fl.loops.length).toBe(1);
    expect(fl.loops[0].length).toBe(3);
  });
  it('two disconnected components count separately', () => {
    const g = [
      { from: 'A', to: 'B' }, { from: 'C', to: 'D' },
    ];
    const fl = findLoops(g, ['A', 'B', 'C', 'D']);
    expect(fl.components).toBe(2);
    expect(fl.cyclomatic).toBe(2 - 4 + 2); // 0
    expect(fl.loops.length).toBe(0);
  });
});

describe('Hardy-Cross 2-loop GOLDEN (clean r=[1,2,2,1,3])', () => {
  const res = hardyCross(
    { edges: TWO_LOOP_R.map((e, i) => ({ ...e, Q0: [50, 50, 50, 50, 0][i] })), demands: DEMANDS },
    { tol: 1e-10, maxIterations: 500 },
  );
  it('reports loopCount 2', () => {
    expect(res.loopCount).toBe(2);
    expect(res.cyclomatic).toBe(2);
  });
  it('CONVERGES (Σh_f → 0 around every loop)', () => {
    expect(res.converged).toBe(true);
    expect(res.maxResidual).toBeLessThan(1e-9);
  });
  it('continuity ΣQ=0 at every node (nodeImbalance ~ 0)', () => {
    expect(res.nodeImbalance).toBeLessThan(1e-6);
  });
  it.each(Object.entries(GOLDEN_R))('flow %s matches Newton-derived golden', (key, want) => {
    expect(flowMap(res)[key]).toBeCloseTo(want, 3);
  });
  it('the two loop head-loss sums are each ~0 (energy law)', () => {
    for (const r of res.loopResiduals) expect(r).toBeLessThan(1e-9);
  });
});

describe('Hardy-Cross 2-loop GOLDEN (real Hazen-Williams, demand-seeded)', () => {
  // No Q0 supplied: the solver SEEDS a continuity-satisfying flow from `demands`
  // via the spanning tree, then balances. Tests both seeding + balance.
  const res = hardyCross({ edges: TWO_LOOP_HW, demands: DEMANDS }, { tol: 1e-9, maxIterations: 500 });
  it('converges with loopCount 2 and perfect continuity', () => {
    expect(res.loopCount).toBe(2);
    expect(res.converged).toBe(true);
    expect(res.maxResidual).toBeLessThan(1e-8);
    expect(res.nodeImbalance).toBeLessThan(1e-6);
  });
  it.each(Object.entries(GOLDEN_HW))('flow %s matches Newton-derived golden', (key, want) => {
    expect(flowMap(res)[key]).toBeCloseTo(want, 3);
  });
  it('symmetry: pipe A->B == pipe D->C, A->D == B->C (network is symmetric)', () => {
    const m = flowMap(res);
    expect(m['A->B']).toBeCloseTo(m['D->C'], 4);
    expect(m['A->D']).toBeCloseTo(m['B->C'], 4);
  });
});

describe('Hardy-Cross honesty: a pure TREE is reported as loopCount 0', () => {
  it('tree returns loopCount 0, converged true, residual 0 (nothing to balance)', () => {
    const res = hardyCross({
      edges: [
        { from: 'A', to: 'B', length: 50, diameterIn: 4 },
        { from: 'B', to: 'C', length: 50, diameterIn: 3 },
        { from: 'B', to: 'D', length: 50, diameterIn: 3 },
      ],
      demands: { A: -60, B: 0, C: 30, D: 30 },
    }, {});
    expect(res.loopCount).toBe(0);
    expect(res.converged).toBe(true);
    expect(res.maxResidual).toBe(0);
    expect(res.iterations).toBe(0);
    expect(res.nodeImbalance).toBeLessThan(1e-6);
  });
});

describe('analyzeGraphLoops over a network-solve graph', () => {
  it('a generated TREE model is honestly reported as loopCount 0 / isTree', () => {
    // small linear branch: 3 pipes end-to-end + heads (a tree).
    const solids = [];
    let x = 0;
    for (let i = 0; i < 3; i += 1) {
      const x2 = x + 8;
      solids.push({ kind: 'pipe', name: `seg-${i}`, from: [x, 0, 0], to: [x2, 0, 0], diameterIn: 1.049 });
      solids.push({ kind: 'head', name: `h-${i}`, position: [x2, 0, 0], kFactor: 5.6 });
      x = x2;
    }
    const graph = buildGraph({ solids });
    const a = analyzeGraphLoops(graph);
    expect(a.loopCount).toBe(0);
    expect(a.isTree).toBe(true);
    expect(a.converged).toBe(true);
    expect(a.maxResidual).toBe(0);
  });

  it('a gridded model (loop in the mains) is detected as loopCount >= 1', () => {
    // square loop of 4 pipes -> 1 fundamental loop.
    const solids = [
      { kind: 'pipe', name: 'm1', from: [0, 0, 10], to: [20, 0, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm2', from: [20, 0, 10], to: [20, 20, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm3', from: [20, 20, 10], to: [0, 20, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm4', from: [0, 20, 10], to: [0, 0, 10], diameterIn: 4 },
      { kind: 'head', name: 'h', position: [20, 0, 10], kFactor: 5.6 },
    ];
    const graph = buildGraph({ solids });
    const a = analyzeGraphLoops(graph);
    expect(a.loopCount).toBeGreaterThanOrEqual(1);
    expect(a.isTree).toBe(false);
    expect(a.cyclomatic).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 🔬 GOLDEN/LIVE: analyzeGraphLoops now WIRES the live demand into Hardy-Cross —
// it derives each flowing head's Q=K√P as a nodal outflow (supply balances) and
// iterates the looped graph to Σh_f→0. These tests prove the live loop CONVERGES
// (maxResidual small) and flips hardyCrossBalanced true — the gap this chunk closes.
// ===========================================================================
describe('analyzeGraphLoops — live looped model CONVERGES (Hardy-Cross wired in)', () => {
  // A square loop fed at one corner (supply, low Z) with a head drawing at the
  // OPPOSITE corner. Flow splits two ways around the loop; Hardy-Cross balances it.
  //   supply S at (0,0,0); the loop mains sit at Z=0; head H at the far corner.
  // Square loop of 4 mains at Z=10 + a riser DROP from the supply (Z=0, the network
  // floor → source) up to one loop corner. The drop is a real distinct edge (not a
  // degenerate self-loop), so the graph has exactly ONE fundamental loop (the
  // square). Head draws at the diagonally opposite corner.
  const grid = (kFactor = 5.6) => ({
    solids: [
      // riser drop: supply S(z=0) -> loop corner A(z=10)
      { kind: 'pipe', name: 'riser', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 6 },
      // square loop in the mains (4 edges) at z=10
      { kind: 'pipe', name: 'm1', from: [0, 0, 10], to: [40, 0, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm2', from: [40, 0, 10], to: [40, 40, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm3', from: [40, 40, 10], to: [0, 40, 10], diameterIn: 4 },
      { kind: 'pipe', name: 'm4', from: [0, 40, 10], to: [0, 0, 10], diameterIn: 4 },
      // a head drawing at the far corner of the loop
      { kind: 'head', name: 'h-far', position: [40, 40, 10], kFactor },
    ],
  });

  it('balances the live loop: converged true, maxResidual tiny, hardyCrossBalanced true', () => {
    const graph = buildGraph(grid());
    const a = analyzeGraphLoops(graph, { tol: 1e-9, maxIterations: 500 });
    expect(a.loopCount).toBe(1);                // exactly the square loop
    expect(a.isTree).toBe(false);
    expect(a.converged).toBe(true);
    expect(a.maxResidual).toBeLessThan(1e-6);   // Σh_f around every loop ~ 0
    expect(a.nodeImbalance).toBeLessThan(1e-6); // ΣQ = 0 at every node
    expect(a.hardyCrossBalanced).toBe(true);
  });

  it('assigns the head K√P as the live demand (Q = K·√7 at min operating pressure)', () => {
    const K = 5.6;
    const graph = buildGraph(grid(K));
    const a = analyzeGraphLoops(graph, { minHeadPressurePsi: 7 });
    expect(a.flowingHeads).toBe(1);
    // one head -> total demand = K·√7
    expect(a.demandGpm).toBeCloseTo(K * Math.sqrt(7), 3);
  });

  it('per-edge converged flows are returned and split around the symmetric loop', () => {
    const graph = buildGraph(grid());
    const a = analyzeGraphLoops(graph, { tol: 1e-10, maxIterations: 800 });
    expect(Array.isArray(a.flows)).toBe(true);
    expect(a.flows.length).toBe(5); // riser + 4 loop mains
    // The riser carries the FULL demand (14.816 gpm = K√7); the square loop is
    // symmetric about the supply-corner→head-corner diagonal, so the two loop
    // paths each carry HALF (7.408 gpm). Hand-verified.
    const demand = 5.6 * Math.sqrt(7);
    const riser = a.flows.find((f) => Math.abs(Math.abs(f.Q) - demand) < 1e-3);
    expect(riser).toBeDefined();
    const loopMains = a.flows.filter((f) => f !== riser);
    expect(loopMains.length).toBe(4);
    for (const f of loopMains) {
      expect(Math.abs(f.Q)).toBeCloseTo(demand / 2, 3); // symmetric 50/50 split
    }
  });

  it('a pure tree model reports loopCount 0 AND hardyCrossBalanced true (trivially)', () => {
    const solids = [];
    let x = 0;
    for (let i = 0; i < 3; i += 1) {
      const x2 = x + 8;
      solids.push({ kind: 'pipe', name: `seg-${i}`, from: [x, 0, 0], to: [x2, 0, 0], diameterIn: 1.049 });
      solids.push({ kind: 'head', name: `h-${i}`, position: [x2, 0, 0], kFactor: 5.6 });
      x = x2;
    }
    const a = analyzeGraphLoops(buildGraph({ solids }));
    expect(a.loopCount).toBe(0);
    expect(a.isTree).toBe(true);
    expect(a.converged).toBe(true);
    expect(a.hardyCrossBalanced).toBe(true);
    expect(a.maxResidual).toBe(0);
  });
});

describe('honesty disclaimer', () => {
  it('every result carries the ENGINEERING AID disclaimer (not PE/AHJ stamped)', () => {
    const res = hardyCross({ edges: TWO_LOOP_R.map((e, i) => ({ ...e, Q0: [50, 50, 50, 50, 0][i] })), demands: DEMANDS }, {});
    expect(res.disclaimer).toMatch(/ENGINEERING AID/);
    expect(res.disclaimer).toMatch(/NOT PE-stamped/);
    expect(res.disclaimer).toMatch(/Hardy-Cross/);
  });
});
