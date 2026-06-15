import { describe, expect, it } from 'vitest';
import {
  hwLossPsiPerFt,
  velocityFps,
  velocityPressurePsi,
  kFactorFlow,
  buildGraph,
  solveNetwork,
  solveWithUpsizing,
  nextSizeUp,
  SCHED40_ID,
} from '../src/engine/network-solve.js';
import { equivalentLengthFt, nominalSizeFor } from '../src/engine/fitting-le.js';

// ===========================================================================
// 🔬 GOLDEN known-answer tests. Every value below is hand-computed from the
// published NFPA-13 / Hazen-Williams formula and re-derived independently with
// node. If the solver disagrees, the SOLVER is wrong.
//
// NOTE ON THE CHUNK FIXTURE: the chunk spec cites "100gpm, C=120, 2" sch40 ->
// ~0.0479 psi/ft". That number is WRONG for d=2.067 (2" sch40 ID): the correct
// Hazen-Williams answer is 0.09390 psi/ft. We therefore golden-test against the
// mathematically correct value (and document the spec discrepancy in residual).
// The 0.0479 figure corresponds to roughly a 2.4"-2.5" ID, not 2" sch40.
// ===========================================================================

describe('hwLossPsiPerFt (hand-computed Hazen-Williams)', () => {
  it('100 gpm, 2.067in (2" sch40), C=120 -> 0.09390 psi/ft (NOT the spec 0.0479)', () => {
    expect(hwLossPsiPerFt(100, 2.067, 120)).toBeCloseTo(0.0938993, 6);
  });
  it('100 gpm, d=2.0, C=120 -> 0.1102448 psi/ft (matches existing engine fixture)', () => {
    expect(hwLossPsiPerFt(100, 2, 120)).toBeCloseTo(0.11024484, 7);
  });
  it('20 gpm, d=1, C=120 -> 0.16368253 psi/ft', () => {
    expect(hwLossPsiPerFt(20, 1, 120)).toBeCloseTo(0.16368253, 7);
  });
  it('the figure that DOES give ~0.0479 is ID ~2.4" (sanity on the spec error)', () => {
    // bracket: 2.323in -> 0.0532, 2.469in -> 0.0395; 0.0479 sits between
    expect(hwLossPsiPerFt(100, 2.323, 120)).toBeGreaterThan(0.0479);
    expect(hwLossPsiPerFt(100, 2.469, 120)).toBeLessThan(0.0479);
  });
  it('is 0 at 0 flow and monotonic in Q; falls with diameter', () => {
    expect(hwLossPsiPerFt(0, 2, 120)).toBe(0);
    expect(hwLossPsiPerFt(200, 2, 120)).toBeGreaterThan(hwLossPsiPerFt(100, 2, 120));
    expect(hwLossPsiPerFt(100, 4, 120)).toBeLessThan(hwLossPsiPerFt(100, 2, 120));
  });
});

describe('velocityFps / velocityPressurePsi (hand-computed)', () => {
  it('v = 0.4085*Q/d^2: 100 gpm, d=2 -> 10.2125 fps', () => {
    expect(velocityFps(100, 2)).toBeCloseTo(10.2125, 6);
  });
  it('Pv = 0.001123*Q^2/d^4: 100 gpm, d=2.067 -> 0.61519 psi', () => {
    expect(velocityPressurePsi(100, 2.067)).toBeCloseTo(0.6152022, 6);
  });
  it('Pv: 100 gpm, d=1.049 -> 9.27423 psi', () => {
    expect(velocityPressurePsi(100, 1.049)).toBeCloseTo(9.2742287, 5);
  });
});

describe('kFactorFlow Q = K*sqrt(P) (hand-computed)', () => {
  it('K=5.6 at 7 psi -> 14.81621 gpm', () => {
    expect(kFactorFlow(5.6, 7)).toBeCloseTo(14.8162073, 6);
  });
  it('K=5.6 at 20 psi -> 25.04396 gpm', () => {
    expect(kFactorFlow(5.6, 20)).toBeCloseTo(25.0439613, 6);
  });
  it('K=8.0 at 10 psi -> 25.29822 gpm', () => {
    expect(kFactorFlow(8.0, 10)).toBeCloseTo(25.2982213, 6);
  });
  it('returns 0 at non-positive pressure', () => {
    expect(kFactorFlow(5.6, 0)).toBe(0);
    expect(kFactorFlow(5.6, -5)).toBe(0);
  });
});

