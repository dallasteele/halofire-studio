import { describe, it, expect } from 'vitest';
import {
  classifyMember,
  deriveScaleFromText,
  extractStructuralGrid,
  parseMemberTags,
  detectColumns,
  detectColumnMarkers,
  detectBeams,
  buildStructureLayer,
  matchGridOffset,
  nearestMember,
  buildStructure3D,
} from '../src/engine/structure-from-plan.js';

describe('classifyMember', () => {
  it('classifies HSS steel column tokens with the size', () => {
    expect(classifyMember('HSS8X4X5/16')).toEqual({ kind: 'steel-hss', role: 'column', size: 'HSS8X4X5/16' });
    expect(classifyMember('HSS4x4x1/4 (INTERIOR COLUMN)')).toMatchObject({ kind: 'steel-hss', role: 'column' });
  });
  it('classifies wide-flange beams', () => {
    expect(classifyMember('W12x26')).toMatchObject({ kind: 'steel-wf', role: 'beam', size: 'W12X26' });
  });
  it('classifies engineered + sawn wood beams', () => {
    expect(classifyMember('(1)1 3/4x11 7/8 LVL')).toEqual({
      kind: 'engineered', role: 'beam', size: '(1)1-3/4X11-7/8LVL',
    });
    expect(classifyMember('WALL TO SIDE OF MAIN FLOOR LVL JOIST.')).toBeNull();
    expect(classifyMember('6x12')).toMatchObject({ kind: 'wood-sawn', role: 'beam', size: '6X12' });
  });
  it('returns null for non-member text', () => {
    expect(classifyMember('FOOTING AND FOUNDATION PLAN')).toBeNull();
    expect(classifyMember('27')).toBeNull();
  });
});

describe('deriveScaleFromText (structural — each sheet its own scale)', () => {
  it('derives 1" = 30\' from the overall structural sheet', () => {
    const r = deriveScaleFromText('OVERALL FOOTING AND FOUNDATION PLAN SCALE: 1" = 30\'');
    expect(r).toBeTruthy();
    expect(r.feetPerUnit).toBeCloseTo(30 / 72, 6);
    expect(r.source).toBe('structural-sheet-printed-scale-notation');
  });
  it('derives 1/8" = 1\' from the enlarged area sheet', () => {
    expect(deriveScaleFromText('AREA B SCALE: 1/8" = 1\'').feetPerUnit).toBeCloseTo(0.1111111, 6);
  });
  it('returns null with no scale notation (never guesses / never borrows arch scale)', () => {
    expect(deriveScaleFromText('GENERAL STRUCTURAL NOTES')).toBeNull();
  });
});

describe('extractStructuralGrid', () => {
  // A 4-col x 4-row grid: col bubbles at top+bottom, row bubbles at left+right.
  const baseItems = [
    { s: '1', xFt: 10, yFt: 0 }, { s: '1', xFt: 10, yFt: 90 },
    { s: '2', xFt: 30, yFt: 0 }, { s: '2', xFt: 30, yFt: 90 },
    { s: '3', xFt: 60, yFt: 0 }, { s: '3', xFt: 60, yFt: 90 },
    { s: '4', xFt: 90, yFt: 0 }, { s: '4', xFt: 90, yFt: 90 },
    { s: 'A', xFt: 0, yFt: 15 }, { s: 'A', xFt: 100, yFt: 15 },
    { s: 'B', xFt: 0, yFt: 45 }, { s: 'B', xFt: 100, yFt: 45 },
    { s: 'C', xFt: 0, yFt: 75 }, { s: 'C', xFt: 100, yFt: 75 },
  ];
  it('extracts index-aligned label->coord datums for cols + rows', () => {
    const g = extractStructuralGrid(baseItems);
    expect(g.xs).toEqual([10, 30, 60, 90]);
    expect(g.ys).toEqual([15, 45, 75]);
    expect(g.labels.cols).toEqual(['1', '2', '3', '4']);
    expect(g.labels.rows).toEqual(['A', 'B', 'C']);
    // colDatums/rowDatums are the authoritative aligned pairs.
    expect(g.colDatums).toEqual([
      { label: '1', coord: 10 }, { label: '2', coord: 30 }, { label: '3', coord: 60 }, { label: '4', coord: 90 },
    ]);
  });
  it('rejects DECIMAL numeric tokens as columns (those are dimension callouts, not grid labels)', () => {
    const items = [...baseItems, { s: '30.8', xFt: 200, yFt: 0 }, { s: '30.8', xFt: 200, yFt: 90 }];
    const g = extractStructuralGrid(items);
    expect(g.labels.cols).not.toContain('30.8');
  });
  it('keeps a row even when it ALSO has a stray key-plan bubble (per-label cluster picks the main set)', () => {
    const items = [...baseItems,
      { s: 'A', xFt: 50, yFt: 250 }, // a lone key-plan "A" far away — must NOT move row A's datum
    ];
    const g = extractStructuralGrid(items);
    // Row A datum stays at 15 (the 2-bubble main-plan cluster), not pulled toward 250.
    const a = g.rowDatums.find((d) => d.label === 'A');
    expect(a.coord).toBe(15);
  });
  it('drops an ISOLATED legend datum far below the grid (e.g. an "S" symbol-key letter)', () => {
    const items = [...baseItems,
      { s: 'S', xFt: 30, yFt: -120 }, { s: 'S', xFt: 33, yFt: -120 }, // legend symbol, isolated below
    ];
    const g = extractStructuralGrid(items);
    expect(g.labels.rows).not.toContain('S');
    expect(g.labels.rows).toEqual(['A', 'B', 'C']);
  });
});

