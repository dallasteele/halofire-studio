// head-layout.ts tests — the PURE NFPA-13 head grid + coverage report.
//
// All coverage/spacing numbers come from the cited nfpa13-rules re-export; these
// tests assert the layout uses the CITED max spacing, that every head lands inside
// the polygon (turf), spacing <= cited max, area/head <= cited max, and that the
// coverage report flags an under-covered case. Nothing here hardcodes a forked
// NFPA number — it reads them back from the rules module under test's source.

import { describe, expect, it } from 'vitest';
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf';
import {
  autoLayoutHeads,
  coverageReport,
  maxProtectionAreaSqFt,
  maxSpacingFt,
} from '../src/lib/head-layout';
import type { Point2 } from '../src/lib/model';
import { MAX_SPACING_FT, MAX_PROTECTION_AREA_SQFT } from '../src/lib/nfpa13-rules';

/** A 30 x 40 ft rectangular room (in FEET), CCW. */
const ROOM_30x40: Point2[] = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 40 },
  { x: 0, y: 40 },
];

/** The binding effective grid spacing for a hazard: min(max spacing, sqrt(max area)). */
function effectiveSpacing(hazard: 'ORDINARY_1'): number {
  return Math.min(maxSpacingFt(hazard).value, Math.sqrt(maxProtectionAreaSqFt(hazard).value));
}

function ringOf(poly: Point2[]): number[][] {
  const ring = poly.map((p) => [p.x, p.y]);
  ring.push([poly[0].x, poly[0].y]);
  return ring;
}

describe('cited rule accessors (single source — no forked numbers)', () => {
  it('maxSpacingFt mirrors the cited MAX_SPACING_FT table', () => {
    expect(maxSpacingFt('ORDINARY_1').value).toBe(MAX_SPACING_FT.ordinary_1.value);
    expect(maxSpacingFt('LIGHT').value).toBe(MAX_SPACING_FT.light.value);
    expect(maxSpacingFt('EXTRA_1').value).toBe(MAX_SPACING_FT.extra_1.value);
    // Each carries the verbatim citation.
    expect(maxSpacingFt('ORDINARY_1').citation).toBe(MAX_SPACING_FT.ordinary_1.citation);
    expect(maxSpacingFt('ORDINARY_1').citation.length).toBeGreaterThan(0);
  });

  it('maxProtectionAreaSqFt mirrors the cited MAX_PROTECTION_AREA_SQFT table', () => {
    expect(maxProtectionAreaSqFt('ORDINARY_1').value).toBe(
      MAX_PROTECTION_AREA_SQFT.ordinary_1.value,
    );
    expect(maxProtectionAreaSqFt('LIGHT').value).toBe(MAX_PROTECTION_AREA_SQFT.light.value);
  });
});

