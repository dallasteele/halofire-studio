import { describe, expect, test } from 'vitest';

import { parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';

// T31 — parseArchitecturalScale: read the STATED architectural scale off a sheet's
// text and convert it to feet-per-PDF-point. The scale is a REAL datum printed on
// the drawing (the title-block SCALE: label); this helper is explicitly NOT a guess
// and NOT a geometry auto-derivation — it reads the architect's own stated scale.
//
// Every expected number below is recomputed BY HAND from the stated scale, never
// table-looked-up: feetPerPoint = (rhsFeet / lhsInches) / 72.
//
// The inputs are built with the SAME inch (") and foot (') glyphs that appear on a
// real ARCH-D sheet so the parser is exercised against authentic title-block text.
describe('parseArchitecturalScale', () => {
  test("3/32\" = 1'-0' gives 0.148148 ft/pt (the real 1881 OVERALL FIRST FLOOR PLAN scale)", () => {
    // (1 / (3/32)) / 72 = (32/3) / 72 = 32 / 216 = 0.148148...
    expect(parseArchitecturalScale('3/32" = 1\'-0"')).toBeCloseTo(0.148148, 6);
  });

  test('1/8" = 1\' gives 0.111111 ft/pt', () => {
    // (1 / (1/8)) / 72 = 8 / 72 = 0.111111...
    expect(parseArchitecturalScale('1/8" = 1\'')).toBeCloseTo(0.111111, 6);
  });

  test('1/16" = 1\' gives 0.222222 ft/pt', () => {
    // (1 / (1/16)) / 72 = 16 / 72 = 0.222222...
    expect(parseArchitecturalScale('1/16" = 1\'')).toBeCloseTo(0.222222, 6);
  });

  test('1" = 20\' gives 0.277778 ft/pt', () => {
    // (20 / 1) / 72 = 20 / 72 = 0.277778...
    expect(parseArchitecturalScale('1" = 20\'')).toBeCloseTo(0.277778, 6);
  });

  test('accepts a leading SCALE: label (as printed in a title block)', () => {
    // SCALE: 3/32" = 1'-0"  -> same 0.148148 ft/pt.
    expect(parseArchitecturalScale('SCALE: 3/32" = 1\'-0"')).toBeCloseTo(0.148148, 6);
  });

  test('tolerates curly inch/foot glyphs and embedded sheet noise', () => {
    // Bluebeam/AutoCAD title blocks frequently emit curly ” and ’ glyphs; the
    // label is buried in surrounding sheet text. Still 0.148148 ft/pt.
    const sheet = 'OVERALL FIRST FLOOR PLAN   SCALE: 3/32” = 1’-0”   A1.01';
    expect(parseArchitecturalScale(sheet)).toBeCloseTo(0.148148, 6);
  });

  test('returns null for junk / no recognizable scale', () => {
    expect(parseArchitecturalScale('NORTH ELEVATION — no scale here')).toBeNull();
    expect(parseArchitecturalScale('')).toBeNull();
    expect(parseArchitecturalScale(null)).toBeNull();
    expect(parseArchitecturalScale(undefined)).toBeNull();
    expect(parseArchitecturalScale('1881 West North Temple, Salt Lake City')).toBeNull();
  });
});
