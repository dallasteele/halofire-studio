/**
 * Stream B — per-project REAL plan-sheet manifest for PDF underlays.
 *
 * Points at the actual bid plan PDFs the user supplied (The Cooperative 1881
 * Apartments, Salt Lake City UT — "GC - Bid Plans" set, Bluebeam vector PDFs).
 * The PDFs are served from the app's static root under /plans/<project>/.
 *
 * Plain data + pure helpers only — no three.js, no pdfjs, no I/O. The engine
 * modules (pdf-underlay.js, building-levels.js) consume this.
 *
 * HONESTY / FLAG-DONT-GATE:
 *  - Sheet->page mappings marked verified:'page-label' come from the PDF's own
 *    page labels (Bluebeam writes sheet number + title as the page label).
 *    Those are REAL document facts, but they are still machine-read, so the
 *    whole manifest carries needsVerification:true.
 *  - Mappings marked verified:'text-heuristic' come from scanning page text
 *    for sheet-code tokens; they are best-effort INFERENCE and individually
 *    flagged needsVerification:true.
 *  - Elevations are ESTIMATED (uniform floor-to-floor); no structural datum was
 *    machine-verified. elevationSource says exactly that. NEVER present these
 *    as AHJ/PE/manufacturer-exact or AutoSprink-parity data.
 *
 * Home Depot — Rexburg ID: NO plan PDFs exist anywhere in the workspace (only
 * the proposal workbook), so it has no manifest here; helpers return null and
 * callers must surface "no real plans supplied" instead of fabricating.
 */

export const PLAN_DISCIPLINES = Object.freeze([
  'arch', 'rcp', 'struct', 'mech', 'elec', 'plumb',
]);

// Estimated uniform floor-to-floor. NOT machine-verified against the building
// sections; operators must confirm against A-301..A-307 / S-sheets.
export const ESTIMATED_FLOOR_TO_FLOOR_FT = 10.5;

const PLAN_ROOT = '/plans/cooperative-1881';

function sheet(file, page, code, title, discipline, verified) {
  return Object.freeze({
    file,
    url: `${PLAN_ROOT}/${file}`,
    page,
    sheet: code,
    title,
    discipline,
    // 'page-label' = read from the PDF's own page labels (real document fact);
    // 'text-heuristic' = inferred from page text token frequency.
    verified,
    needsVerification: true,
  });
}

const ARCH = '1881-architecturals.pdf';
const STRUCT = '1881-structurals.pdf';
const MECH = '1881-mechanical.pdf';
const ELEC = '1881-electrical.pdf';
const PLUMB = '1881-plumbing.pdf';

