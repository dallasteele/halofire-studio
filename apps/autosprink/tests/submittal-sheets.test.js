import { describe, it, expect } from 'vitest';
import {
  buildSubmittalSheets,
  renderSheetSetHtml,
  SUBMITTAL_SHEETS_DISCLAIMER,
} from '../src/engine/submittal-sheets.js';

// A small but realistic two-level model: walls, columns, mains, branches, heads.
function makeModel() {
  return {
    name: 'Test Building',
    units: 'ft',
    solids: [
      { kind: 'wall', a: [0, 0], b: [40, 0], baseZ: 0, heightFt: 12, thicknessFt: 0.5 },
      { kind: 'wall', a: [40, 0], b: [40, 30], baseZ: 0, heightFt: 12 },
      { kind: 'wall', a: [40, 30], b: [0, 30], baseZ: 0, heightFt: 12 },
      { kind: 'wall', a: [0, 30], b: [0, 0], baseZ: 0, heightFt: 12 },
      { kind: 'column', x: 20, y: 15, sizeFt: 1, baseZ: 0, heightFt: 12, gridLabel: 'B2' },
      { kind: 'pipe', role: 'riser', from: [2, 2, 0], to: [2, 2, 11] },
      { kind: 'pipe', role: 'main', from: [2, 2, 10], to: [38, 2, 10] },
      { kind: 'pipe', role: 'branch', from: [10, 2, 10], to: [10, 28, 10] },
      { kind: 'pipe', role: 'branch', from: [20, 2, 10], to: [20, 28, 10] },
      // ground-floor heads near z=0
      { kind: 'head', position: [10, 8, 1], orientation: 'pendent' },
      { kind: 'head', position: [10, 16, 1], orientation: 'pendent' },
      { kind: 'head', position: [10, 24, 1], orientation: 'pendent' },
      { kind: 'head', position: [20, 8, 1], orientation: 'pendent' },
      { kind: 'head', position: [20, 16, 1], orientation: 'pendent' },
      { kind: 'head', position: [20, 24, 1], orientation: 'pendent' },
      // second-floor heads near z=12
      { kind: 'head', position: [10, 8, 12], orientation: 'pendent' },
      { kind: 'head', position: [20, 24, 12], orientation: 'pendent' },
      { kind: 'component', name: 'tee-1' },
      { kind: 'component', name: 'tee-2' },
    ],
  };
}

const report = {
  hasSummary: true,
  summary: {
    hazard: 'ordinary', hazardLabel: 'Ordinary Hazard Group 1',
    densityGpmFt2: 0.15, designAreaSqFt: 1500, designBasisLabel: 'NFPA-13 remote-area design demand',
    kFactor: 5.6, demandGpm: 210.4, requiredPsi: 62.3, availablePsi: 75, safetyMarginPsi: 12.7,
    frictionLossPsi: 18.2, elevationPsi: 4.3, maxVelocityFps: 12.1,
    headsFlowing: 12, headsTotal: 8, demandMet: true,
  },
  meta: { system: 'Wet-pipe sprinkler system' },
  disclaimer: 'Engineering aid — NOT AHJ/PE-stamped.',
};

const bom = {
  heads: 8, pipeFt: 540, pipeSegments: 16, fittings: 4, walls: 4,
  couplings: 22, hangers: 14,
  bySize: { '2.00"': 120, '1.25"': 320, '1.00"': 100 },
  byMaterial: { 'sch40-blk': 30 },
};

