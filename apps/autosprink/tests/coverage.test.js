import { describe, it, expect } from 'vitest';
import { computeCoverage, MIN_SPACING_FT } from '../src/engine/coverage.js';
import { buildRoomCad } from '../src/engine/cad-model.js';

// Build a head-only model at explicit plan positions for a hazard.
function headModel(positions, hazard = 'ordinary') {
  return {
    sizing: { hazard },
    solids: positions.map(([x, y], i) => ({
      kind: 'head', name: `h${i}`, position: [x, y, 8], orientation: 'pendent',
    })),
  };
}

describe('coverage — disc sizing per hazard', () => {
  it('sizes the protection radius from the hazard max spacing (half-spacing diagonal)', () => {
    // ordinary max spacing 15 ft -> protect radius (15/2)*sqrt2 ≈ 10.61 ft
    const res = computeCoverage(headModel([[0, 0]], 'ordinary'));
    expect(res.maxSpacingFt).toBe(15);
    expect(res.heads).toHaveLength(1);
    expect(res.heads[0].protectRadiusFt).toBeCloseTo((15 / 2) * Math.SQRT2, 2);
    // equivalent-area radius for 130 sqft ≈ 6.43 ft
    expect(res.heads[0].equivAreaRadiusFt).toBeCloseTo(Math.sqrt(130 / Math.PI), 2);
  });

  it('extra hazard uses the tighter 12 ft spacing -> smaller disc', () => {
    const res = computeCoverage(headModel([[0, 0]], 'extra'));
    expect(res.maxSpacingFt).toBe(12);
    expect(res.heads[0].protectRadiusFt).toBeCloseTo((12 / 2) * Math.SQRT2, 2);
  });
});

describe('coverage — TOO CLOSE (min spacing) is a REAL NFPA violation', () => {
  it('flags a pair below the 6 ft minimum, both heads marked tooClose', () => {
    const res = computeCoverage(headModel([[0, 0], [4, 0]], 'ordinary')); // 4 ft < 6
    const close = res.violations.filter((v) => v.kind === 'too-close');
    expect(close).toHaveLength(1);
    expect(close[0].code).toBe('NFPA13_MIN_SPACING');
    expect(close[0].severity).toBe('fail');
    expect(res.heads[0].tooClose).toBe(true);
    expect(res.heads[1].tooClose).toBe(true);
    expect(res.counts.tooClose).toBe(2);
  });

  it('does NOT flag a pair exactly at / above the 6 ft minimum', () => {
    const res = computeCoverage(headModel([[0, 0], [6, 0]], 'ordinary'));
    expect(res.violations.filter((v) => v.kind === 'too-close')).toHaveLength(0);
    expect(res.heads.every((h) => !h.tooClose)).toBe(true);
  });

  it('reports the min-spacing constant', () => {
    expect(MIN_SPACING_FT).toBe(6);
  });
});

describe('coverage — TOO FAR (max spacing) is a REAL NFPA violation', () => {
  it('flags a head whose nearest neighbour exceeds the hazard max spacing', () => {
    // ordinary max 15 ft; place neighbour 20 ft away -> too far
    const res = computeCoverage(headModel([[0, 0], [20, 0]], 'ordinary'));
    const far = res.violations.filter((v) => v.kind === 'too-far');
    expect(far.length).toBeGreaterThanOrEqual(1);
    expect(far[0].code).toBe('NFPA13_MAX_SPACING');
    expect(res.heads.some((h) => h.tooFar)).toBe(true);
  });

  it('does NOT flag heads spaced within the max', () => {
    const res = computeCoverage(headModel([[0, 0], [12, 0]], 'ordinary')); // 12 < 15
    expect(res.violations.filter((v) => v.kind === 'too-far')).toHaveLength(0);
  });

  it('extra hazard (12 ft max) flags a 14 ft gap that ordinary would pass', () => {
    const extra = computeCoverage(headModel([[0, 0], [14, 0]], 'extra'));
    expect(extra.violations.some((v) => v.kind === 'too-far')).toBe(true);
    const ordinary = computeCoverage(headModel([[0, 0], [14, 0]], 'ordinary'));
    expect(ordinary.violations.some((v) => v.kind === 'too-far')).toBe(false);
  });
});