describe('parseMemberTags', () => {
  it('parses positioned member tokens with role counts', () => {
    const items = [
      { s: 'HSS8X4X5/16', xFt: 10, yFt: 20 },
      { s: 'W12x26', xFt: 40, yFt: 50 },
      { s: '6x12', xFt: 70, yFt: 80 },
      { s: 'NOTES', xFt: 0, yFt: 0 },
    ];
    const r = parseMemberTags(items);
    expect(r.members.length).toBe(3);
    expect(r.byRole.column).toBe(1);
    expect(r.byRole.beam).toBe(2);
  });
});

describe('detectColumns', () => {
  const grid = { xs: [0, 20], ys: [0, 20], labels: { cols: ['1', '2'], rows: ['A', 'B'] } };
  // A dense marker cluster of short segments at grid intersection (0,0); the other 3 intersections
  // have no markers (no fabrication there).
  const markerAt = (cx, cy) => {
    const segs = [];
    for (let i = 0; i < 8; i++) segs.push({ x1: cx - 0.5, y1: cy + i * 0.1 - 0.4, x2: cx + 0.5, y2: cy + i * 0.1 - 0.4 });
    return segs;
  };
  it('emits a column ONLY where marker linework exists at a grid intersection', () => {
    const segs = markerAt(0, 0);
    const r = detectColumns(grid, segs, [], { minMarkerSegs: 4, markerRadiusFt: 2.5 });
    expect(r.columns.length).toBe(1);
    expect(r.columns[0]).toMatchObject({ x: 0, y: 0, grid: { col: '1', row: 'A' } });
  });
  it('tags a column with the nearest column-role member size', () => {
    const segs = markerAt(0, 0);
    const members = [{ size: 'HSS8X4X5/16', kind: 'steel-hss', role: 'column', xFt: 1, yFt: 1 }];
    const r = detectColumns(grid, segs, members, { minMarkerSegs: 4 });
    expect(r.columns[0].size).toBe('HSS8X4X5/16');
    expect(r.columns[0].confidence).toBe('medium');
  });
  it('fabricates NOTHING at intersections with no markers', () => {
    const r = detectColumns(grid, [], [], {});
    expect(r.columns.length).toBe(0);
  });
});

