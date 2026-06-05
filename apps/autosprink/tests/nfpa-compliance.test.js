import { describe, expect, it } from 'vitest';
import { checkCompliance, NFPA_NOTE } from '../src/engine/nfpa-compliance.js';
import { layoutRoom } from '../src/engine/sprinkler-layout.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

describe('checkCompliance — honesty contract', () => {
  it('always carries a NOT-AHJ/PE note (passing geometry is not approval)', () => {
    const layout = layoutRoom({ polygon: rect(20, 20), hazard: 'ordinary' });
    const result = checkCompliance(layout, 'ordinary');
    expect(NFPA_NOTE).toMatch(/NOT/i);
    expect(NFPA_NOTE).toMatch(/AHJ|PE|approval/i);
    expect(result.note).toBe(NFPA_NOTE);
    // A note finding is always present and never a 'pass' that implies clearance.
    const noteFinding = result.findings.find((f) => f.code === 'NFPA13_REVIEW_NOTE');
    expect(noteFinding).toBeTruthy();
    expect(noteFinding.severity).toBe('warn');
  });
});

describe('checkCompliance — compliant ordinary layout', () => {
  it('a normal ordinary-hazard room passes all geometric rules', () => {
    // 20x20 ordinary: layoutRoom keeps spacing <= 15 and coverage <= 130.
    const layout = layoutRoom({ polygon: rect(20, 20), hazard: 'ordinary' });
    const result = checkCompliance(layout, 'ordinary');

    // Every non-note finding is a pass.
    const ruleFindings = result.findings.filter((f) => f.code !== 'NFPA13_REVIEW_NOTE');
    expect(ruleFindings.length).toBeGreaterThan(0);
    for (const f of ruleFindings) {
      expect(f.severity).toBe('pass');
    }
    expect(result.passed).toBe(true);
  });
});

describe('checkCompliance — over-spaced / over-area layout fails', () => {
  it('hand-built over-spaced layout yields a fail finding and passed=false', () => {
    // Two heads 20 ft apart on an ordinary system -> spacing 20 > 15 max,
    // and coverage > 130 sqft -> at least one fail.
    const layout = {
      heads: [
        { x: 0, y: 0, row: 0, col: 0 },
        { x: 20, y: 0, row: 0, col: 1 },
      ],
      spacingX: 20,
      spacingY: 20,
      coveragePerHeadSqFt: 400,
      bbox: { minX: 0, minY: 0, maxX: 20, maxY: 0, width: 20, height: 0 },
    };
    const result = checkCompliance(layout, 'ordinary');
    const fails = result.findings.filter((f) => f.severity === 'fail');
    expect(fails.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);

    // Spacing rule specifically must fail.
    const spacing = result.findings.find((f) => f.code === 'NFPA13_MAX_SPACING');
    expect(spacing.severity).toBe('fail');
    // Coverage area rule must also fail (400 > 130).
    const area = result.findings.find((f) => f.code === 'NFPA13_MAX_COVERAGE_AREA');
    expect(area.severity).toBe('fail');
  });

  it('over-area-only (coverage exceeds hazard max) is a fail', () => {
    const layout = {
      heads: [
        { x: 0, y: 0, row: 0, col: 0 },
        { x: 10, y: 0, row: 0, col: 1 },
      ],
      spacingX: 10,
      spacingY: 14,
      coveragePerHeadSqFt: 140, // > 130 ordinary max
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0, width: 10, height: 0 },
    };
    const result = checkCompliance(layout, 'ordinary');
    const area = result.findings.find((f) => f.code === 'NFPA13_MAX_COVERAGE_AREA');
    expect(area.severity).toBe('fail');
    expect(result.passed).toBe(false);
  });
});

