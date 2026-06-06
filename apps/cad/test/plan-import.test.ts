// plan-import.ts contract tests — parse a small inline DXF fixture into lines /
// units / bounds, derive a real scale, pull wall candidates, and fail SOFT on junk.
// Uses the REAL dxf-parser (pure JS, no worker), proving the wiring end to end.

import { describe, expect, it } from 'vitest';
import DxfParser from 'dxf-parser';
import { parseDxf, wallCandidates } from '../src/lib/plan-import';

const parser = new DxfParser();

/**
 * A tiny but valid DXF: HEADER with $INSUNITS=2 (feet) and an ENTITIES section with
 * one 10ft horizontal LINE plus a closed 8x8 LWPOLYLINE on a WALLS layer.
 */
const SMALL_DXF = `0
SECTION
2
HEADER
9
$INSUNITS
70
2
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0.0
20
0.0
11
10.0
21
0.0
0
LWPOLYLINE
8
WALLS
90
4
70
1
10
0.0
20
0.0
10
8.0
20
0.0
10
8.0
20
8.0
10
0.0
20
8.0
0
ENDSEC
0
EOF
`;

describe('parseDxf (real dxf-parser)', () => {
  it('parses the fixture: units=feet, ftPerUnit=1, both entities, real bounds', () => {
    const r = parseDxf(SMALL_DXF, parser);
    expect(r.ok).toBe(true);
    expect(r.units).toBe('feet');
    expect(r.ftPerUnit).toBe(1);
    expect(r.lines.length).toBe(1);
    expect(r.polylines.length).toBe(1);
    expect(r.layers).toContain('WALLS');
    // Bounds span the 10ft line and the 8x8 polyline -> 10 wide, 8 tall.
    expect(r.bounds.width).toBeCloseTo(10, 6);
    expect(r.bounds.height).toBeCloseTo(8, 6);
  });

  it('the parsed LINE carries its real endpoints', () => {
    const r = parseDxf(SMALL_DXF, parser);
    const l = r.lines[0];
    expect(l.x1).toBeCloseTo(0, 6);
    expect(l.x2).toBeCloseTo(10, 6);
    expect(l.layer).toBe('WALLS');
  });

  it('fails soft on empty text (ok:false, reason, no throw)', () => {
    const r = parseDxf('', parser);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty/i);
    expect(r.lines).toEqual([]);
  });

  it('fails soft on garbage that yields no geometry', () => {
    const r = parseDxf('not a dxf at all', parser);
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it('derives ftPerUnit from $INSUNITS=1 (inches -> 1/12 ft/unit)', () => {
    const inchDxf = SMALL_DXF.replace('$INSUNITS\n70\n2', '$INSUNITS\n70\n1');
    const r = parseDxf(inchDxf, parser);
    expect(r.ok).toBe(true);
    expect(r.units).toBe('inches');
    expect(r.ftPerUnit).toBeCloseTo(1 / 12, 8);
  });
});

describe('wallCandidates', () => {
  it('pulls the long LINE and the polyline edges as walls', () => {
    const r = parseDxf(SMALL_DXF, parser);
    const walls = wallCandidates(r, { minWallFt: 2 });
    // 1 line + 4 closed-polyline edges (each 8ft) = 5 candidate walls.
    expect(walls.length).toBe(5);
    for (const w of walls) {
      expect(w.id).toMatch(/^wall_/);
      expect(typeof w.start.x).toBe('number');
    }
  });

  it('respects a layer hint filter', () => {
    const r = parseDxf(SMALL_DXF, parser);
    expect(wallCandidates(r, { layerHints: ['WALL'] }).length).toBe(5);
    expect(wallCandidates(r, { layerHints: ['DOORS'] }).length).toBe(0);
  });

  it('returns [] for a failed parse (honest, never fabricated)', () => {
    expect(wallCandidates(parseDxf('', parser))).toEqual([]);
  });
});