describe('buildSubmittalSheets', () => {
  it('builds the FP-0..FP-D sheet set with a titleblock on every sheet', () => {
    const set = buildSubmittalSheets({
      cadModel: makeModel(), hydraulicReport: report, bom,
      project: { name: 'Acme HQ', address: '1 Main St', designer: 'J. Doe', date: '2026-06-15' },
      generatedAt: '2026-06-15',
    });
    expect(set.hasTitleblock).toBe(true);
    expect(set.exportReady).toBe(true);
    // ordered codes present
    expect(set.sheetIds[0]).toBe('FP-0');
    expect(set.sheetIds).toContain('FP-H');
    expect(set.sheetIds).toContain('FP-R');
    expect(set.sheetIds).toContain('FP-B');
    expect(set.sheetIds[set.sheetIds.length - 1]).toBe('FP-D');
    // at least one per-level plan sheet
    expect(set.sheetIds.some((id) => id.startsWith('FP-N'))).toBe(true);
    // every sheet has valid svg + carries the project + disclaimer
    for (const sh of set.sheets) {
      expect(sh.svg.startsWith('<svg')).toBe(true);
      expect(sh.svg.includes('</svg>')).toBe(true);
      expect(sh.titleblock.project).toBe('Acme HQ');
      expect(sh.titleblock.designer).toBe('J. Doe');
      expect(sh.svg).toContain('HALO FIRE PROTECTION');
    }
  });

  it('FP-0 cover lists every sheet in the index and the disclaimer', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const cover = set.sheets.find((s) => s.code === 'FP-0');
    expect(cover.svg).toContain('SHEET INDEX');
    expect(cover.svg).toContain('FP-H');
    expect(cover.svg).toContain('FP-D');
    expect(cover.svg).toContain('NOT A STAMPED SUBMITTAL');
  });

  it('FP-H placard reflects the real hydraulic summary numbers', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const h = set.sheets.find((s) => s.code === 'FP-H');
    expect(h.svg).toContain('HYDRAULIC DESIGN PLACARD');
    expect(h.svg).toContain('62.3'); // required psi
    expect(h.svg).toContain('210.4'); // demand gpm
    expect(h.svg).toContain('YES'); // demand met
    expect(set.hasHydraulics).toBe(true);
  });

  it('FP-H degrades honestly when no hydraulics are supplied', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), bom });
    const h = set.sheets.find((s) => s.code === 'FP-H');
    expect(h.svg).toContain('run Phase-3 hydraulics');
    expect(set.hasHydraulics).toBe(false);
  });

  it('FP-N plans render heads/pipes/walls and split by level', () => {
    const levels = [
      { level: 1, name: 'Ground Floor', elevationFt: 0 },
      { level: 2, name: 'Second Floor', elevationFt: 12 },
    ];
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom, levels });
    const planSheets = set.sheets.filter((s) => s.kind === 'plan');
    expect(planSheets.length).toBe(2);
    // each plan sheet draws head glyphs (circle) and pipe lines
    for (const ps of planSheets) {
      expect(ps.svg).toContain('SPRINKLER PLAN');
      expect(ps.svg).toContain('<circle'); // a head glyph
    }
    // level labels carried through
    expect(planSheets[0].svg).toContain('Ground Floor');
    expect(planSheets[1].svg).toContain('Second Floor');
  });

  it('FP-R riser diagram renders riser + per-level cross mains', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const r = set.sheets.find((s) => s.code === 'FP-R');
    expect(r.svg).toContain('RISER DIAGRAM');
    expect(r.svg).toContain('RISER / VALVE');
    expect(r.svg).toContain('heads'); // per-level head counts
  });

  it('FP-B BOM lists head/pipe/fitting quantities from the takeoff', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const b = set.sheets.find((s) => s.code === 'FP-B');
    expect(b.svg).toContain('BILL OF MATERIALS');
    expect(b.svg).toContain('Sprinkler heads');
    expect(b.svg).toContain('540'); // pipeFt
    expect(b.svg).toContain('1.25&quot;'); // a bySize key (escaped quote)
    expect(set.hasBom).toBe(true);
  });

  it('FP-D embeds a section detail when one is supplied, else a stock note', () => {
    const section = {
      ok: true, label: 'Section A-A', bounds: { u0: 0, u1: 40, v0: 0, v1: 12 },
      entities: [
        { type: 'datum', v: 0, label: "FLR 0'" },
        { type: 'rect', kind: 'wall', cut: true, u0: 0, u1: 0.5, v0: 0, v1: 12 },
        { type: 'line', kind: 'pipe', role: 'main', cut: true, a: [2, 10], b: [38, 10] },
        { type: 'head', kind: 'head', cut: true, u: 10, v: 10 },
      ],
      disclaimer: 'Geometric projection — not stamped.',
    };
    const withSec = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom, section });
    const d1 = withSec.sheets.find((s) => s.code === 'FP-D');
    expect(d1.svg).toContain('Section A-A');
    expect(withSec.hasSection).toBe(true);

    const noSec = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const d2 = noSec.sheets.find((s) => s.code === 'FP-D');
    expect(d2.svg).toContain('No section placed');
    expect(noSec.hasSection).toBe(false);
  });

  it('exportReady is false for an empty model (honest)', () => {
    const set = buildSubmittalSheets({ cadModel: { solids: [] } });
    expect(set.exportReady).toBe(false);
    // still produces sheets (with empty-state notes) and a titleblock
    expect(set.sheets.length).toBeGreaterThan(0);
    expect(set.hasTitleblock).toBe(true);
  });

  it('every sheet carries the NOT-AHJ/PE-stamped disclaimer in the footer', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    for (const sh of set.sheets) {
      // footer text is split over two lines, but the leading clause is intact
      expect(sh.svg).toContain('ENGINEERING AID');
      expect(sh.svg).toContain('NOT AHJ-approved');
    }
    expect(SUBMITTAL_SHEETS_DISCLAIMER).toContain('NOT PE-stamped');
  });
});

