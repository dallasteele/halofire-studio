/**
 * HaloFire CUT-SHEET BUNDLE (Phase 4, chunk 5).
 *
 * Collates a manufacturer CUT SHEET (datasheet) REFERENCE for each distinct SKU
 * actually used in the design, to be appended to the submittal package.
 *
 * HONESTY (load-bearing): this module NEVER fabricates a datasheet. It does two
 * honest things:
 *   1. Derives the DISTINCT USED SKUs from the live reconstructed model + BOM +
 *      hydraulic report (head type by orientation/K-factor/temp; pipe by nominal
 *      size + schedule; fittings/hangers as accessory classes), with real counts.
 *   2. Matches each used SKU to a REAL, PUBLIC manufacturer technical-data-sheet
 *      REFERENCE pulled from the canonical, network-checked catalog
 *      `src/data/cutsheet-urls-fittings.json` (each entry carries a `confidence`
 *      of verified | probable | not-found and an https url or null). When no
 *      reliable public reference exists it honestly flags `matched:false`.
 *
 * What this is NOT: it is not a project-specified product schedule. The catalog
 * entries are REPRESENTATIVE public references for the SKU class (e.g. a standard
 * K5.6 pendent TFP sheet, a Schedule-40 black-steel pipe submittal). The engineer
 * of record must substitute the actually-specified product before submittal.
 *
 * CATALOG INJECTION: the catalog is the canonical JSON. To stay browser-ESM-safe
 * (an `import ... assert {type:'json'}` breaks the Studio's module graph), the
 * host fetches the JSON and passes it in as `input.catalog`. When omitted, a tiny
 * built-in fallback is used so the module is still self-contained for unit tests.
 *
 * PURE + deterministic + browser-free. Unit-tested. The host (autosprink.html)
 * wires `__hfPhase4.cutsheets -> { skus, entries }` and surfaces an FP-CS sheet in
 * the submittal sheet set.
 */

export const CUTSHEETS_DISCLAIMER =
  'ENGINEERING AID — cut-sheet REFERENCES are representative PUBLIC manufacturer '
  + 'datasheets for each used SKU class, NOT a project-specified product schedule. '
  + 'No datasheet content is reproduced or fabricated. The engineer of record must '
  + 'confirm or substitute the actually-specified product before submittal. '
  + 'NOT AHJ-approved, NOT PE-stamped.';

function round(n, p = 2) {
  const m = Math.pow(10, p);
  return Math.round((Number(n) + Number.EPSILON) * m) / m;
}
function num(n, d = 0) { return Number.isFinite(Number(n)) ? Number(n) : d; }

/**
 * Built-in FALLBACK catalog (used only when the host does not inject the canonical
 * JSON). Keys mirror the canonical `cutsheet-urls-fittings.json` registry keys.
 * Confidence/urls here are deliberately conservative; the real catalog is richer.
 */
export const FALLBACK_CATALOG = Object.freeze([
  { key: 'head_pendent', category: 'heads', manufacturer: 'Tyco Fire Products (Johnson Controls)', url: 'https://www.tyco-fire.com/TD_TFP/TFP/TFP171_09_2021.pdf', confidence: 'probable', note: 'Tyco TFP171 — TY-B 5.6K standard-response pendent (public designation; behind Incapsula, body not auto-verified).' },
  { key: 'head_upright', category: 'heads', manufacturer: 'Tyco Fire Products (Johnson Controls)', url: 'https://www.tyco-fire.com/TD_TFP/TFP/TFP171_09_2021.pdf', confidence: 'probable', note: 'Tyco TFP171 — TY-B 5.6K standard-response upright.' },
  { key: 'head_sidewall', category: 'heads', manufacturer: 'Tyco Fire Products (Johnson Controls)', url: 'https://www.tyco-fire.com/TD_TFP/TFP/TFP172_09_2021.pdf', confidence: 'probable', note: 'Tyco TFP172 — TY-B 5.6K horizontal sidewall.' },
  { key: 'head_esfr', category: 'heads', manufacturer: 'Tyco Fire Products (Johnson Controls)', url: 'https://www.tyco-fire.com/TD_TFP/TFP/TFP312_09_2021.pdf', confidence: 'probable', note: 'Tyco TFP312 — TY7126 ESFR K14.0 pendent (K25.2 is TFP315).' },
  { key: 'pipe_sch10', category: 'pipe', manufacturer: 'Wheatland Tube', url: 'https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-10-Submittal-Sheet.pdf', confidence: 'verified', note: 'Wheatland Schedule 10 fire sprinkler pipe submittal (ASTM A135/A795, UL/FM).' },
  { key: 'pipe_sch40', category: 'pipe', manufacturer: 'Wheatland Tube', url: 'https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-40-Submittal-Sheet.pdf', confidence: 'verified', note: 'Wheatland Schedule 40 fire sprinkler pipe submittal (ASTM A53/A795, UL/FM).' },
  { key: 'fitting_coupling', category: 'fittings', manufacturer: 'ASC Engineered Solutions (Anvil)', url: 'https://www.asc-es.com/resource/1121,+1122,+1124+Class+150+Standard+Couplings+&+Cap+Submittal', confidence: 'verified', note: 'Anvil Fig. 1121/1122 Class 150 standard couplings submittal.' },
  { key: 'fitting_tee', category: 'fittings', manufacturer: 'ASC Engineered Solutions (Anvil)', url: 'https://www.asc-es.com/resource/Fig%20358%20Straight%20Tee%20&%20Fig%20360%20Cross%20-%20Submittal', confidence: 'verified', note: 'Anvil Fig. 358 straight tee submittal.' },
  { key: 'grooved_coupling', category: 'grooved', manufacturer: 'Victaulic', url: 'https://assets.victaulic.com/assets/uploads/literature/10.02.pdf', confidence: 'verified', note: 'Victaulic 10.02 FireLock rigid coupling Style 005H submittal.' },
]);

