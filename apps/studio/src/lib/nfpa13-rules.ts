// PURE NFPA-13 design-value + formula logic — no React / three / DOM imports.
//
// Implements ONLY real, published NFPA-13 (and the standard hydraulic formulas
// NFPA 13 incorporates) design values/formulas. EVERY numeric code constant in
// the RULES table carries a non-empty citation string (NFPA 13 section/table +
// edition, or the source standard for incorporated formulas). An uncited or
// fabricated constant is a FAIL.
//
// HONESTY (hard, fail-closed): this is a DESIGN AID built from published values.
// It is NOT a certified hydraulic calculation, NOT AHJ-approved, NOT PE-sealed,
// NOT NFPA-13 code compliance, and NOT for construction or permit. Where we are
// NOT certain of an exact published number we leave it `null` with a TODO-cite
// note (see UNCERTAIN_VALUES) rather than fabricate a code value. Numbers below
// reflect the commonly-cited standard-spray values; the AHJ-adopted edition is
// authoritative — always verify against it.
//
// Edition note: NFPA 13 has been reorganized across editions (2016 -> 2019 ->
// 2022 -> 2025); section numbers below are the COMMONLY-CITED locations and may
// shift by edition. Citations name the table/section + that this is edition-
// dependent. See the research doc §1 edition caveat.

/** Hazard classification (standard-spray density basis). */
export type HazardClass =
  | 'light'
  | 'ordinary_1'
  | 'ordinary_2'
  | 'extra_1'
  | 'extra_2';

export const HAZARD_CLASSES: readonly HazardClass[] = [
  'light',
  'ordinary_1',
  'ordinary_2',
  'extra_1',
  'extra_2',
] as const;

/**
 * One published code value/limit. `value` is the numeric constant; `citation`
 * names where it comes from and MUST be non-empty. `unit` documents the unit.
 * A null value means "not certain — do not fabricate" and MUST still carry a
 * citation describing what to verify.
 */
export interface CodeRule {
  id: string;
  /** What this rule constrains, in plain language. */
  description: string;
  value: number | null;
  unit: string;
  /** NFPA 13 (or incorporated-standard) reference. NEVER empty. */
  citation: string;
}

/**
 * Maximum protection area per sprinkler (ft²) by hazard class, standard-spray,
 * unobstructed construction. These are the long-standing, widely-published
 * NFPA-13 design-area-per-sprinkler limits.
 *
 * Light 225 ft²; Ordinary (Group 1 & 2) 130 ft²; Extra (Group 1 & 2) 100 ft²
 * (for hydraulically-calculated systems). Verify against the adopted edition's
 * protection-area table.
 */
