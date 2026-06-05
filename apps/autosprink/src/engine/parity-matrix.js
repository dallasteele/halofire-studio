/**
 * HaloFire AutoSprink parity matrix (internal alpha, best-effort).
 *
 * buildParityMatrix(state) computes the AutoSprink feature-area parity matrix
 * from the actual module/inventory state of the system. Each area is reported as
 * one of 'present' | 'partial' | 'missing' | 'gated' with a short evidence string.
 *
 * Three areas are GATED by design — AHJ approval, licensed-professional (PE)
 * review, and manufacturer-exact component models. A gated area is NEVER
 * auto-present: it requires a REAL real-world evidence artifact (an AHJ approval,
 * a PE sign-off, or a manufacturer catalog/approval). Best-effort, AI, or
 * GENERATED (OpenSCAD/SAM) output does NOT satisfy a gated area.
 *
 * parityAchieved(matrix, inventory) returns false unless EVERY non-gated area is
 * 'present' AND every gated area carries real evidence. A generated-only model
 * inventory can never achieve parity.
 *
 * HONESTY / fail-closed: this module computes a status surface only. It NEVER
 * flips the AUTOSPRINK_PARITY gate, and it NEVER claims AutoSprink/AutoCAD parity,
 * AHJ approval, PE review, permit-readiness, manufacturer approval, or
 * fabrication-readiness. All engineering output is a best-effort estimate.
 *
 * Pure, deterministic, browser-free. Calls no binaries.
 */

export const PARITY_MATRIX_DISCLAIMER =
  'best-effort internal alpha parity matrix — functional feature coverage only. '
  + 'A "present" status means the HaloFire module exists and produces output; it is '
  + 'NOT a claim of AutoSprink/AutoCAD parity. The AHJ, PE-review, and '
  + 'manufacturer-exact rows are GATED and require real-world evidence — generated '
  + '(OpenSCAD/SAM) or best-effort output never satisfies them. Nothing here is '
  + 'AHJ-approved, PE-reviewed, permit-ready, manufacturer-approved, or '
  + 'fabrication-ready. Professional review and approval are required.';

/**
 * Evidence values that count as REAL for a gated area. A gated row is satisfied
 * only when its evidence is one of these — generated/best-effort never qualifies.
 */
const REAL_GATED_EVIDENCE = Object.freeze(['catalog', 'pe', 'ahj', 'manufacturer']);

/**
 * Canonical parity area definitions, mirroring the roadmap parity matrix.
 * Each entry derives its status from a slice of `state`. `gated:true` rows are
 * fail-closed: their status is 'gated' unless `realEvidence(state)` is truthy.
 */
const AREA_DEFS = Object.freeze([
  {
    key: 'drawing_import',
    name: 'Drawing import (DXF/SVG)',
    gated: false,
    status: (s) => (s.drawingImport ? 'present' : 'missing'),
    present: 'DXF/SVG floor-plan + building import (PDF import deferred).',
    missing: 'No drawing import available.',
  },
  {
    key: 'building_modeling',
    name: 'Building + multi-space modeling (walls/openings/columns)',
    gated: false,
    status: (s) => (s.buildingModeling ? 'present' : 'missing'),
    present: 'Multi-space building model with walls, openings, and columns.',
    missing: 'No building modeling available.',
  },
  {
    key: 'head_layout',
    name: 'Head layout (NFPA-13 spacing, hazard)',
    gated: false,
    status: (s) => (s.headLayout ? 'present' : 'missing'),
    present: 'NFPA-13 spacing/hazard head auto-layout.',
    missing: 'No head layout available.',
  },
  {
    key: 'schedule_sizing',
    name: 'Pipe routing + schedule sizing',
    gated: false,
    status: (s) => (s.scheduleSizing ? 'present' : 'missing'),
    present: 'Pipe routing with schedule-based size selection.',
    missing: 'No pipe routing / schedule sizing available.',
  },
  {
    key: 'hydraulic_network',
    name: 'Full hydraulic network balance',
    gated: false,
    status: (s) => (s.hydraulicNetwork ? 'present' : 'missing'),
    present: 'Best-effort iterative network balance (Q=K√P, node pressures).',
    missing: 'No hydraulic network balance available.',
  },
  {
    key: 'nfpa_compliance',
    name: 'NFPA-13 compliance checker',
    gated: false,
    status: (s) => (s.nfpaCompliance ? 'present' : 'missing'),
    present: 'Best-effort geometric NFPA-13 checks (clears no gate).',
    missing: 'No NFPA-13 compliance checker available.',
  },
  {
    key: 'supports',
    name: 'Hanger / seismic support placement',
    gated: false,
    status: (s) => (s.supports ? 'present' : 'missing'),
    present: 'Best-effort hanger + seismic brace spacing placement.',
    missing: 'No support placement available.',
  },
  {
    key: 'component_library',
    name: 'Component CAD model library',
    gated: false,
    status: (s) => (s.componentLibrary ? 'present' : 'missing'),
    present: 'Generated (best-effort) component model library; manufacturer-exact is gated.',
    missing: 'No component model library available.',
  },
  {
    key: 'submittal',
    name: 'Submittal package + PDF report',
    gated: false,
    status: (s) => (s.submittal ? 'present' : 'missing'),
    present: 'Best-effort submittal package + PDF report (not a stamped submittal).',
    missing: 'No submittal package available.',
  },
  {
    key: 'cad_export',
    name: '3D model + CAD export (DXF/STEP/IFC/STL)',
    gated: false,
    status: (s) => (s.cadExport ? 'present' : 'missing'),
    present: '3D CAD model with DXF/STEP/IFC/STL export.',
    missing: 'No CAD export available.',
  },
  {
    key: 'bid_bom',
    name: 'Bid / takeoff / BOM / full scope',
    gated: false,
    status: (s) => (s.bidBom ? 'present' : 'missing'),
    present: 'Best-effort bid/takeoff/BOM scope.',
    missing: 'No bid/BOM available.',
  },
  {
    key: 'evidence_settings',
    name: 'Evidence gates + resolve workflow + Settings doc upload',
    gated: false,
    status: (s) => (s.evidenceSettings ? 'present' : 'missing'),
    present: 'Fail-closed evidence gates, resolve workflow, and Settings doc upload.',
    missing: 'No evidence/settings workflow available.',
  },
  // ---- GATED rows (real-world evidence only) --------------------------------
  {
    key: 'ahj_approval',
    name: 'AHJ approval',
    gated: true,
    realEvidence: (s) => s.ahjEvidence,
    cleared: 'AHJ approval evidence on file.',
    gatedNote: 'GATED: requires a real AHJ approval artifact. Generated/best-effort output does not satisfy this.',
  },
  {
    key: 'pe_review',
    name: 'Licensed professional (PE) review / stamp',
    gated: true,
    realEvidence: (s) => s.peEvidence,
    cleared: 'Licensed professional review/sign-off on file.',
    gatedNote: 'GATED: requires a real PE review/sign-off. Generated/best-effort output does not satisfy this.',
  },
  {
    key: 'manufacturer_exact',
    name: 'Manufacturer-exact component models / approval',
    gated: true,
    realEvidence: (s) => s.manufacturerEvidence,
    cleared: 'Manufacturer catalog/approval evidence on file.',
    gatedNote: 'GATED: requires manufacturer catalog/approval. Generated (OpenSCAD/SAM) models are NOT manufacturer-exact.',
  },
]);