/** Normalise a catalog (array of entries) into a key->entry map. */
function indexCatalog(catalog) {
  const arr = Array.isArray(catalog) && catalog.length ? catalog : FALLBACK_CATALOG;
  const byKey = new Map();
  for (const e of arr) if (e && e.key && !byKey.has(e.key)) byKey.set(e.key, e);
  return byKey;
}

/* ──────────────────────────────────────────────────────────────────────────
 * SKU derivation
 * ────────────────────────────────────────────────────────────────────────── */

/** Snap a numeric K-factor to the nearest catalogued standard K. Null-safe. */
function snapKFactor(k) {
  const std = [5.6, 8.0, 11.2, 14.0, 16.8, 22.4, 25.2];
  if (!Number.isFinite(k) || k <= 0) return null;
  let best = std[0], bd = Infinity;
  for (const s of std) { const d = Math.abs(s - k); if (d < bd) { bd = d; best = s; } }
  return Math.abs(best - k) / best <= 0.12 ? best : round(k, 1);
}

/** Map a nominal pipe diameter (in) to a schedule string. >=4" -> SCH10 (mains). */
function pipeSchedule(diaIn) {
  return num(diaIn, 0) >= 4 ? 'SCH10' : 'SCH40';
}

/** Map a derived SKU to its canonical catalog registry key (or null). */
function catalogKeyForSku(sku) {
  if (!sku) return null;
  if (sku.klass === 'head') {
    const a = sku.attrs;
    if (a.esfr) return 'head_esfr';
    if (a.orientation === 'upright') return 'head_upright';
    if (a.orientation === 'sidewall' || a.orientation === 'horizontal_sidewall') return 'head_sidewall';
    return 'head_pendent';
  }
  if (sku.klass === 'pipe') return sku.attrs.schedule === 'SCH10' ? 'pipe_sch10' : 'pipe_sch40';
  if (sku.klass === 'fitting') return 'fitting_coupling';
  if (sku.klass === 'hanger') return 'hanger_listed'; // not in catalog -> honest unmatched
  return null;
}

/**
 * Derive the distinct USED SKUs from the live model. PURE.
 *
 * @param {object} input
 *   @param {{solids:Array}} input.cadModel
 *   @param {object} [input.bom]               __hfBomTakeoff (derived couplings/hangers)
 *   @param {object} [input.hydraulicReport]   __hf3.report (K-factor / hazard signal)
 * @returns {Array<{key,klass,label,count,unit,attrs}>}
 */