describe('autoLayoutHeads — 30x40 ft, ordinary_1', () => {
  const heads = autoLayoutHeads(ROOM_30x40, 'ORDINARY_1');
  // The AREA limit (130 ft^2 -> sqrt ~11.4 ft) binds tighter than the 15 ft spacing.
  const spacing = effectiveSpacing('ORDINARY_1');
  const maxSpacingCited = maxSpacingFt('ORDINARY_1').value; // cited absolute 15 ft

  it('lays heads on the NFPA grid count for the box (area limit binds)', () => {
    // Box 30 wide, 40 deep. Effective spacing min(15, sqrt(130)=11.40)=11.40 ft.
    // Per axis the grid count is ceil(span / spacing): X ceil(30/11.40)=3 columns,
    // Y ceil(40/11.40)=4 rows => 12 heads.
    const cols = Math.max(1, Math.ceil(30 / spacing));
    const rows = Math.max(1, Math.ceil(40 / spacing));
    expect(cols).toBe(3);
    expect(rows).toBe(4);
    expect(heads.length).toBe(cols * rows);
  });

  it('keeps the perimeter heads within a half-spacing of each wall', () => {
    // The cited distance-to-wall rule constrains the OUTERMOST heads: the head
    // nearest each of the 4 box walls must be within one-half the max spacing.
    const halfLimit = maxSpacingCited / 2 + 1e-6;
    const minLeft = Math.min(...heads.map((h) => h.x - 0));
    const minRight = Math.min(...heads.map((h) => 30 - h.x));
    const minBottom = Math.min(...heads.map((h) => h.y - 0));
    const minTop = Math.min(...heads.map((h) => 40 - h.y));
    expect(minLeft).toBeLessThanOrEqual(halfLimit);
    expect(minRight).toBeLessThanOrEqual(halfLimit);
    expect(minBottom).toBeLessThanOrEqual(halfLimit);
    expect(minTop).toBeLessThanOrEqual(halfLimit);
  });

  it('places EVERY head inside the room polygon (turf)', () => {
    const ring = turfPolygon([ringOf(ROOM_30x40)]);
    for (const h of heads) {
      expect(booleanPointInPolygon(turfPoint([h.x, h.y]), ring)).toBe(true);
    }
  });

  it('nearest-neighbour spacing never exceeds the cited max', () => {
    for (let i = 0; i < heads.length; i += 1) {
      let nearest = Infinity;
      for (let j = 0; j < heads.length; j += 1) {
        if (i === j) continue;
        nearest = Math.min(nearest, Math.hypot(heads[i].x - heads[j].x, heads[i].y - heads[j].y));
      }
      expect(nearest).toBeLessThanOrEqual(spacing + 1e-6);
    }
  });

  it('protection area per head never exceeds the cited max', () => {
    const areaLimit = maxProtectionAreaSqFt('ORDINARY_1').value; // 130 ft^2
    const roomArea = 30 * 40; // 1200 ft^2
    const perHead = roomArea / heads.length;
    expect(perHead).toBeLessThanOrEqual(areaLimit + 1e-6);
  });

  it('attaches the SKU when one is supplied, and is deterministic', () => {
    const a = autoLayoutHeads(ROOM_30x40, 'ORDINARY_1', { sku: 'tyco-ty3331' });
    const b = autoLayoutHeads(ROOM_30x40, 'ORDINARY_1', { sku: 'tyco-ty3331' });
    expect(a).toEqual(b);
    expect(a.every((h) => h.sku === 'tyco-ty3331')).toBe(true);
  });

  it('clamps an over-max spacing override down to the cited max', () => {
    const clamped = autoLayoutHeads(ROOM_30x40, 'ORDINARY_1', { spacingFt: 999 });
    expect(clamped.length).toBe(heads.length); // same grid as the default max
  });

  it('returns no heads for a degenerate polygon', () => {
    expect(autoLayoutHeads([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'ORDINARY_1')).toEqual([]);
    expect(autoLayoutHeads(ROOM_30x40, 'ORDINARY_1', { spacingFt: 0 })).toEqual([]);
  });
});

describe('coverageReport — covered vs under-covered', () => {
  it('reports covered:true for an auto-laid ordinary_1 room with cited findings', () => {
    const heads = autoLayoutHeads(ROOM_30x40, 'ORDINARY_1');
    const rep = coverageReport(ROOM_30x40, heads, 'ORDINARY_1');
    expect(rep.covered).toBe(true);
    expect(rep.headCount).toBe(heads.length);
    expect(rep.maxAreaPerHead).toBeLessThanOrEqual(rep.maxAllowedAreaPerHead + 1e-6);
    expect(rep.maxObservedSpacingFt).toBeLessThanOrEqual(rep.maxAllowedSpacingFt + 1e-6);
    // Every finding carries a non-empty citation and says verify adopted edition.
    expect(rep.findings.length).toBeGreaterThan(0);
    for (const f of rep.findings) {
      expect(f.citation.length).toBeGreaterThan(0);
      expect(f.citation).toContain('Verify adopted edition.');
    }
  });

  it('flags an UNDER-COVERED room (one head in a large room) — area finding fails', () => {
    const oneHead: Point2[] = [{ x: 15, y: 20 }];
    const rep = coverageReport(ROOM_30x40, oneHead, 'ORDINARY_1');
    expect(rep.covered).toBe(false);
    const areaFinding = rep.findings.find((f) => f.id === 'area');
    expect(areaFinding?.ok).toBe(false);
    // 1200 ft^2 / 1 head = 1200 ft^2 >> 130 ft^2 cited limit.
    expect(rep.maxAreaPerHead).toBeGreaterThan(rep.maxAllowedAreaPerHead);
  });

  it('flags an under-covered room with NO heads', () => {
    const rep = coverageReport(ROOM_30x40, [], 'ORDINARY_1');
    expect(rep.covered).toBe(false);
    expect(rep.headCount).toBe(0);
    expect(rep.findings.find((f) => f.id === 'count')?.ok).toBe(false);
  });

  it('flags excessive spacing even when area would pass', () => {
    // Two heads 20 ft apart (> cited 15 ft) in a small room.
    const room: Point2[] = [
      { x: 0, y: 0 },
      { x: 22, y: 0 },
      { x: 22, y: 8 },
      { x: 0, y: 8 },
    ];
    const heads: Point2[] = [
      { x: 1, y: 4 },
      { x: 21, y: 4 },
    ];
    const rep = coverageReport(room, heads, 'ORDINARY_1');
    const spacingFinding = rep.findings.find((f) => f.id === 'spacing');
    expect(spacingFinding?.ok).toBe(false);
    expect(rep.covered).toBe(false);
  });
});