export const MAX_PROTECTION_AREA_SQFT: Record<HazardClass, CodeRule> = {
  light: {
    id: 'area.light',
    description: 'Max protection area per sprinkler — Light hazard, standard spray',
    value: 225,
    unit: 'ft^2',
    citation:
      'NFPA 13 max area/sprinkler — Light hazard 225 ft^2 (standard-spray, hydraulically calculated). Protection-area-and-spacing table; edition-dependent (e.g. 2019 §10.2.4 / 2016 §8.6.2). Verify adopted edition.',
  },
  ordinary_1: {
    id: 'area.ordinary_1',
    description: 'Max protection area per sprinkler — Ordinary Group 1, standard spray',
    value: 130,
    unit: 'ft^2',
    citation:
      'NFPA 13 max area/sprinkler — Ordinary hazard (Group 1) 130 ft^2 (standard-spray, hydraulically calculated). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  ordinary_2: {
    id: 'area.ordinary_2',
    description: 'Max protection area per sprinkler — Ordinary Group 2, standard spray',
    value: 130,
    unit: 'ft^2',
    citation:
      'NFPA 13 max area/sprinkler — Ordinary hazard (Group 2) 130 ft^2 (standard-spray, hydraulically calculated). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  extra_1: {
    id: 'area.extra_1',
    description: 'Max protection area per sprinkler — Extra Group 1, standard spray',
    value: 100,
    unit: 'ft^2',
    citation:
      'NFPA 13 max area/sprinkler — Extra hazard (Group 1) 100 ft^2 (standard-spray, hydraulically calculated). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  extra_2: {
    id: 'area.extra_2',
    description: 'Max protection area per sprinkler — Extra Group 2, standard spray',
    value: 100,
    unit: 'ft^2',
    citation:
      'NFPA 13 max area/sprinkler — Extra hazard (Group 2) 100 ft^2 (standard-spray, hydraulically calculated). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
};

/**
 * Maximum distance between sprinklers (and on branch lines / between branch
 * lines), ft, standard-spray. Light & Ordinary 15 ft; Extra 12 ft. These are
 * the long-standing maximum-spacing limits.
 */
export const MAX_SPACING_FT: Record<HazardClass, CodeRule> = {
  light: {
    id: 'spacing.light',
    description: 'Max spacing between sprinklers — Light hazard, standard spray',
    value: 15,
    unit: 'ft',
    citation:
      'NFPA 13 max distance between sprinklers — Light hazard 15 ft (standard-spray). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  ordinary_1: {
    id: 'spacing.ordinary_1',
    description: 'Max spacing between sprinklers — Ordinary Group 1, standard spray',
    value: 15,
    unit: 'ft',
    citation:
      'NFPA 13 max distance between sprinklers — Ordinary hazard 15 ft (standard-spray). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  ordinary_2: {
    id: 'spacing.ordinary_2',
    description: 'Max spacing between sprinklers — Ordinary Group 2, standard spray',
    value: 15,
    unit: 'ft',
    citation:
      'NFPA 13 max distance between sprinklers — Ordinary hazard 15 ft (standard-spray). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  extra_1: {
    id: 'spacing.extra_1',
    description: 'Max spacing between sprinklers — Extra Group 1, standard spray',
    value: 12,
    unit: 'ft',
    citation:
      'NFPA 13 max distance between sprinklers — Extra hazard 12 ft (standard-spray). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
  extra_2: {
    id: 'spacing.extra_2',
    description: 'Max spacing between sprinklers — Extra Group 2, standard spray',
    value: 12,
    unit: 'ft',
    citation:
      'NFPA 13 max distance between sprinklers — Extra hazard 12 ft (standard-spray). Protection-area-and-spacing table; edition-dependent. Verify adopted edition.',
  },
};

/**
 * Maximum distance from a sprinkler to a wall = one-half the maximum allowable
 * distance between sprinklers (the long-standing NFPA-13 rule that the wall
 * distance shall not exceed one-half of the allowable distance between
 * sprinklers). Light/Ordinary -> 7.5 ft; Extra -> 6 ft.
 */
export const MAX_DISTANCE_TO_WALL_FT: Record<HazardClass, CodeRule> = {
  light: {
    id: 'wall.light',
    description: 'Max distance from sprinkler to wall — Light hazard',
    value: 7.5,
    unit: 'ft',
    citation:
      'NFPA 13 — distance to wall <= one-half max distance between sprinklers; Light 15 ft -> 7.5 ft. Edition-dependent. Verify adopted edition.',
  },
  ordinary_1: {
    id: 'wall.ordinary_1',
    description: 'Max distance from sprinkler to wall — Ordinary Group 1',
    value: 7.5,
    unit: 'ft',
    citation:
      'NFPA 13 — distance to wall <= one-half max distance between sprinklers; Ordinary 15 ft -> 7.5 ft. Edition-dependent. Verify adopted edition.',
  },
  ordinary_2: {
    id: 'wall.ordinary_2',
    description: 'Max distance from sprinkler to wall — Ordinary Group 2',
    value: 7.5,
    unit: 'ft',
    citation:
      'NFPA 13 — distance to wall <= one-half max distance between sprinklers; Ordinary 15 ft -> 7.5 ft. Edition-dependent. Verify adopted edition.',
  },
  extra_1: {
    id: 'wall.extra_1',
    description: 'Max distance from sprinkler to wall — Extra Group 1',
    value: 6,
    unit: 'ft',
    citation:
      'NFPA 13 — distance to wall <= one-half max distance between sprinklers; Extra 12 ft -> 6 ft. Edition-dependent. Verify adopted edition.',
  },
  extra_2: {
    id: 'wall.extra_2',
    description: 'Max distance from sprinkler to wall — Extra Group 2',
    value: 6,
    unit: 'ft',
    citation:
      'NFPA 13 — distance to wall <= one-half max distance between sprinklers; Extra 12 ft -> 6 ft. Edition-dependent. Verify adopted edition.',
  },
};

/**
 * Minimum distance BETWEEN sprinklers (head-to-head), ft — the long-standing
 * NFPA-13 minimum of 6 ft between standard-spray sprinklers (to prevent cold
 * soldering / spray interference), absent a permitted baffle. Applies across
 * hazard classes for standard-spray.
 */
export const MIN_HEAD_TO_HEAD_FT: CodeRule = {
  id: 'min.head_to_head',
  description: 'Minimum distance between standard-spray sprinklers (no baffle)',
  value: 6,
  unit: 'ft',
  citation:
    'NFPA 13 minimum distance between sprinklers — 6 ft for standard-spray (unless a baffle is installed). Edition-dependent (e.g. 2019 §10.2.5 / 2016 §8.6.3). Verify adopted edition.',
};

/**
 * Hazen-Williams roughness coefficient C by pipe material — the values NFPA 13
 * specifies for friction-loss calculation. Higher C = smoother pipe = less loss.
 * Black/galvanized steel (dry) C=100; black/galvanized steel (wet) C=120; cement-
 * lined cast/ductile iron C=140; copper tube C=150; CPVC (plastic) C=150.
 */
export const HAZEN_WILLIAMS_C: Record<string, CodeRule> = {
  steel_dry: {
    id: 'hw.steel_dry',
    description: 'Hazen-Williams C — unlined black/galvanized steel, dry/preaction',
    value: 100,
    unit: 'dimensionless',
    citation:
      'NFPA 13 Hazen-Williams C-factor table — unlined steel (dry/preaction) C=100. Friction-loss C-value table; edition-dependent. Verify adopted edition.',
  },
  steel_wet: {
    id: 'hw.steel_wet',
    description: 'Hazen-Williams C — unlined black/galvanized steel, wet',
    value: 120,
    unit: 'dimensionless',
    citation:
      'NFPA 13 Hazen-Williams C-factor table — unlined steel (wet) C=120. Friction-loss C-value table; edition-dependent. Verify adopted edition.',
  },
  cast_iron_cement_lined: {
    id: 'hw.cast_iron',
    description: 'Hazen-Williams C — cement-lined cast/ductile iron',
    value: 140,
    unit: 'dimensionless',
    citation:
      'NFPA 13 Hazen-Williams C-factor table — cement-lined cast/ductile iron C=140. Friction-loss C-value table; edition-dependent. Verify adopted edition.',
  },
  copper: {
    id: 'hw.copper',
    description: 'Hazen-Williams C — copper tube',
    value: 150,
    unit: 'dimensionless',
    citation:
      'NFPA 13 Hazen-Williams C-factor table — copper tube C=150. Friction-loss C-value table; edition-dependent. Verify adopted edition.',
  },
  cpvc: {
    id: 'hw.cpvc',
    description: 'Hazen-Williams C — listed CPVC (plastic) pipe',
    value: 150,
    unit: 'dimensionless',
    citation:
      'NFPA 13 Hazen-Williams C-factor table — listed plastic (CPVC) C=150. Friction-loss C-value table; edition-dependent. Verify adopted edition.',
  },
};

export type PipeMaterial = keyof typeof HAZEN_WILLIAMS_C;

/**
 * Hazen-Williams friction-loss coefficient 4.52 (US units: psi/ft from gpm and
 * inches of actual internal diameter). This is the exact constant NFPA 13 uses
 * for the friction-loss equation in US customary units.
 */
export const HAZEN_WILLIAMS_COEFFICIENT: CodeRule = {
  id: 'hw.coefficient',
  description:
    'Hazen-Williams friction-loss coefficient (US units, psi/ft) Pm = 4.52*Q^1.85 / (C^1.85 * d^4.87)',
  value: 4.52,
  unit: 'constant (US customary)',
  citation:
    'NFPA 13 friction-loss (Hazen-Williams) equation, US customary form: Pm = 4.52 Q^1.85 / (C^1.85 d^4.87), Q in gpm, d in inches (actual ID), Pm in psi/ft. Edition-dependent section. Verify adopted edition.',
};

/**
 * Values we are NOT certain enough to encode as a hard number. We leave them
 * null with a cite-TODO rather than fabricate a code value. (Honesty contract:
 * an uncited fabricated constant is a FAIL — so for these we ship no constant.)
 */
export const UNCERTAIN_VALUES: readonly CodeRule[] = [
  {
    id: 'todo.k_band_tolerance',
    description:
      'Nominal K-factor identification bands (e.g. K8.0 nominal range). Quoted ranges (e.g. 7.4-8.2) need per-edition NFPA-13 table verification.',
    value: null,
    unit: 'gpm/psi^0.5',
    citation:
      'TODO-cite: NFPA 13 sprinkler-identification / K-factor table (verify exact nominal-K bands against adopted edition before relying).',
  },
  {
    id: 'todo.density_area_curves',
    description:
      'Density/area design curves (gpm/ft^2 vs remote design area) per hazard. Not a single constant; requires the adopted-edition density/area figure.',
    value: null,
    unit: 'gpm/ft^2',
    citation:
      'TODO-cite: NFPA 13 density/area design curves figure — read from adopted edition; not fabricated here.',
  },
];

/**
 * Sprinkler discharge relation Q = K * sqrt(P).
 *   Q = flow (gpm), K = discharge coefficient (gpm/psi^0.5), P = pressure (psi).
 * This is the exact, published orifice-flow relation NFPA 13 uses for sprinkler
 * discharge. Throws on negative pressure (physically invalid). Pure.
 */
export function flowFromKP(kFactor: number, pressurePsi: number): number {
  if (!Number.isFinite(kFactor) || !Number.isFinite(pressurePsi)) {
    throw new Error('flowFromKP: kFactor and pressure must be finite numbers');
  }
  if (pressurePsi < 0) {
    throw new Error('flowFromKP: pressure must be >= 0 psi');
  }
  return kFactor * Math.sqrt(pressurePsi);
}

/** Inverse: required residual pressure (psi) to get a flow Q from a K-factor sprinkler. */
export function pressureFromKQ(kFactor: number, flowGpm: number): number {
  if (!Number.isFinite(kFactor) || !Number.isFinite(flowGpm)) {
    throw new Error('pressureFromKQ: kFactor and flow must be finite numbers');
  }
  if (kFactor <= 0) {
    throw new Error('pressureFromKQ: kFactor must be > 0');
  }
  const ratio = flowGpm / kFactor;
  return ratio * ratio;
}

/**
 * Hazen-Williams friction loss in psi per FOOT of pipe (US customary), NFPA-13 form:
 *
 *   Pm = 4.52 * Q^1.85 / ( C^1.85 * d^4.87 )
 *
 *   Q = flow (gpm), C = Hazen-Williams roughness coefficient (dimensionless),
 *   d = ACTUAL internal diameter (inches), Pm = friction loss (psi/ft).
 *
 * Multiply by pipe length (ft) for total loss along a run. Pure; throws on
 * invalid (non-positive C or d).
 */
export function hazenWilliamsLossPsiPerFt(
  flowGpm: number,
  cFactor: number,
  internalDiameterIn: number,
): number {
  if (
    !Number.isFinite(flowGpm) ||
    !Number.isFinite(cFactor) ||
    !Number.isFinite(internalDiameterIn)
  ) {
    throw new Error('hazenWilliamsLossPsiPerFt: all arguments must be finite');
  }
  if (cFactor <= 0 || internalDiameterIn <= 0) {
    throw new Error('hazenWilliamsLossPsiPerFt: C and diameter must be > 0');
  }
  const numerator = HAZEN_WILLIAMS_COEFFICIENT.value! * Math.pow(flowGpm, 1.85);
  const denominator =
    Math.pow(cFactor, 1.85) * Math.pow(internalDiameterIn, 4.87);
  return numerator / denominator;
}

/** Total Hazen-Williams friction loss (psi) over a pipe run of `lengthFt` feet. */
export function hazenWilliamsLossPsi(
  flowGpm: number,
  cFactor: number,
  internalDiameterIn: number,
  lengthFt: number,
): number {
  if (!Number.isFinite(lengthFt) || lengthFt < 0) {
    throw new Error('hazenWilliamsLossPsi: lengthFt must be a finite >= 0');
  }
  return hazenWilliamsLossPsiPerFt(flowGpm, cFactor, internalDiameterIn) * lengthFt;
}

/**
 * The full RULES table: every encoded code constant in one flat, iterable list,
 * each with its citation. Tests assert EVERY entry has a non-empty citation. The
 * UNCERTAIN_VALUES (null-valued cite-TODOs) are included so the honesty posture
 * is visible and counted, but they carry no fabricated number.
 */
export const RULES: readonly CodeRule[] = [
  ...Object.values(MAX_PROTECTION_AREA_SQFT),
  ...Object.values(MAX_SPACING_FT),
  ...Object.values(MAX_DISTANCE_TO_WALL_FT),
  MIN_HEAD_TO_HEAD_FT,
  ...Object.values(HAZEN_WILLIAMS_C),
  HAZEN_WILLIAMS_COEFFICIENT,
  ...UNCERTAIN_VALUES,
];

/**
 * Sections actually cited by this module — the truthful set of NFPA-13 (and
 * incorporated-standard) references surfaced to the UI. Kept short + honest:
 * these name the table/section families we lean on, all flagged edition-dependent.
 */
export const CITED_NFPA_SECTIONS: readonly string[] = [
  'NFPA 13 — protection-area & spacing table (max area/sprinkler, max spacing, distance to wall) [edition-dependent]',
  'NFPA 13 — minimum distance between sprinklers (6 ft, standard spray) [edition-dependent]',
  'NFPA 13 — Hazen-Williams friction-loss equation & C-factor table [edition-dependent]',
  'NFPA 13 — sprinkler discharge relation Q = K*sqrt(P)',
];

/**
 * HONESTY DISCLAIMER — shown verbatim in the System UI and exported as a
 * code-level constant. This is a design aid built from published values, not a
 * certified calculation.
 */
export const NFPA13_DESIGN_AID_DISCLAIMER =
  'Design aid based on published NFPA-13 values. NOT a certified hydraulic ' +
  'calculation, NOT AHJ-approved, NOT PE-sealed, NOT for construction. Numbers ' +
  'reflect commonly-cited standard-spray values and are edition-dependent — the ' +
  'AHJ-adopted NFPA-13 edition and a licensed fire-protection engineer are ' +
  'authoritative. Every encoded constant carries its citation; uncertain values ' +
  'are left null with a cite-TODO rather than guessed.';

/** Count of encoded (non-null) code constants — exposed for verification. */
export const RULE_CONSTANT_COUNT = RULES.filter((r) => r.value !== null).length;