describe('detectColumnMarkers (REAL marker extraction — replaces grid-intersection heuristic)', () => {
  // Build a small near-square box marker (4 short ortho edges) centered at (cx,cy), sizeFt.
  const boxAt = (cx, cy, sizeFt = 1.5) => {
    const h = sizeFt / 2;
    return [
      { x1: cx - h, y1: cy - h, x2: cx + h, y2: cy - h }, // bottom (H)
      { x1: cx - h, y1: cy + h, x2: cx + h, y2: cy + h }, // top (H)
      { x1: cx - h, y1: cy - h, x2: cx - h, y2: cy + h }, // left (V)
      { x1: cx + h, y1: cy - h, x2: cx + h, y2: cy + h }, // right (V)
    ];
  };
  // A 3x3 regular column field at xs=[0,20,40], ys=[0,20,40].
  const fieldSegs = () => {
    const segs = [];
    for (const x of [0, 20, 40]) for (const y of [0, 20, 40]) segs.push(...boxAt(x, y, 1.5));
    return segs;
  };

  it('extracts the regular 2-D column field as real marker boxes (RECALL: all 9 found)', () => {
    const r = detectColumnMarkers(fieldSegs(), {});
    expect(r.columns.length).toBe(9);
    expect(r.columns.every((c) => c.source === 'marker-extraction')).toBe(true);
    expect(r.xLines.length).toBe(3);
    expect(r.yLines.length).toBe(3);
    // every emitted column carries a real marker (>= 4 segs) and a measured size.
    for (const c of r.columns) {
      expect(c.markerSegs).toBeGreaterThanOrEqual(4);
      expect(c.sizeFt).toBeGreaterThan(1);
      expect(c.sizeFt).toBeLessThan(2.5);
    }
  });

  it('REJECTS an isolated stray box that is not on the 2-D grid (precision: no off-grid fabrication)', () => {
    const segs = [...fieldSegs(), ...boxAt(7, 33, 1.5)]; // off both an x-line and a y-line
    const r = detectColumnMarkers(segs, {});
    // The stray box shares no x-line (7) and no y-line (33) with >=2 boxes -> dropped.
    expect(r.columns.find((c) => Math.abs(c.x - 7) < 1 && Math.abs(c.y - 33) < 1)).toBeUndefined();
    expect(r.columns.length).toBe(9);
  });

  it('DROPS a packed schedule-table row (many tiny boxes in a tight line) — not columns', () => {
    const table = [];
    for (let i = 0; i < 12; i++) table.push(...boxAt(100 + i * 3.5, 200, 1.2)); // packed legend row (<6ft pitch)
    const r = detectColumnMarkers([...fieldSegs(), ...table], {});
    expect(r.droppedTableRows).toBeGreaterThanOrEqual(1);
    expect(r.columns.find((c) => Math.abs(c.y - 200) < 2)).toBeUndefined();
    expect(r.columns.length).toBe(9);
  });

  it('ignores long wall/grid lines and over-large boxes (only compact markers qualify)', () => {
    const segs = [
      ...fieldSegs(),
      { x1: -50, y1: 0, x2: 200, y2: 0 },     // long wall/grid line
      { x1: 0, y1: -50, x2: 0, y2: 200 },     // long grid line
      ...boxAt(60, 60, 8),                     // too-large box (a room, not a column)
    ];
    const r = detectColumnMarkers(segs, {});
    expect(r.columns.length).toBe(9);
    expect(r.columns.find((c) => Math.abs(c.x - 60) < 1)).toBeUndefined();
  });

  it('returns nothing (no fabrication) when there is no marker linework', () => {
    const r = detectColumnMarkers([{ x1: 0, y1: 0, x2: 100, y2: 0 }], {});
    expect(r.columns.length).toBe(0);
  });
});

describe('detectBeams', () => {
  const grid = { xs: [0, 40], ys: [0, 40] };
  it('keeps long axis-aligned members inside the body, drops short + grid-line + out-of-body segments', () => {
    const segs = [
      { x1: 5, y1: 20, x2: 35, y2: 20 },   // 30ft horizontal member INSIDE body -> kept
      { x1: 5, y1: 21, x2: 8, y2: 21 },    // 3ft short -> dropped (< minBeamFt)
      { x1: 0, y1: 0, x2: 0, y2: 40 },     // vertical ON col datum x=0 -> dropped (grid line)
      { x1: 500, y1: 500, x2: 530, y2: 500 }, // far outside the grid body -> dropped (legend)
    ];
    const r = detectBeams(segs, [], grid, { minBeamFt: 8, bodyMarginFt: 12 });
    const total = r.beams.length + r.joists.length;
    expect(total).toBe(1);
  });
  it('tags a member with the nearest beam token', () => {
    const segs = [{ x1: 5, y1: 20, x2: 35, y2: 20 }];
    const members = [{ size: 'W12X26', kind: 'steel-wf', role: 'beam', xFt: 20, yFt: 20 }];
    const r = detectBeams(segs, members, grid, { minBeamFt: 8 });
    const all = [...r.beams, ...r.joists];
    expect(all[0].member).toBe('W12X26');
  });
});

