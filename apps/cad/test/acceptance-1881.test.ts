// REAL-DATA acceptance test — 1881 Cooperative (Salt Lake City, UT).
//
// The 1881 architectural source set is PDF-only (no architect DXF). The Halo Forge
// kernel did produce a REAL, true-coordinate sprinkler CAD model for the 1881 bid at
//   E:/ClaudeBot/data/halofire/bids/1881/artifacts/design.dxf
// (1758 pipe LINEs on HALOFIRE_PIPES + 1303 head CIRCLEs on HALOFIRE_HEADS, authored
// in FEET). We use it as the DXF acceptance fixture because it carries true drawing
// coordinates — exactly the lane W1 claims is reliable.
//
// Two acceptances, both honest:
//  (A) DXF lane — parse the real 1881 model, derive its scale from its OWN units
//      (no $INSUNITS header => unitless => ftPerUnit 1, coordinates taken as-authored
//      feet — NOT a guessed magic factor), and assert the footprint is in a SANE real
//      single-floor range, NOT the ~4.62x overshoot the old blind-scale vector path
//      produced and NOT a bounding-box blowup.
//  (B) PDF-only set-scale math — since the architect set is PDF-only, prove that the
//      operator-supplied two-point scale yields the correct ft/unit and that a traced
//      rectangle of known real dimensions yields the correct square footage.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import DxfParser from 'dxf-parser';
import { parseDxf } from '../src/lib/plan-import';
import { polygonAreaSqFt, setScaleFromTwoPoints } from '../src/lib/scale';

const DXF_1881 = 'E:/ClaudeBot/data/halofire/bids/1881/artifacts/design.dxf';

describe('1881 acceptance (A): real DXF footprint is sane, not 4.62x off', () => {
  const have = existsSync(DXF_1881);
  const t = have ? it : it.skip;

  t('parses the real 1881 sprinkler model with a real (non-guessed) scale', () => {
    const text = readFileSync(DXF_1881, 'utf8');
    const r = parseDxf(text, new DxfParser());

    expect(r.ok).toBe(true);
    // Real geometry, not fabricated: thousands of pipe lines.
    expect(r.lines.length).toBeGreaterThan(1000);
    // No $INSUNITS in this kernel DXF -> unitless, ftPerUnit 1 (coords as-authored
    // feet). The scale is the file's OWN datum, NOT a guessed magic factor.
    expect(r.units).toBe('unitless');
    expect(r.ftPerUnit).toBe(1);
    expect(r.layers).toContain('HALOFIRE_PIPES');

    // Footprint bbox in feet, traced from the DXF's own coordinates.
    const w = r.bounds.width;
    const h = r.bounds.height;
    const footprintSqFt = w * h;

    // SANE single-floor zone: ~80ft x ~43ft. Assert real-building bounds — a
    // single-floor footprint between 1,000 and 10,000 sq ft. The old blind-scale
    // vector path overshot real sets ~4.62x; a bbox blowup would land >>10,000.
    expect(w).toBeGreaterThan(40);
    expect(w).toBeLessThan(400);
    expect(h).toBeGreaterThan(20);
    expect(h).toBeLessThan(400);
    expect(footprintSqFt).toBeGreaterThan(1000);
    expect(footprintSqFt).toBeLessThan(10000);

    // Cross-check the shoelace area helper against the bbox polygon.
    const poly = [
      { x: r.bounds.minX, y: r.bounds.minY },
      { x: r.bounds.maxX, y: r.bounds.minY },
      { x: r.bounds.maxX, y: r.bounds.maxY },
      { x: r.bounds.minX, y: r.bounds.maxY },
    ];
    expect(polygonAreaSqFt(poly, r.ftPerUnit)).toBeCloseTo(footprintSqFt, 2);
  });
});

describe('1881 acceptance (B): PDF-only set-scale math is correct', () => {
  it('an 8 ft door measured as 32 px gives 0.25 ft/unit; a 320x240 px room = 4800 sq ft', () => {
    // Operator clicks the two jambs of a door the title block / schedule says is
    // 8'-0" wide; on the rendered raster those two points are 32 px apart.
    const ftPerUnit = setScaleFromTwoPoints({ x: 100, y: 100 }, { x: 132, y: 100 }, 8);
    expect(ftPerUnit).toBeCloseTo(0.25, 10);

    // The operator then traces a rectangular room 320 px wide x 240 px tall.
    // 320 * 0.25 = 80 ft, 240 * 0.25 = 60 ft -> 4800 sq ft.
    const room = [
      { x: 0, y: 0 },
      { x: 320, y: 0 },
      { x: 320, y: 240 },
      { x: 0, y: 240 },
    ];
    expect(polygonAreaSqFt(room, ftPerUnit)).toBeCloseTo(4800, 6);
  });
});
