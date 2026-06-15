// HaloFire NFPA-13 compliance knowledge base — query helpers.
// Data: src/data/nfpa13-compliance.json (encoded design parameters + NFPA citations,
// NOT copied standard text). ENGINEERING REFERENCE — verify against the adopted
// edition; not a substitute for a PE or AHJ approval. See the JSON `meta.legal`.
import DB from '../data/nfpa13-compliance.json' assert { type: 'json' };

export const COMPLIANCE_DISCLAIMER = DB.meta.disclaimer;
export function complianceMeta() { return DB.meta; }

const HAZARD_KEYS = Object.keys(DB.hazardClasses.classes);

/** Map a free-text occupancy/use to a hazard class key (best-effort; verify). */
export function hazardForOccupancy(occupancy) {
  const t = String(occupancy || '').toLowerCase();
  if (!t) return null;
  for (const key of HAZARD_KEYS) {
    const ex = DB.hazardClasses.classes[key].examples || [];
    for (const e of ex) {
      // tokenize: drop parentheticals, split on / , and spaces; keep words >= 5 chars
      const tokens = e.toLowerCase().replace(/\(.*?\)/g, '').split(/[\/,\s]+/).map((s) => s.trim()).filter((s) => s.length >= 5);
      if (tokens.some((tok) => t.includes(tok))) return key;
    }
  }
  return null; // unknown -> caller must classify explicitly (do not guess a hazard)
}

/** Design density (gpm/ft^2) + design area (ft^2) for a hazard. */
export function designBasis(hazardKey) {
  const d = DB.densityArea.byHazard[hazardKey];
  return d ? { ...d, citation: DB.densityArea.citation, verify: true } : null;
}

/** Max protection area (ft^2) + max spacing (ft) for standard spray at a hazard. */
export function coverage(hazardKey) {
  const c = DB.coverageSpacing.byHazard[hazardKey];
  if (!c) return null;
  return { ...c, minSpacingFt: DB.coverageSpacing.minSpacingFt, citation: DB.coverageSpacing.citation, verify: true };
}

/** Schedule-method max sprinklers for a steel pipe size at a hazard (light/ordinary only). */
export function pipeScheduleMax(hazardKey, sizeIn) {
  const tbl = hazardKey === 'light' ? DB.pipeSchedule.light_steel
    : (hazardKey === 'ordinary_1' || hazardKey === 'ordinary_2') ? DB.pipeSchedule.ordinary_steel : null;
  if (!tbl) return null; // extra hazard / storage -> hydraulic calc required
  const v = tbl[String(sizeIn)];
  return v === undefined ? null : v;
}

/** Fitting equivalent length (ft) for a type + size, C-factor corrected. */
export function fittingLe(type, sizeIn, cFactor = 120) {
  const row = DB.fittingEquivalentLengths.byTypeBySizeIn[type];
  if (!row) return null;
  const base = row[String(sizeIn)];
  if (base === undefined) return null;
  // NFPA C-factor correction relative to the C=120 basis: Le * (C/120)^1.85
  const corrected = base * Math.pow(cFactor / DB.fittingEquivalentLengths.cFactorBasis, 1.85);
  return Math.round(corrected * 100) / 100;
}

/** Estimate the design flowing-head count for a hazard over the design area. */
export function flowingHeadCount(hazardKey) {
  const d = designBasis(hazardKey), c = coverage(hazardKey);
  if (!d || !c) return null;
  return Math.ceil(d.designAreaFt2 / c.maxAreaFt2); // worst-case head count in the remote area
}

/** Required minimum flow per head (gpm) to meet density at full max-coverage spacing. */
export function minHeadFlowGpm(hazardKey) {
  const d = designBasis(hazardKey), c = coverage(hazardKey);
  if (!d || !c) return null;
  return Math.round(d.densityGpmFt2 * c.maxAreaFt2 * 100) / 100; // density * area-per-head
}

export default { COMPLIANCE_DISCLAIMER, complianceMeta, hazardForOccupancy, designBasis, coverage, pipeScheduleMax, fittingLe, flowingHeadCount, minHeadFlowGpm };