describe('coverage — GAP scan finds unprotected floor', () => {
  it('flags a hole when two heads are far enough apart to leave their discs apart', () => {
    // Two heads 28 ft apart, ordinary disc radius ≈10.61 -> midpoint (14 ft) is
    // 14 ft from each head, outside both discs -> a real coverage gap.
    const res = computeCoverage(headModel([[0, 0], [28, 0]], 'ordinary'), undefined, { gapSampleFt: 2 });
    expect(res.gapCells.length).toBeGreaterThan(0);
    expect(res.violations.some((v) => v.kind === 'gap')).toBe(true);
    expect(res.coveredPct).toBeLessThan(100);
  });

  it('a tight, properly tiled grid has NO coverage gaps and ~full coverage', () => {
    // 3x3 grid at 10 ft spacing (well under ordinary 15 ft max), discs overlap.
    const pts = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) pts.push([i * 10, j * 10]);
    const res = computeCoverage(headModel(pts, 'ordinary'), undefined, { gapSampleFt: 2 });
    expect(res.gapCells.length).toBe(0);
    expect(res.coveredPct).toBe(100);
    // No spacing violations either: 10 ft is within [6,15].
    expect(res.counts.tooClose).toBe(0);
    expect(res.counts.tooFar).toBe(0);
  });
});

describe('coverage — golden generated model is clean', () => {
  it('a generated room CAD model has no spacing violations and full coverage', () => {
    const room = {
      name: 'Test', hazard: 'ordinary', ceilingHeightFt: 14,
      polygon: [[0, 0], [40, 0], [40, 30], [0, 30]],
    };
    const model = buildRoomCad(room);
    const res = computeCoverage(model);
    expect(res.heads.length).toBeGreaterThan(0);
    // Layout engine spaces heads within [min,max] -> zero spacing fails.
    expect(res.counts.tooClose).toBe(0);
    expect(res.counts.tooFar).toBe(0);
    // The generated grid tiles the room -> no interior gaps.
    expect(res.counts.gaps).toBe(0);
    expect(res.coveredPct).toBe(100);
    // Hazard resolved from sizing.hazard.
    expect(res.hazard).toBe('ordinary');
  });
});

describe('coverage — determinism + guards', () => {
  it('is deterministic: identical input -> identical output', () => {
    const m = headModel([[0, 0], [3, 0], [20, 5]], 'ordinary');
    const a = computeCoverage(m);
    const b = computeCoverage(m);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('empty / headless / null models do not throw', () => {
    expect(computeCoverage(null).counts.heads).toBe(0);
    expect(computeCoverage({ solids: [] }).counts.heads).toBe(0);
    expect(computeCoverage({ solids: [{ kind: 'wall' }] }).counts.heads).toBe(0);
  });

  it('per-head hazard overrides the model default', () => {
    const m = {
      sizing: { hazard: 'ordinary' },
      solids: [
        { kind: 'head', name: 'a', position: [0, 0, 8], hazard: 'extra' },
        { kind: 'head', name: 'b', position: [13, 0, 8] },
      ],
    };
    const res = computeCoverage(m);
    const a = res.heads.find((h) => h.name === 'a');
    const b = res.heads.find((h) => h.name === 'b');
    expect(a.hazard).toBe('extra');
    expect(a.maxSpacingFt).toBe(12);
    expect(b.hazard).toBe('ordinary');
    expect(b.maxSpacingFt).toBe(15);
    // head a (extra, 12 ft max) has neighbour at 13 ft -> too far; b (ordinary 15) is fine
    expect(a.tooFar).toBe(true);
    expect(b.tooFar).toBe(false);
  });
});