describe('fitting equivalent lengths (NFPA-13 Le table)', () => {
  it('snaps actual ID to nearest nominal', () => {
    expect(nominalSizeFor(2.067)).toBe(2);
    expect(nominalSizeFor(1.049)).toBe(1);
    expect(nominalSizeFor(3.068)).toBe(3);
    expect(nominalSizeFor(6.065)).toBe(6);
  });
  it('2" 90 elbow = 5 ft, 2" tee-branch = 10 ft at C=120', () => {
    expect(equivalentLengthFt('elbow90', 2.067, 120)).toBeCloseTo(5, 6);
    expect(equivalentLengthFt('teeBranch', 2.067, 120)).toBeCloseTo(10, 6);
  });
  it('scales by (C/120)^1.852 for non-120 C', () => {
    // C=100 -> mult = (100/120)^1.852 = 0.7124; 2" elbow 5ft -> 3.562 ft
    expect(equivalentLengthFt('elbow90', 2.067, 100)).toBeCloseTo(5 * Math.pow(100 / 120, 1.852), 6);
  });
  it('unknown fitting -> 0 (fail-soft)', () => {
    expect(equivalentLengthFt('nope', 2, 120)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN end-to-end: a hand-buildable 2-head branch where we can compute the
// demand and required pressure entirely by hand, then assert the solver matches.
// ---------------------------------------------------------------------------
describe('solveNetwork — hand-verifiable 2-head branch', () => {
  // Topology mirroring a real generated model (a floor source + horizontal run):
  //   SOURCE(0,0,0) is the floor node (lowest Z, the riser base).
  //   SOURCE --10ft, 2.067", horizontal at z=0--> N1(10,0,0) [head A, K=5.6]
  //   N1     --10ft, 2.067", horizontal at z=0--> N2(20,0,0) [head B, K=5.6]
  // All pipes are at z=0 so there is NO elevation head; all pipes are >= 6ft so
  // leaf fitting-Le is skipped -> pure friction, fully hand-computable.
  // Heads seed at minHead=7 psi. Each head Q = 5.6*sqrt(7) = 14.816207 gpm.
  // demand = 2 * 14.816207 = 29.632415 gpm (all arrives at source).
  // SOURCE is the lowest-Z, highest-degree floor node -> remote head = N2.
  // Path SOURCE->N2 carries:
  //   pipe SOURCE->N1 carries A + B       = 29.632415 gpm
  //   pipe N1->N2     carries head B only = 14.816207 gpm
  const k = 5.6;
  const minHead = 7;
  const dia = 2.067;
  const qHead = k * Math.sqrt(minHead);
  const demand = 2 * qHead;
  const fSeg1 = hwLossPsiPerFt(demand, dia, 120) * 10; // source->N1, both heads
  const fSeg2 = hwLossPsiPerFt(qHead, dia, 120) * 10;  // N1->N2, head B only
  const friction = fSeg1 + fSeg2;
  const pv = velocityPressurePsi(qHead, dia);
  const expectedReq = minHead + friction + pv;

  // Give the SOURCE node degree 2 (a stub floor leg) so findSourceNode prefers it
  // over the head junctions. A real model's riser base is exactly this.
  const cad = {
    solids: [
      { kind: 'pipe', name: 'feed', from: [-5, 0, 0], to: [0, 0, 0], diameterIn: dia },
      { kind: 'pipe', name: 'b-seg1', from: [0, 0, 0], to: [10, 0, 0], diameterIn: dia },
      { kind: 'pipe', name: 'b-seg2', from: [10, 0, 0], to: [20, 0, 0], diameterIn: dia },
      { kind: 'head', name: 'A', position: [10, 0, 0], kFactor: k },
      { kind: 'head', name: 'B', position: [20, 0, 0], kFactor: k },
    ],
  };
  const r = solveNetwork(cad, { minHeadPressurePsi: minHead, C: 120 });

  it('demand = sum of head flows (conservation)', () => {
    expect(r.demandGpm).toBeCloseTo(demand, 2);
    expect(r.headsTotal).toBe(2);
    expect(r.headsFlowing).toBe(2);
  });
  it('flow conservation passes at every node', () => {
    expect(r.conservationOk).toBe(true);
  });
  it('the inner pipe carries both heads; the remote leaf carries head B only', () => {
    const flows = r.worstPath.map((s) => s.flowGpm);
    // path is source-ordered: b-seg1 (both heads) first, b-seg2 (one head) last
    expect(flows[flows.length - 1]).toBeCloseTo(qHead, 1);
    expect(Math.max(...flows)).toBeCloseTo(demand, 1);
  });
  it('required source pressure matches the hand calc (friction + Pv + minHead)', () => {
    expect(r.requiredPsi).toBeCloseTo(expectedReq, 1);
  });
  it('reports the honest engineering-aid disclaimer + not Hardy-Cross balanced', () => {
    expect(r.hardyCrossBalanced).toBe(false);
    expect(r.disclaimer).toMatch(/ENGINEERING AID/);
    expect(r.disclaimer).toMatch(/NOT.*Hardy-Cross/);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN: fitting equivalent length AGGREGATE wired into the friction calc.
// A short remote leaf (< 6 ft) makes the solver add a tee-branch + 90° elbow Le
// to that segment; we hand-verify both the aggregate fittingLe.{totalEquivFt,
// byType} and that the friction it produced equals the hand calc with the Le.
// ---------------------------------------------------------------------------
describe('solveNetwork — fitting Le wired into friction + exposed as aggregate', () => {
  const k = 5.6;
  const minHead = 7;
  const dia = 2.067;          // 2" sched-40 -> nominal 2"
  const qHead = k * Math.sqrt(minHead);
  // SOURCE(-5,0,0)->(0,0,0) feed (5 ft), then a long carrier to N1, then a SHORT
  // (3 ft, < 6) leaf to the remote head N2 so its Le is applied.
  const carrierLen = 10;      // source-junction leg, >= 6 ft -> NO Le
  const leafLen = 3;          // remote leaf, < 6 ft -> tee-branch + elbow90 Le
  const cad = {
    solids: [
      { kind: 'pipe', name: 'feed', from: [-5, 0, 0], to: [0, 0, 0], diameterIn: dia },
      { kind: 'pipe', name: 'carrier', from: [0, 0, 0], to: [carrierLen, 0, 0], diameterIn: dia },
      { kind: 'pipe', name: 'leaf', from: [carrierLen, 0, 0], to: [carrierLen + leafLen, 0, 0], diameterIn: dia },
      { kind: 'head', name: 'A', position: [carrierLen, 0, 0], kFactor: k },
      { kind: 'head', name: 'B', position: [carrierLen + leafLen, 0, 0], kFactor: k },
    ],
  };
  const r = solveNetwork(cad, { minHeadPressurePsi: minHead, C: 120 });

  // Hand calc: only the remote LEAF (3 ft, carries head B = qHead) is < 6 ft, so
  // it gets Le = teeBranch(2") + elbow90(2") = 10 + 5 = 15 ft at C=120.
  const leTee = equivalentLengthFt('teeBranch', dia, 120);   // 10
  const leElbow = equivalentLengthFt('elbow90', dia, 120);   // 5
  const expectedTotalLe = leTee + leElbow;                   // 15

  it('aggregate fittingLe.totalEquivFt = tee-branch + elbow90 at 2" = 15 ft', () => {
    expect(leTee).toBeCloseTo(10, 6);
    expect(leElbow).toBeCloseTo(5, 6);
    expect(r.fittingLe.totalEquivFt).toBeCloseTo(expectedTotalLe, 3);
  });
  it('fittingLe.byType breaks out one teeBranch + one elbow90 with their Le', () => {
    expect(r.fittingLe.byType.teeBranch).toEqual({ count: 1, equivFt: 10 });
    expect(r.fittingLe.byType.elbow90).toEqual({ count: 1, equivFt: 5 });
  });
  it('the Le actually entered the friction calc (effLen = 3 + 15 = 18 ft on the leaf)', () => {
    // remote leaf segment is the last worstPath entry; its fittingLeFt is 15 and
    // its friction = hwLoss(qHead) * (3 + 15).
    const leaf = r.worstPath[r.worstPath.length - 1];
    expect(leaf.fittingLeFt).toBeCloseTo(15, 2);
    const expectedLeafFriction = hwLossPsiPerFt(qHead, dia, 120) * (leafLen + expectedTotalLe);
    expect(leaf.frictionPsi).toBeCloseTo(expectedLeafFriction, 3);
  });
  it('the full required-psi friction includes the leaf Le (vs. a no-Le hand calc)', () => {
    const demand = 2 * qHead;
    const fCarrier = hwLossPsiPerFt(demand, dia, 120) * carrierLen;          // >=6ft, no Le
    const fLeafWithLe = hwLossPsiPerFt(qHead, dia, 120) * (leafLen + expectedTotalLe);
    const expectedFriction = fCarrier + fLeafWithLe;
    expect(r.frictionLossPsi).toBeCloseTo(expectedFriction, 2);
  });
});

describe('solveNetwork — elevation head adds 0.433 psi/ft', () => {
  // single head raised 10 ft above the source on one vertical-ish pipe.
  const cad = {
    solids: [
      { kind: 'pipe', name: 'riser', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
      { kind: 'head', name: 'H', position: [0, 0, 10], kFactor: 5.6 },
    ],
  };
  const r = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120 });
  it('elevation component ≈ 0.433 * 10 = 4.33 psi', () => {
    expect(r.elevationPsi).toBeCloseTo(4.33, 2);
  });
  it('required psi includes the elevation lift', () => {
    expect(r.requiredPsi).toBeGreaterThan(7 + 4.0);
  });
});

describe('iterative upsizing', () => {
  it('nextSizeUp walks the sched-40 ladder', () => {
    expect(nextSizeUp(1.049)).toBeCloseTo(1.380, 3);
    expect(nextSizeUp(2.067)).toBeCloseTo(2.469, 3);
    expect(nextSizeUp(SCHED40_ID[SCHED40_ID.length - 1])).toBeNull();
  });

  it('upsizes an undersized branch until demand is met', () => {
    // Force a big demand through tiny 1" pipe with a low available supply so the
    // base solve fails, then verify upsizing grows pipes and meets demand.
    const heads = [];
    const solids = [];
    let x = 0;
    // 12 heads on a long 1.049" branch — high friction, will need upsizing
    for (let i = 0; i < 12; i += 1) {
      const x2 = x + 8;
      solids.push({ kind: 'pipe', name: `seg-${i}`, from: [x, 0, 0], to: [x2, 0, 0], diameterIn: 1.049 });
      solids.push({ kind: 'head', name: `h-${i}`, position: [x2, 0, 0], kFactor: 5.6 });
      x = x2;
    }
    const cad = { solids };
    const avail = 60;
    const base = solveNetwork(cad, { minHeadPressurePsi: 7, availablePsi: avail });
    expect(base.demandMet).toBe(false); // 1" can't carry 12 heads within 60 psi

    const out = solveWithUpsizing(cad, { minHeadPressurePsi: 7, availablePsi: avail, maxIterations: 40 });
    expect(out.upsized.length).toBeGreaterThan(0);
    // final required pressure must be lower than the base (bigger pipe = less loss)
    expect(out.final.requiredPsi).toBeLessThan(base.requiredPsi);
    // original model is untouched (pure)
    expect(cad.solids.find((s) => s.kind === 'pipe').diameterIn).toBeCloseTo(1.049, 3);
  });

  it('leaves an already-adequate network unchanged', () => {
    const cad = {
      solids: [
        { kind: 'pipe', name: 's1', from: [0, 0, 0], to: [10, 0, 0], diameterIn: 4.026 },
        { kind: 'head', name: 'h', position: [10, 0, 0], kFactor: 5.6 },
      ],
    };
    const out = solveWithUpsizing(cad, { minHeadPressurePsi: 7, availablePsi: 100 });
    expect(out.met).toBe(true);
    expect(out.upsized).toHaveLength(0);
    expect(out.iterations).toBe(0);
  });
});

describe('interior-tap connectivity (regression — the 1230-heads-solved-as-2 bug)', () => {
  // A long branch line (one un-split segment) with drops tapping its INTERIOR,
  // plus a feed leg into the branch's far end as the source. The drops' tap nodes
  // do NOT coincide with the branch endpoints, so without interior-tap splitting
  // the graph fragments and only the feed-adjacent heads get counted.
  const k = 5.6;
  function model(nHeads) {
    const solids = [
      { kind: 'pipe', name: 'feed', from: [-5, 0, 0], to: [0, 0, 0], diameterIn: 3.068 },
      { kind: 'pipe', name: 'branch', from: [0, 0, 0], to: [nHeads * 5, 0, 0], diameterIn: 2.067 },
    ];
    for (let i = 1; i <= nHeads; i += 1) {
      const x = i * 5;
      // drop taps the branch INTERIOR at [x,0,0] then drops to head at [x,0,-1]
      solids.push({ kind: 'pipe', name: `drop-${i}`, from: [x, 0, 0], to: [x, 0, -1], diameterIn: 1.049 });
      solids.push({ kind: 'head', name: `h-${i}`, position: [x, 0, -1], kFactor: k });
    }
    return { solids };
  }
  it('counts ALL heads (demand = N * K√7), not just the ones at a branch endpoint', () => {
    const N = 10;
    const r = solveNetwork(model(N), { minHeadPressurePsi: 7, C: 120 });
    const perHead = k * Math.sqrt(7);
    expect(r.headsTotal).toBe(N);
    expect(r.headsFlowing).toBe(N);
    expect(r.demandGpm).toBeCloseTo(N * perHead, 0); // all N heads reach the source
    expect(r.conservationOk).toBe(true);
  });
  it('the branch carrier accumulates every downstream drop (conservation holds)', () => {
    const r = solveNetwork(model(6), { minHeadPressurePsi: 7, C: 120 });
    // ALL 6 heads' flow arrives at the source (demand), proving the interior taps
    // welded the whole branch into one connected component.
    expect(r.demandGpm).toBeCloseTo(6 * k * Math.sqrt(7), 0);
    expect(r.conservationOk).toBe(true);
    // the remote path's leaf segment carries exactly the most-remote head's flow
    expect(r.worstPath[r.worstPath.length - 1].flowGpm).toBeCloseTo(k * Math.sqrt(7), 0);
  });
});

describe('remote-area subset (NFPA design-basis hook)', () => {
  it('flows only the heads the predicate selects', () => {
    const solids = [];
    let x = 0;
    for (let i = 0; i < 10; i += 1) {
      const x2 = x + 6;
      solids.push({ kind: 'pipe', name: `s-${i}`, from: [x, 0, 0], to: [x2, 0, 0], diameterIn: 2.067 });
      solids.push({ kind: 'head', name: `h-${i}`, position: [x2, 0, 0], kFactor: 5.6 });
      x = x2;
    }
    const cad = { solids };
    const all = solveNetwork(cad, { minHeadPressurePsi: 7 });
    // flow only the 3 most-remote heads (x >= 48)
    const subset = solveNetwork(cad, { minHeadPressurePsi: 7, flowingHeads: (h) => h.position[0] >= 48 });
    expect(all.headsFlowing).toBe(10);
    expect(subset.headsFlowing).toBe(3);
    expect(subset.demandGpm).toBeCloseTo(3 * 5.6 * Math.sqrt(7), 0);
    expect(subset.demandGpm).toBeLessThan(all.demandGpm);
    expect(all.designBasis).toBe('all-heads-open');
    expect(subset.designBasis).toBe('remote-area-subset');
  });
});

describe('buildGraph over real cadModel solids', () => {
  it('builds nodes/edges and attaches heads to their node', () => {
    const cad = {
      solids: [
        { kind: 'pipe', from: [0, 0, 0], to: [10, 0, 0], diameterIn: 2 },
        { kind: 'head', position: [10, 0, 0], kFactor: 5.6 },
      ],
    };
    const g = buildGraph(cad);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.size).toBe(2);
    let headNodes = 0;
    for (const n of g.nodes.values()) if (n.heads.length) headNodes += 1;
    expect(headNodes).toBe(1);
  });
});