const LEVEL_WORDS = [null, 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH'];

function cooperative1881Levels() {
  const levels = [];
  for (let n = 1; n <= 8; n++) {
    const word = LEVEL_WORDS[n];
    const sheets = [
      // Architectural overall floor plans: pages verified via PDF page labels.
      // A-101..A-108 sit at pages 8,11,14,17,20,23,26,29 (3-page stride: overall, area A, area B).
      sheet(ARCH, 8 + (n - 1) * 3, `A-10${n}`, `OVERALL ${word} FLOOR PLAN`, 'arch', 'page-label'),
      // Reflected ceiling plans A-151..A-158 at pages 33,36,...,54 (same stride).
      sheet(ARCH, 33 + (n - 1) * 3, `A-15${n}`, `OVERALL ${word} FLOOR REFLECTED CEILING PLAN`, 'rcp', 'page-label'),
    ];
    // Structural overall plans (page labels): S-110 foundation (level 1) p8,
    // then S-120..S-180 at pages 21,30,39,50,53,56,59.
    const STRUCT_PAGES = [null, 8, 21, 30, 39, 50, 53, 56, 59];
    const structTitle = n === 1 ? 'OVERALL FOOTING AND FOUNDATION PLAN' : `OVERALL ${word} FLOOR PLAN`;
    sheets.push(sheet(STRUCT, STRUCT_PAGES[n], n === 1 ? 'S-110' : `S-1${n}0`, structTitle, 'struct', 'page-label'));
    // Electrical: E201..E208 ladder observed at pages 9..16 (text heuristic —
    // assumed one lighting/power plan per level; NOT label-verified).
    sheets.push(sheet(ELEC, 8 + n, `E-20${n}`, `LEVEL ${n} ELECTRICAL PLAN (heuristic)`, 'elec', 'text-heuristic'));
    // Plumbing: per-level fixture-plan ladder observed at pages 2..9 (text
    // heuristic — P101..P108 assumed; NOT label-verified).
    sheets.push(sheet(PLUMB, 1 + n, `P-10${n}`, `LEVEL ${n} PLUMBING PLAN (heuristic)`, 'plumb', 'text-heuristic'));
    levels.push(Object.freeze({
      level: n,
      name: `Level ${n}`,
      elevationFt: Math.round((n - 1) * ESTIMATED_FLOOR_TO_FLOOR_FT * 100) / 100,
      elevationSource: 'ESTIMATED_FLOOR_TO_FLOOR_NOT_VERIFIED',
      sheets: Object.freeze(sheets),
    }));
  }
  return Object.freeze(levels);
}

export function cooperative1881PlanManifest() {
  return Object.freeze({
    project: 'The Cooperative 1881 - Salt Lake City UT',
    bidId: '1881',
    units: 'ft',
    planRootUrl: PLAN_ROOT,
    needsVerification: true,
    provenance: Object.freeze({
      sourceDir: 'GC - Bid Plans (user-supplied bid set, Bluebeam vector PDFs)',
      inventoriedAt: '2026-06-12',
      method: 'pdfjs page labels (arch/struct) + page-text sheet-code heuristic (mech/elec/plumb)',
    }),
    // Known project footprint from the existing bid fixtures (best-effort).
    footprint: Object.freeze({ widthFt: 413, depthFt: 413.2, source: 'cooperative1881FloorPlan() fixture — needs verification' }),
    estimatedFloorToFloorFt: ESTIMATED_FLOOR_TO_FLOOR_FT,
    levels: cooperative1881Levels(),
    // Whole-document inventory (real page counts), incl. sets not mapped to
    // levels. Mechanical pages 5..24 appear to be M101..M120 sequential but a
    // per-level mech mapping was NOT confident enough to assert — flagged out.
    documents: Object.freeze([
      Object.freeze({ file: ARCH, url: `${PLAN_ROOT}/${ARCH}`, discipline: 'arch', pages: 110, pageLabels: true }),
      Object.freeze({ file: STRUCT, url: `${PLAN_ROOT}/${STRUCT}`, discipline: 'struct', pages: 104, pageLabels: true }),
      Object.freeze({ file: MECH, url: `${PLAN_ROOT}/${MECH}`, discipline: 'mech', pages: 24, pageLabels: false, levelMapping: 'NOT_CONFIDENT — operator must map M-sheets to levels' }),
      Object.freeze({ file: ELEC, url: `${PLAN_ROOT}/${ELEC}`, discipline: 'elec', pages: 33, pageLabels: false }),
      Object.freeze({ file: PLUMB, url: `${PLAN_ROOT}/${PLUMB}`, discipline: 'plumb', pages: 29, pageLabels: false }),
      Object.freeze({ file: '1881-civils.pdf', url: `${PLAN_ROOT}/1881-civils.pdf`, discipline: 'civil-site', pages: 15, pageLabels: false }),
      Object.freeze({ file: '1881-generals.pdf', url: `${PLAN_ROOT}/1881-generals.pdf`, discipline: 'general', pages: 21, pageLabels: false }),
      Object.freeze({ file: '1881-landscape.pdf', url: `${PLAN_ROOT}/1881-landscape.pdf`, discipline: 'landscape-site', pages: 6, pageLabels: false }),
      Object.freeze({ file: '1881-geopiers.pdf', url: `${PLAN_ROOT}/1881-geopiers.pdf`, discipline: 'geotech-site', pages: 3, pageLabels: false }),
    ]),
  });
}

const MANIFESTS = Object.freeze([cooperative1881PlanManifest()]);

export function listPlanManifests() {
  return MANIFESTS;
}

/** Case-insensitive project lookup; returns null when no REAL plans exist. */
export function manifestForProject(projectName) {
  const q = String(projectName || '').toLowerCase();
  if (!q) return null;
  for (const m of MANIFESTS) {
    if (m.project.toLowerCase() === q) return m;
    if (q.includes('1881') && m.bidId === '1881') return m;
  }
  return null;
}

/** Sheets for one level, optionally filtered by discipline. */
export function sheetsForLevel(manifest, level, discipline = null) {
  if (!manifest || !Array.isArray(manifest.levels)) return [];
  const lvl = manifest.levels.find((l) => l.level === Number(level));
  if (!lvl) return [];
  if (!discipline) return [...lvl.sheets];
  return lvl.sheets.filter((s) => s.discipline === discipline);
}
