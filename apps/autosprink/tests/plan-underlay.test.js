/**
 * Stream B — pure-core tests for the REAL-plan PDF underlay pipeline.
 * No pdfjs, no three.js: exercises the deterministic math + manifest data.
 */
import { describe, it, expect } from 'vitest';
import { computeUnderlayTransform, createUnderlayMesh } from '../src/engine/pdf-underlay.js';
import { slabOutlinePoints, buildBuildingLevels } from '../src/engine/building-levels.js';
import {
  cooperative1881PlanManifest,
  manifestForProject,
  sheetsForLevel,
  PLAN_DISCIPLINES,
  ESTIMATED_FLOOR_TO_FLOOR_FT,
} from '../src/data/plan-manifest.js';

describe('computeUnderlayTransform', () => {
  it('contain-fits a landscape ARCH-D sheet into the 1881 footprint, aspect preserved', () => {
    // 36x24in sheet = 2592x1728pt
    const t = computeUnderlayTransform({
      pageWidthPt: 2592, pageHeightPt: 1728,
      targetWidthFt: 413, targetDepthFt: 413.2,
      elevationFt: 21,
    });
    expect(t.widthFt).toBeCloseTo(413, 6);
    expect(t.depthFt).toBeCloseTo(413 * (1728 / 2592), 6);
    expect(t.depthFt).toBeLessThanOrEqual(413.2);
    expect(t.feetPerPdfPoint).toBeCloseTo(413 / 2592, 9);
  });

  it('lies flat at the floor elevation with a z-fight lift and plan-view rotation', () => {
    const t = computeUnderlayTransform({
      pageWidthPt: 100, pageHeightPt: 50,
      targetWidthFt: 100, targetDepthFt: 100,
      elevationFt: 10.5,
    });
    expect(t.position.y).toBeCloseTo(10.55, 9);
    // Orientation contract: plane rotated -90deg about X => normal +Y,
    // text readable from above (NOT the old -Z-facing mirrored placeholder).
    expect(t.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(t.rotation.y).toBe(0);
    expect(t.rotation.z).toBe(0);
    expect(t.needsVerification).toBe(true);
  });

  it('throws on non-positive page or footprint dims (never fabricates scale)', () => {
    expect(() => computeUnderlayTransform({ pageWidthPt: 0, pageHeightPt: 10, targetWidthFt: 1, targetDepthFt: 1 })).toThrow();
    expect(() => computeUnderlayTransform({ pageWidthPt: 10, pageHeightPt: 10, targetWidthFt: 0, targetDepthFt: 1 })).toThrow();
  });
});

describe('createUnderlayMesh input contract', () => {
  it('requires THREE, canvas and transform', () => {
    expect(() => createUnderlayMesh(null, { canvas: {}, transform: {} })).toThrow(/THREE/);
    expect(() => createUnderlayMesh({}, { canvas: null, transform: {} })).toThrow(/canvas/);
    expect(() => createUnderlayMesh({}, { canvas: {}, transform: null })).toThrow(/transform/);
  });
});

describe('slabOutlinePoints', () => {
  it('returns a closed centered rectangle loop at y=0', () => {
    const pts = slabOutlinePoints(100, 60);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual([-50, 0, -30]);
    expect(pts[2]).toEqual([50, 0, 30]);
    expect(pts[4]).toEqual(pts[0]);
  });
  it('rejects degenerate footprints', () => {
    expect(() => slabOutlinePoints(0, 10)).toThrow();
  });
});

describe('cooperative1881PlanManifest', () => {
  const m = cooperative1881PlanManifest();

  it('has 8 levels with estimated elevations flagged, every sheet needs verification', () => {
    expect(m.levels).toHaveLength(8);
    expect(m.needsVerification).toBe(true);
    for (const [i, lvl] of m.levels.entries()) {
      expect(lvl.level).toBe(i + 1);
      expect(lvl.elevationFt).toBeCloseTo(i * ESTIMATED_FLOOR_TO_FLOOR_FT, 6);
      expect(lvl.elevationSource).toMatch(/NOT_VERIFIED/);
      for (const s of lvl.sheets) {
        expect(s.needsVerification).toBe(true);
        expect(s.url.startsWith('/plans/cooperative-1881/')).toBe(true);
        expect(['page-label', 'text-heuristic']).toContain(s.verified);
      }
    }
  });

  it('maps the label-verified architectural overall plans A-101..A-108 to pages 8..29 stride 3', () => {
    for (let n = 1; n <= 8; n++) {
      const [arch] = sheetsForLevel(m, n, 'arch');
      expect(arch.sheet).toBe(`A-10${n}`);
      expect(arch.page).toBe(8 + (n - 1) * 3);
      expect(arch.verified).toBe('page-label');
    }
  });

  it('marks MEP per-level mappings as text-heuristic (machine inference, flagged)', () => {
    const [elec] = sheetsForLevel(m, 3, 'elec');
    const [plumb] = sheetsForLevel(m, 3, 'plumb');
    expect(elec.verified).toBe('text-heuristic');
    expect(plumb.verified).toBe('text-heuristic');
  });

  it('only uses known discipline tags on level sheets', () => {
    for (const lvl of m.levels) {
      for (const s of lvl.sheets) expect(PLAN_DISCIPLINES).toContain(s.discipline);
    }
  });

  it('resolves by project name and returns null for projects with no real plans', () => {
    expect(manifestForProject('The Cooperative 1881 - Salt Lake City UT')).toBeTruthy();
    expect(manifestForProject('Cooperative 1881')).toBeTruthy();
    // Home Depot Rexburg has NO plan PDFs anywhere in the workspace.
    expect(manifestForProject('Home Depot - Rexburg ID')).toBeNull();
  });
});

describe('buildBuildingLevels (THREE injected as a minimal stub)', () => {
  // Tiny structural stub of the three.js namespace — enough for the scaffold.
  class Group {
    constructor() { this.children = []; this.visible = true; this.name = ''; this.userData = {}; this.position = { y: 0, set() {} }; }
    add(c) { this.children.push(c); }
  }
  class Vector3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
  class BufferGeometry { setFromPoints() { return this; } }
  class LineBasicMaterial { constructor(o) { Object.assign(this, o); } }
  class Line {
    constructor(g, m) { this.geometry = g; this.material = m; this.visible = true; this.name = ''; this.userData = {}; this.position = { x: 0, y: 0, z: 0 }; }
  }
  const THREE = { Group, Vector3, BufferGeometry, LineBasicMaterial, Line };

  it('builds one group per level with slab outlines and a working visibility switcher', () => {
    const m = cooperative1881PlanManifest();
    const api = buildBuildingLevels(THREE, m);
    expect(api.levels).toHaveLength(8);
    expect(api.root.children).toHaveLength(8);
    for (const l of api.levels) expect(l.group.children.length).toBe(1); // slab outline only until loadUnderlays
    api.setActiveLevel(3);
    expect(api.levels.find((l) => l.level === 3).group.visible).toBe(true);
    expect(api.levels.find((l) => l.level === 5).group.visible).toBe(false);
    api.setActiveLevel('all');
    expect(api.levels.every((l) => l.group.visible)).toBe(true);
    api.setLevelVisible(8, false);
    expect(api.levels.find((l) => l.level === 8).group.visible).toBe(false);
  });

  it('refuses to scaffold without a manifest (no fabrication)', () => {
    expect(() => buildBuildingLevels(THREE, null)).toThrow(/manifest/);
    expect(() => buildBuildingLevels(THREE, { levels: [] })).toThrow(/manifest/);
  });

  it('loadUnderlays without pdfjsLib fails loudly', async () => {
    const api = buildBuildingLevels(THREE, cooperative1881PlanManifest());
    await expect(api.loadUnderlays()).rejects.toThrow(/pdfjsLib/);
  });
});