export function deriveUsedSkus(input = {}) {
  const cadModel = input.cadModel || {};
  const solids = Array.isArray(cadModel.solids) ? cadModel.solids : [];
  const bom = input.bom || null;
  const report = input.hydraulicReport || null;
  const summary = report && report.summary ? report.summary : null;

  const reportK = summary && summary.kFactor != null ? snapKFactor(Number(summary.kFactor)) : null;
  const isEsfr = !!(summary && (
    /esfr|storage/i.test(String(summary.hazardLabel || summary.hazard || ''))
    || (reportK != null && reportK >= 11.2)
  ));

  const skus = [];

  // ── HEADS: group by orientation + (snapped) K-factor + temp rating ──
  const headGroups = new Map();
  for (const s of solids) {
    if (s.kind !== 'head') continue;
    const orientation = String(s.orientation || 'pendent').toLowerCase();
    const kRaw = Number.isFinite(Number(s.kFactor)) ? Number(s.kFactor)
      : (reportK != null ? reportK : 5.6);
    const k = snapKFactor(kRaw) != null ? snapKFactor(kRaw) : round(kRaw, 1);
    const temp = Number.isFinite(Number(s.tempRatingF)) ? Number(s.tempRatingF) : 155;
    const key = `head|${orientation}|K${k}|${temp}F${isEsfr ? '|esfr' : ''}`;
    const g = headGroups.get(key) || {
      key, klass: 'head', count: 0, unit: 'ea',
      attrs: { orientation, kFactor: k, tempRatingF: temp, esfr: isEsfr },
    };
    g.count++;
    headGroups.set(key, g);
  }
  for (const g of headGroups.values()) {
    const a = g.attrs;
    g.label = `${a.esfr ? 'ESFR ' : 'Standard-spray '}${a.orientation} sprinkler, K=${a.kFactor}, ${a.tempRatingF}°F`;
    skus.push(g);
  }

  // ── PIPE: group by nominal diameter + schedule ──
  const pipeGroups = new Map();
  for (const s of solids) {
    if (s.kind !== 'pipe' || !Array.isArray(s.from) || !Array.isArray(s.to)) continue;
    if (!Number.isFinite(Number(s.diameterIn))) continue;
    const dia = round(Number(s.diameterIn), 2);
    const sched = pipeSchedule(dia);
    const key = `pipe|${dia}|${sched}`;
    const lenFt = Math.hypot(
      (s.to[0] - s.from[0]), (s.to[1] - s.from[1]), ((s.to[2] || 0) - (s.from[2] || 0)),
    );
    const g = pipeGroups.get(key) || {
      key, klass: 'pipe', count: 0, unit: 'ft', lengthFt: 0,
      attrs: { diameterIn: dia, schedule: sched, material: 'black steel' },
    };
    g.count++; g.lengthFt += lenFt;
    pipeGroups.set(key, g);
  }
  for (const g of pipeGroups.values()) {
    g.lengthFt = Math.round(g.lengthFt);
    g.count = g.lengthFt; // for pipe the "quantity" is feet
    g.label = `${g.attrs.diameterIn}" ${g.attrs.schedule} ${g.attrs.material} pipe`;
    skus.push(g);
  }

  // ── FITTINGS / COUPLINGS / HANGERS ──
  const fittingsCount = solids.filter((s) => s.kind === 'component').length
    || num(bom && bom.fittings, 0);
  const couplings = num(bom && bom.couplings, 0);
  if (fittingsCount > 0) {
    skus.push({
      key: 'fitting|coupling', klass: 'fitting', count: fittingsCount, unit: 'ea',
      label: 'Pipe fittings / couplings (listed)', attrs: { kind: 'fitting' },
    });
  } else if (couplings > 0) {
    skus.push({
      key: 'fitting|coupling', klass: 'fitting', count: couplings, unit: 'ea',
      label: 'Grooved couplings (derived)', attrs: { kind: 'coupling' },
    });
  }
  const hangers = num(bom && bom.hangers, 0);
  if (hangers > 0) {
    skus.push({
      key: 'hanger|listed', klass: 'hanger', count: hangers, unit: 'ea',
      label: 'Pipe hangers (listed)', attrs: { kind: 'hanger' },
    });
  }

  const order = { head: 0, pipe: 1, fitting: 2, hanger: 3 };
  skus.sort((a, b) => {
    if (order[a.klass] !== order[b.klass]) return order[a.klass] - order[b.klass];
    if (a.klass === 'pipe') return num(b.attrs.diameterIn) - num(a.attrs.diameterIn);
    if (a.klass === 'head') return num(b.attrs.kFactor) - num(a.attrs.kFactor);
    return a.key < b.key ? -1 : 1;
  });
  return skus;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Catalog matching
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Best public-datasheet reference for a derived SKU against an indexed catalog.
 * Returns the catalog entry, or null when no reliable public reference exists.
 */
export function matchDatasheet(sku, byKey) {
  const idx = (byKey instanceof Map) ? byKey : indexCatalog(byKey);
  const ck = catalogKeyForSku(sku);
  if (!ck) return null;
  const e = idx.get(ck);
  if (!e || !e.url || e.confidence === 'not-found') return null;
  return e;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Public builder
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Build the cut-sheet bundle: every distinct used SKU paired with its best public
 * datasheet REFERENCE (link/record), honestly flagging anything unmatched.
 *
 * @param {object} input  (deriveUsedSkus shape) + optional `catalog` (JSON array)
 * @returns {{ skus, entries, skuCount, matchedCount, unmatched, exportReady,
 *             disclaimer, generatedAt }}
 */
export function buildCutsheetBundle(input = {}) {
  const byKey = indexCatalog(input.catalog);
  const skus = deriveUsedSkus(input);
  const entries = skus.map((sku) => {
    const ref = matchDatasheet(sku, byKey);
    const matched = !!ref;
    return {
      key: sku.key,
      klass: sku.klass,
      label: sku.label,
      count: sku.count,
      unit: sku.unit,
      lengthFt: sku.lengthFt != null ? sku.lengthFt : undefined,
      attrs: sku.attrs,
      catalogKey: catalogKeyForSku(sku),
      matched,
      ref: matched
        ? {
          key: ref.key,
          manufacturer: ref.manufacturer || null,
          name: ref.name || null,
          url: ref.url,
          docNo: ref.docNo || null,
          confidence: ref.confidence || 'probable',
          note: ref.note || null,
        }
        : null,
      reason: matched ? null
        : 'No reliable PUBLIC datasheet reference for this SKU class in the catalog — engineer must supply the specified product cut sheet.',
    };
  });
  const matchedCount = entries.filter((e) => e.matched).length;
  return {
    skus,
    entries,
    skuCount: skus.length,
    matchedCount,
    unmatched: entries.filter((e) => !e.matched).map((e) => e.key),
    exportReady: skus.length > 0,
    disclaimer: CUTSHEETS_DISCLAIMER,
    generatedAt: input.generatedAt || null,
  };
}