describe('checkCompliance — minimum spacing violation', () => {
  it('two heads closer than 6 ft yields a min-spacing finding', () => {
    const layout = {
      heads: [
        { x: 0, y: 0, row: 0, col: 0 },
        { x: 3, y: 0, row: 0, col: 1 }, // 3 ft apart < 6 ft min
      ],
      spacingX: 3,
      spacingY: 12,
      coveragePerHeadSqFt: 36,
      bbox: { minX: 0, minY: 0, maxX: 3, maxY: 0, width: 3, height: 0 },
    };
    const result = checkCompliance(layout, 'ordinary');
    const minSp = result.findings.find((f) => f.code === 'NFPA13_MIN_SPACING');
    expect(minSp.severity).toBe('fail');
    expect(minSp.detail).toMatch(/6/);
    expect(result.passed).toBe(false);
  });
});

describe('checkCompliance — distance-to-wall', () => {
  it('flags a head farther than half the max spacing from the bounding wall', () => {
    // ordinary max spacing 15 -> half = 7.5. A single head dead-center in a
    // 20x20 bbox has its NEAREST wall 10 ft away (> 7.5) -> over the limit.
    const layout = {
      heads: [{ x: 10, y: 10, row: 0, col: 0 }],
      spacingX: 12,
      spacingY: 10,
      coveragePerHeadSqFt: 120,
      bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20, width: 20, height: 20 },
    };
    const result = checkCompliance(layout, 'ordinary');
    const wall = result.findings.find((f) => f.code === 'NFPA13_MAX_DISTANCE_TO_WALL');
    expect(wall.severity).toBe('fail');
    expect(result.passed).toBe(false);
  });
});

describe('checkCompliance — max heads per system note', () => {
  it('flags when head count exceeds the per-system max (100 light/ordinary)', () => {
    const heads = [];
    for (let i = 0; i < 130; i += 1) {
      heads.push({ x: (i % 10) * 10, y: Math.floor(i / 10) * 10, row: Math.floor(i / 10), col: i % 10 });
    }
    const layout = {
      heads,
      spacingX: 10,
      spacingY: 10,
      coveragePerHeadSqFt: 100,
      bbox: { minX: 0, minY: 0, maxX: 90, maxY: 120, width: 90, height: 120 },
    };
    const result = checkCompliance(layout, 'ordinary');
    const sys = result.findings.find((f) => f.code === 'NFPA13_MAX_HEADS_PER_SYSTEM');
    expect(sys).toBeTruthy();
    expect(sys.severity).toBe('fail');
  });

  it('a small head count passes the per-system note', () => {
    const layout = layoutRoom({ polygon: rect(20, 20), hazard: 'ordinary' });
    const result = checkCompliance(layout, 'ordinary');
    const sys = result.findings.find((f) => f.code === 'NFPA13_MAX_HEADS_PER_SYSTEM');
    expect(sys.severity).toBe('pass');
  });
});

describe('checkCompliance — building input', () => {
  it('accepts a building/system-layout object with spaces and checks each space', () => {
    const building = {
      stories: [
        {
          level: 1,
          spaces: [
            {
              name: 'Room A',
              hazard: 'ordinary',
              heads: [
                { x: 0, y: 0, row: 0, col: 0 },
                { x: 20, y: 0, row: 0, col: 1 }, // over-spaced
              ],
              sizing: { hazard: 'ordinary' },
            },
          ],
        },
      ],
    };
    const result = checkCompliance(building, 'ordinary');
    const fails = result.findings.filter((f) => f.severity === 'fail');
    expect(fails.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });
});

describe('checkCompliance — empty / degenerate input', () => {
  it('a layout with no heads yields no rule fails but still returns the note', () => {
    const result = checkCompliance({ heads: [], spacingX: 0, spacingY: 0, coveragePerHeadSqFt: 0, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 } }, 'ordinary');
    expect(result.note).toBe(NFPA_NOTE);
    // No heads -> nothing to fail on geometry, but never claims approval.
    const fails = result.findings.filter((f) => f.severity === 'fail');
    expect(fails.length).toBe(0);
  });

  it('throws on an unknown hazard class', () => {
    expect(() => checkCompliance({ heads: [] }, 'nonsense')).toThrow();
  });
});
