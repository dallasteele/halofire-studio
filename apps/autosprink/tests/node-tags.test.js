/**
 * Golden known-answer tests for PER-NODE / PER-EDGE results (node tags + color-
 * by-condition feed) added to solveNetwork in this chunk.
 *
 * The node-pressure forward walk and per-edge velocity are derived from the SAME
 * Hazen-Williams physics already golden-tested in network-solve.test.js; here we
 * verify the per-element decomposition is internally consistent and matches a hand
 * calc on a single-riser network. If a number disagrees, the per-element solve is
 * wrong — fix it, do not relax the test.
 */
import { describe, expect, it } from 'vitest';
import {
  solveNetwork,
  hwLossPsiPerFt,
  velocityFps,
  kFactorFlow,
  MAX_VELOCITY_FPS,
} from '../src/engine/network-solve.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

describe('node tags: single vertical riser (hand calc)', () => {
  const cad = {
    solids: [
      { kind: 'pipe', name: 'riser', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
      { kind: 'head', name: 'H', position: [0, 0, 10], kFactor: 5.6 },
    ],
  };
  const r = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120, availablePsi: 65 });
  const Q = kFactorFlow(5.6, 7); // 14.8162 gpm

  it('reports exactly two nodes (source + remote head)', () => {
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.filter((n) => n.isSource)).toHaveLength(1);
    expect(r.nodes.filter((n) => n.isRemote)).toHaveLength(1);
  });

  it('source node pressure equals the required source pressure', () => {
    const src = r.nodes.find((n) => n.isSource);
    expect(near(src.pressurePsi, r.requiredPsi, 0.001)).toBe(true);
  });

  it('remote head node pressure = source − friction − elevation = minHead + Pv', () => {
    // source 11.371 − friction 0.0273 − elevation 4.33 = 7.014 = 7 (minHead) + 0.014 (Pv)
    const rem = r.nodes.find((n) => n.isRemote);
    const fric = hwLossPsiPerFt(Q, 2.067, 120) * 10;
    const elev = 0.433 * 10;
    expect(near(rem.pressurePsi, r.requiredPsi - fric - elev, 0.002)).toBe(true);
    expect(near(rem.pressurePsi, 7 + r.velocityPressurePsi, 0.002)).toBe(true);
  });

  it('node through-flow equals the head discharge Q=K√7 (conservation)', () => {
    for (const n of r.nodes) expect(near(n.flowGpm, Q, 0.01)).toBe(true);
    expect(r.conservationOk).toBe(true);
  });

  it('per-edge velocity matches v=0.4085·Q/d²', () => {
    expect(r.edgeResults).toHaveLength(1);
    const e = r.edgeResults[0];
    expect(near(e.velocityFps, velocityFps(Q, 2.067), 0.001)).toBe(true);
    expect(near(e.velocityFps, 1.417, 0.005)).toBe(true);
  });

  it('minNodePressure is the remote head pressure (lowest in the tree)', () => {
    expect(near(r.minNodePressurePsi, 7.014, 0.005)).toBe(true);
    expect(r.minNodePressureKey).toBe(r.nodes.find((n) => n.isRemote).key);
  });
});

describe('color-by-condition: over-velocity flag', () => {
  it('a fully-loaded 1" branch flags pipes over the 32 fps threshold', () => {
    const solids = [{ kind: 'pipe', name: 'feed', from: [-5, 0, 0], to: [0, 0, 0], diameterIn: 1.049 }];
    let x = 0;
    for (let i = 0; i < 30; i += 1) {
      const x2 = x + 5;
      solids.push({ kind: 'pipe', name: `s${i}`, from: [x, 0, 0], to: [x2, 0, 0], diameterIn: 1.049 });
      solids.push({ kind: 'head', name: `h${i}`, position: [x2, 0, 0], kFactor: 5.6 });
      x = x2;
    }
    const r = solveNetwork({ solids }, { minHeadPressurePsi: 7, C: 120 });
    expect(r.maxVelocityThresholdFps).toBe(MAX_VELOCITY_FPS);
    expect(r.maxVelocityFps).toBeGreaterThan(MAX_VELOCITY_FPS);
    // the highest-flow (feed) edge is over-velocity; some leaf legs are not
    const over = r.edgeResults.filter((e) => e.overVelocity);
    expect(over.length).toBeGreaterThan(0);
    expect(over.length).toBeLessThan(r.edgeResults.length);
    // the flagged max edge truly exceeds the threshold
    const maxEdge = r.edgeResults.find((e) => e.edge === r.maxVelocityEdge);
    expect(maxEdge.overVelocity).toBe(true);
    expect(maxEdge.velocityFps).toBe(r.maxVelocityFps);
  });

  it('a lightly-loaded network has NO over-velocity pipes', () => {
    const cad = {
      solids: [
        { kind: 'pipe', name: 'riser', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
        { kind: 'head', name: 'H', position: [0, 0, 10], kFactor: 5.6 },
      ],
    };
    const r = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120 });
    expect(r.edgeResults.every((e) => !e.overVelocity)).toBe(true);
    expect(r.maxVelocityFps).toBeLessThan(MAX_VELOCITY_FPS);
  });
});

describe('degenerate model exposes empty per-element arrays (honesty)', () => {
  it('no pipes/heads → empty nodes + edgeResults, null minNodePressure', () => {
    const r = solveNetwork({ solids: [] }, { minHeadPressurePsi: 7 });
    expect(r.nodes).toEqual([]);
    expect(r.edgeResults).toEqual([]);
    expect(r.minNodePressurePsi).toBe(null);
    expect(r.maxVelocityFps).toBe(0);
  });
});