describe('FP-CS cut-sheet index sheet', () => {
  const bundle = {
    entries: [
      { key: 'head|pendent|K5.6|155F', klass: 'head', label: 'Standard-spray pendent sprinkler, K=5.6, 155°F', count: 8, unit: 'ea', matched: true, ref: { key: 'head_pendent', manufacturer: 'Tyco Fire Products', name: 'Pendent sprinkler head', url: 'https://www.tyco-fire.com/TD_TFP/TFP/TFP171_09_2021.pdf', confidence: 'probable' } },
      { key: 'pipe|2|SCH40', klass: 'pipe', label: '2" SCH40 black steel pipe', count: 120, unit: 'ft', matched: true, ref: { key: 'pipe_sch40', manufacturer: 'Wheatland Tube', name: 'Schedule 40 steel pipe', url: 'https://www.wheatland.com/x.pdf', confidence: 'verified' } },
      { key: 'hanger|listed', klass: 'hanger', label: 'Pipe hangers (listed)', count: 14, unit: 'ea', matched: false, ref: null, reason: 'engineer must supply' },
    ],
    matchedCount: 2,
    disclaimer: 'ENGINEERING AID — cut-sheet REFERENCES... NOT AHJ-approved, NOT PE-stamped.',
  };

  it('adds an FP-CS sheet when a cut-sheet bundle is supplied', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom, cutsheetBundle: bundle });
    expect(set.sheetIds).toContain('FP-CS');
    expect(set.hasCutsheets).toBe(true);
    const cs = set.sheets.find((s) => s.code === 'FP-CS');
    expect(cs.kind).toBe('cutsheets');
    // real content: SKU labels, a public datasheet URL, confidence, and an honest "none"
    expect(cs.svg).toContain('CUT-SHEET INDEX');
    expect(cs.svg).toContain('tyco-fire.com');
    expect(cs.svg).toContain('verified');
    expect(cs.svg).toContain('engineer must supply');
    // titleblock + disclaimer present on the FP-CS sheet
    expect(cs.svg).toContain('FP-CS');
  });

  it('omits FP-CS when no cut-sheet bundle is supplied', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    expect(set.sheetIds).not.toContain('FP-CS');
    expect(set.hasCutsheets).toBe(false);
  });

  it('lists FP-CS in the FP-0 sheet index when present', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), bom, cutsheetBundle: bundle });
    const cover = set.sheets.find((s) => s.code === 'FP-0');
    expect(cover.svg).toContain('FP-CS');
  });
});

describe('renderSheetSetHtml', () => {
  it('produces one printable page per sheet with page-breaks', () => {
    const set = buildSubmittalSheets({ cadModel: makeModel(), hydraulicReport: report, bom });
    const html = renderSheetSetHtml(set, { project: 'Acme HQ' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('page-break-after');
    // one <section class="sheet"> per sheet
    const count = (html.match(/class="sheet"/g) || []).length;
    expect(count).toBe(set.sheets.length);
    expect(html).toContain('Acme HQ');
  });

  it('returns empty string for a null set (no throw)', () => {
    expect(renderSheetSetHtml(null)).toBe('');
  });
});