describe('matchGridOffset (register structure -> architectural grid)', () => {
  it('computes the rigid translation on shared LABELED datums with a tiny residual', () => {
    const struct = {
      colDatums: [{ label: '1', coord: 0 }, { label: '2', coord: 30 }, { label: '3', coord: 60 }],
      rowDatums: [{ label: 'A', coord: 0 }, { label: 'B', coord: 30 }],
    };
    // Arch grid is the same datums shifted by (+100, +50).
    const arch = {
      colDatums: [{ label: '1', coord: 100 }, { label: '2', coord: 130 }, { label: '3', coord: 160 }],
      rowDatums: [{ label: 'A', coord: 50 }, { label: 'B', coord: 80 }],
    };
    const m = matchGridOffset(struct, arch, {});
    expect(m.dx).toBe(100);
    expect(m.dy).toBe(50);
    expect(m.medianErrFt).toBeCloseTo(0, 6);
    expect(m.matchedCols).toBe(3);
    expect(m.matchedRows).toBe(2);
  });
  it('rejects a single mislabeled outlier datum (robust median + inlier residual)', () => {
    const struct = {
      colDatums: [{ label: '1', coord: 0 }, { label: '2', coord: 30 }, { label: '9', coord: 999 }],
      rowDatums: [{ label: 'A', coord: 0 }],
    };
    const arch = {
      colDatums: [{ label: '1', coord: 10 }, { label: '2', coord: 40 }, { label: '9', coord: 60 }],
      rowDatums: [{ label: 'A', coord: 5 }],
    };
    const m = matchGridOffset(struct, arch, {});
    expect(m.dx).toBe(10); // the two consistent cols win; the "9" outlier (offset -939) is dropped
    expect(m.medianErrFt).toBeLessThanOrEqual(4);
  });
  it('returns null when too few shared datums', () => {
    expect(matchGridOffset({ colDatums: [{ label: '1', coord: 0 }] }, { colDatums: [{ label: '7', coord: 0 }] }, {})).toBeNull();
  });
});

