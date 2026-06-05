import { describe, expect, it } from 'vitest';
import {
  placeSupports,
  maxHangerSpacingFt,
  SEISMIC_BRACE_INTERVAL_FT,
  SUPPORTS_NOTE,
} from '../src/engine/supports.js';
import { buildRoomCad } from '../src/engine/cad-model.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// Build a minimal cad-model-shaped object with hand-placed pipe solids so the
// hanger/brace counts are exactly hand-verifiable.
const horizPipe = (name, role, len, dia) => ({
  kind: 'pipe', name, role, diameterIn: dia,
  from: [0, 0, 10], to: [len, 0, 10], // horizontal along X at z=10
});

describe('maxHangerSpacingFt (NFPA-13 max hanger spacing by nominal size)', () => {
  it('small pipe (<=1.25") hangs at 12 ft, larger pipe at 15 ft', () => {
    expect(maxHangerSpacingFt(1.0)).toBe(12);
    expect(maxHangerSpacingFt(1.25)).toBe(12);
    expect(maxHangerSpacingFt(1.5)).toBe(15);
    expect(maxHangerSpacingFt(2.0)).toBe(15);
    expect(maxHangerSpacingFt(3.5)).toBe(15);
    expect(maxHangerSpacingFt(4.0)).toBe(15);
    expect(maxHangerSpacingFt(6.0)).toBe(15);
  });
});

describe('placeSupports — hand-counted hanger placement', () => {
  it('a 30 ft 2" branch -> 3 hangers (ends at 0 & 30 + ceil(30/15)-1 interior at 15)', () => {
    // spacing for 2" = 15 ft. interior division points: ceil(30/15)=2 segments
    // -> one interior node at 15 ft; plus an end hanger within ~1ft of each end
    // (0 and 30). Offsets {0,15,30} => 3 hangers. No span exceeds 15 ft.
    const cad = { solids: [horizPipe('branch-0', 'branch', 30, 2.0)] };
    const out = placeSupports(cad);
    expect(out.counts.hangers).toBe(3);
    expect(out.hangers.map((h) => h.position[0])).toEqual([0, 15, 30]);
    // every hanger references its pipe + size + role
    expect(out.hangers.every((h) => h.pipe === 'branch-0' && h.role === 'hanger')).toBe(true);
    expect(out.hangers.every((h) => h.diameterIn === 2.0 && h.spacingFt === 15)).toBe(true);
    // no consecutive gap exceeds the 15 ft max spacing
    const xs = out.hangers.map((h) => h.position[0]);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(15);
  });

  it('a 12 ft 1" branch -> ends only (0 & 12), one span = 12 ft = max spacing', () => {
    // spacing for 1" = 12 ft. ceil(12/12)=1 -> no interior node; ends {0,12}.
    const cad = { solids: [horizPipe('branch-1', 'branch', 12, 1.0)] };
    const out = placeSupports(cad);
    expect(out.counts.hangers).toBe(2);
    expect(out.hangers.map((h) => h.position[0])).toEqual([0, 12]);
  });

  it('clamps to at least one hanger per run for a tiny run', () => {
    const cad = { solids: [horizPipe('branch-x', 'branch', 0.5, 1.5)] };
    const out = placeSupports(cad);
    expect(out.counts.hangers).toBeGreaterThanOrEqual(1);
  });

  it('hangs nothing for a zero-pipe model', () => {
    const out = placeSupports({ solids: [] });
    expect(out.counts.hangers).toBe(0);
    expect(out.counts.braces).toBe(0);
  });

  it('does NOT hang vertical drops or risers (only horizontal runs)', () => {
    const cad = {
      solids: [
        { kind: 'pipe', name: 'drop-1', role: 'drop', diameterIn: 1.0, from: [5, 0, 10], to: [5, 0, 8] },
        { kind: 'pipe', name: 'riser-1', role: 'riser', diameterIn: 2.5, from: [0, 0, 0], to: [0, 0, 12] },
      ],
    };
    const out = placeSupports(cad);
    expect(out.counts.hangers).toBe(0);
  });
});

describe('placeSupports — hand-counted seismic brace placement', () => {
  it('default lateral brace interval is 40 ft', () => {
    expect(SEISMIC_BRACE_INTERVAL_FT).toBe(40);
  });

  it('a 100 ft 4" main -> 2 lateral braces (floor(100/40) at 40 & 80)', () => {
    const cad = { solids: [horizPipe('cross-main', 'main', 100, 4.0)] };
    const out = placeSupports(cad);
    expect(out.counts.braces).toBe(2);
    expect(out.braces.map((b) => b.position[0])).toEqual([40, 80]);
    expect(out.braces.every((b) => b.role === 'seismic_brace' && b.braceType === 'lateral')).toBe(true);
    expect(out.braces.every((b) => b.pipe === 'cross-main' && b.intervalFt === 40)).toBe(true);
  });

  it('a run shorter than the brace interval gets no brace', () => {
    const cad = { solids: [horizPipe('branch-short', 'branch', 30, 2.0)] };
    const out = placeSupports(cad);
    expect(out.counts.braces).toBe(0);
  });

  it('honors an injected seismicIntervalFt option', () => {
    const cad = { solids: [horizPipe('cross-main', 'main', 100, 4.0)] };
    const out = placeSupports(cad, { seismicIntervalFt: 25 });
    // floor(100/25)=4 -> braces at 25,50,75,100
    expect(out.counts.braces).toBe(4);
    expect(out.braces.map((b) => b.position[0])).toEqual([25, 50, 75, 100]);
  });
});

describe('placeSupports — deterministic + real cad-model + honesty', () => {
  const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const cad = buildRoomCad(room);

  it('is deterministic (same model -> identical supports)', () => {
    const a = placeSupports(cad);
    const b = placeSupports(cad);
    expect(a).toEqual(b);
  });

  it('populates counts and only hangs branch/main runs from the real model', () => {
    const out = placeSupports(cad);
    expect(out.counts.hangers).toBeGreaterThan(0);
    expect(out.counts.hangers).toBe(out.hangers.length);
    expect(out.counts.braces).toBe(out.braces.length);
    // every hanger sits on a branch or cross-main pipe of the model
    const runNames = new Set(cad.solids
      .filter((s) => s.kind === 'pipe' && (s.role === 'branch' || s.role === 'main'))
      .map((s) => s.name));
    expect(out.hangers.every((h) => runNames.has(h.pipe))).toBe(true);
  });

  it('carries a best-effort / fail-closed disclaimer (no parity claim)', () => {
    const out = placeSupports(cad);
    expect(out.note).toBe(SUPPORTS_NOTE);
    expect(out.note).toMatch(/best-effort/i);
    expect(out.note).toMatch(/NOT a seismic engineering design/i);
    expect(out.note).toMatch(/NOT AutoSprink parity/i);
  });
});