/** Frozen list of every parity area key, in matrix order. */
export const PARITY_AREA_KEYS = Object.freeze(AREA_DEFS.map((d) => d.key));

/** Does a gated row's evidence value count as REAL (vs generated/best-effort)? */
function gatedEvidenceIsReal(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return REAL_GATED_EVIDENCE.includes(value.trim().toLowerCase());
}

/**
 * Build the AutoSprink parity matrix from the actual module/inventory state.
 *
 * @param {Record<string, unknown>} [state]
 * @returns {{
 *   areas: Array<{key:string,name:string,status:'present'|'partial'|'missing'|'gated',evidence:string,gated:boolean}>,
 *   requiredComplete: boolean,
 *   gated: string[],
 *   disclaimer: string,
 * }}
 */
export function buildParityMatrix(state = {}) {
  const s = state || {};
  const areas = AREA_DEFS.map((def) => {
    if (def.gated) {
      const real = gatedEvidenceIsReal(def.realEvidence(s));
      return {
        key: def.key,
        name: def.name,
        gated: true,
        // A gated row only ever reports 'present' (cleared) when REAL evidence
        // exists; otherwise it stays 'gated'. It is never auto-present.
        status: real ? 'present' : 'gated',
        evidence: real ? def.cleared : def.gatedNote,
      };
    }
    const status = def.status(s);
    return {
      key: def.key,
      name: def.name,
      gated: false,
      status,
      evidence: status === 'present' ? def.present : def.missing,
    };
  });

  const requiredComplete = areas
    .filter((a) => !a.gated)
    .every((a) => a.status === 'present');

  return {
    areas,
    requiredComplete,
    gated: areas.filter((a) => a.gated).map((a) => a.key),
    disclaimer: PARITY_MATRIX_DISCLAIMER,
  };
}

/**
 * Whether genuine AutoSprink parity is achieved. Fail-closed:
 *   - every non-gated area MUST be 'present', AND
 *   - every gated area MUST have a real (catalog/pe/ahj/manufacturer) cleared row.
 *
 * A generated-only component inventory NEVER achieves parity: generated models
 * are best-effort, not manufacturer-exact, so they cannot clear the gated rows.
 *
 * @param {ReturnType<typeof buildParityMatrix>} matrix
 * @param {{ generatedOnly?: boolean }} [inventory]
 * @returns {boolean}
 */
export function parityAchieved(matrix, inventory = {}) {
  if (!matrix || !Array.isArray(matrix.areas)) return false;
  // Generated-only inventories can never satisfy the manufacturer-exact gate.
  if (inventory && inventory.generatedOnly === true) return false;
  if (!matrix.requiredComplete) return false;
  // Every gated row must be cleared with real evidence (status flipped to present).
  const gatedRows = matrix.areas.filter((a) => a.gated);
  return gatedRows.length > 0 && gatedRows.every((a) => a.status === 'present');
}