describe('buildStructureLayer + nearestMember', () => {
  // Synthetic structural sheet: 2x2 grid, one column marker, two beams, a beam member tag.
  const grid2 = (cx, cy) => {
    const segs = [];
    for (let i = 0; i < 8; i++) segs.push({ x1: cx - 0.5, y1: cy + i * 0.1 - 0.4, x2: cx + 0.5, y2: cy + i * 0.1 - 0.4 });
    return segs;
  };
  const segments = [
    ...grid2(0, 0),
    { x1: 5, y1: 20, x2: 35, y2: 20, lineWidth: 2 }, // horizontal beam in body
    { x1: 20, y1: 5, x2: 20, y2: 35, lineWidth: 2 }, // vertical beam in body
  ];
  const textItemsFt = [
    { s: '1', xFt: 0, yFt: -5 }, { s: '1', xFt: 0, yFt: 45 },
    { s: '2', xFt: 40, yFt: -5 }, { s: '2', xFt: 40, yFt: 45 },
    { s: 'A', xFt: -5, yFt: 0 }, { s: 'A', xFt: 45, yFt: 0 },
    { s: 'B', xFt: -5, yFt: 40 }, { s: 'B', xFt: 45, yFt: 40 },
    { s: 'W12X26', xFt: 20, yFt: 20 },
  ];

  it('builds a StructureLayer with grid, columns, members, and a bound nearestMember helper', () => {
    const layer = buildStructureLayer({ segments, textItemsFt, scaleFtPerUnit: 0.1111, scaleText: '1/8"=1\'' });
    expect(layer.counts.gridCols).toBe(2);
    expect(layer.counts.gridRows).toBe(2);
    expect(layer.counts.columns).toBeGreaterThanOrEqual(1);
    expect(layer.columns[0].markerBoundsFt).toBeTruthy();
    expect(layer.columns[0].measuredWidthFt).toBeGreaterThan(0);
    expect(layer.columns[0].measuredHeightFt).toBeGreaterThan(0);
    expect(Array.isArray(layer.markerColumns)).toBe(true);
    expect(layer.counts.markerColumns).toBe(layer.markerColumns.length);
    expect(layer.counts.memberTags).toBe(1);
    expect(typeof layer.nearestMember).toBe('function');
    expect(layer.needsVerification).toBe(true);
  });

  it('throws on empty segments (never fabricates structure)', () => {
    expect(() => buildStructureLayer({ segments: [], textItemsFt, scaleFtPerUnit: 0.1 })).toThrow(/no segments/);
  });
  it('throws when scale is not derived (never hardcoded / borrowed)', () => {
    expect(() => buildStructureLayer({ segments, textItemsFt, scaleFtPerUnit: 0 })).toThrow(/scaleFtPerUnit/);
  });

  it('nearestMember snaps a support point to the closest member with the foot-of-perpendicular', () => {
    const layer = buildStructureLayer({ segments, textItemsFt, scaleFtPerUnit: 0.1111, scaleText: '1/8"=1\'' });
    // A point just above the horizontal beam at y=20.
    const nm = nearestMember(layer, [18, 22]);
    expect(nm).toBeTruthy();
    expect(nm.distanceFt).toBeLessThanOrEqual(3);
    expect(nm.snapFt[1]).toBeCloseTo(20, 1); // snapped onto the y=20 beam line
  });
  it('nearestMember returns null when the layer has no members at all', () => {
    const empty = { beams: [], joists: [], columns: [] };
    expect(nearestMember(empty, [0, 0])).toBeNull();
  });

  it('registers structure onto an architectural grid (rigid offset applied to all geometry)', () => {
    const archGrid = {
      colDatums: [{ label: '1', coord: 100 }, { label: '2', coord: 140 }],
      rowDatums: [{ label: 'A', coord: 50 }, { label: 'B', coord: 90 }],
      xs: [100, 140], ys: [50, 90], labels: { cols: ['1', '2'], rows: ['A', 'B'] },
    };
    const layer = buildStructureLayer({ segments, textItemsFt, scaleFtPerUnit: 0.1111, scaleText: '1/8"=1\'' },
      { archGrid, gridAlign: true });
    expect(layer.gridMatch).toBeTruthy();
    expect(layer.registrationOffsetFt.dx).toBe(100);
    expect(layer.registrationOffsetFt.dy).toBe(50);
    // grid is shifted into the arch frame.
    expect(layer.grid.xs).toEqual([100, 140]);
  });
});

describe('buildStructure3D (injected stub THREE)', () => {
  // Minimal stub THREE: Group + Mesh + BoxGeometry tracking, no MeshStandardMaterial.
  function makeStubTHREE() {
    class Group { constructor() { this.children = []; this.userData = {}; } add(o) { this.children.push(o); } }
    class Mesh { constructor(geo, mat) { this.geometry = geo; this.material = mat; this.position = { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.rotation = { y: 0 }; this.userData = {}; } }
    class BoxGeometry { constructor(w, h, d) { this.w = w; this.h = h; this.d = d; } }
    class MeshBasicMaterial { constructor(o) { Object.assign(this, o); } }
    return { Group, Mesh, BoxGeometry, MeshBasicMaterial };
  }
  it('extrudes columns + beams into a tagged group at the framing elevation', () => {
    const layer = {
      provenance: 'x', scaleFtPerUnit: 0.1,
      columns: [{ x: 0, y: 0, grid: { col: '1', row: 'A' }, size: 'HSS8X4X5/16', kind: 'steel-hss', confidence: 'low' }],
      beams: [{ a: [0, 0], b: [30, 0], lengthFt: 30, member: 'W12X26', kind: 'steel-wf', confidence: 'medium' }],
      joists: [],
    };
    const THREE = makeStubTHREE();
    const out = buildStructure3D(THREE, layer, { cx: 0, cy: 0 }, { ceilingElevFt: 9, storyHeightFt: 10 });
    expect(out.counts).toEqual({ columns: 1, beams: 1, joists: 0 });
    expect(out.root.userData.kind).toBe('structure-from-plan');
    expect(out.root.children.length).toBe(2);
    expect(out.summary.needsVerification).toBe(true);
  });
  it('throws without a layer (never fabricates)', () => {
    expect(() => buildStructure3D(makeStubTHREE(), null, { cx: 0, cy: 0 })).toThrow(/StructureLayer/);
  });
});
