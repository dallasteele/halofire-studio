// W2A — NFPA-13 density/area per-head demand floor (PURE).
//
// The audit flagged that hydraulics omitted the density/area flow floor, so the
// supply-adequacy verdict could be optimistic in the UNSAFE direction. This
// module supplies the floor: a head's effective demand is the GREATER of its
// minimum-operating-pressure flow and the density-driven flow.
//
// HONESTY: every cited number carries an edition caveat. These are the low-point
// design densities of the NFPA-13 density/area curves — a design AID input, not
// an AHJ/PE-approved calc. Verify the adopted edition before regulated use.

export type HazardClass = 'LIGHT' | 'ORDINARY_1' | 'ORDINARY_2' | 'EXTRA_1' | 'EXTRA_2';

export interface CitedNumber {
  value: number;
  citation: string;
}

const EDITION = 'NFPA 13 density/area curves (low-point). Verify adopted edition.';
const AREA_CITE = 'NFPA 13 max protection area per sprinkler. Verify adopted edition.';
const REMOTE_CITE = 'NFPA 13 minimum remote design area. Verify adopted edition.';
const MIN_PRESSURE_CITE =
  'NFPA 13 minimum sprinkler operating pressure governs (flow = K*sqrt(P)). Verify adopted edition.';

/** Design density (gpm/ft^2) per hazard — the low-point of the density/area curves. */
export const DESIGN_DENSITY_GPM_SQFT: Record<HazardClass, CitedNumber> = {
  LIGHT: { value: 0.1, citation: EDITION },
  ORDINARY_1: { value: 0.15, citation: EDITION },
  ORDINARY_2: { value: 0.2, citation: EDITION },
  EXTRA_1: { value: 0.3, citation: EDITION },
  EXTRA_2: { value: 0.4, citation: EDITION },
};

/** Max protection area per sprinkler (ft^2) per hazard. */
export const PER_HEAD_AREA_SQFT: Record<HazardClass, CitedNumber> = {
  LIGHT: { value: 225, citation: AREA_CITE },
  ORDINARY_1: { value: 130, citation: AREA_CITE },
  ORDINARY_2: { value: 130, citation: AREA_CITE },
  EXTRA_1: { value: 100, citation: AREA_CITE },
  EXTRA_2: { value: 100, citation: AREA_CITE },
};

/** Minimum remote design area (ft^2) per hazard. */
export const MIN_REMOTE_AREA_SQFT: Record<HazardClass, CitedNumber> = {
  LIGHT: { value: 1500, citation: REMOTE_CITE },
  ORDINARY_1: { value: 1500, citation: REMOTE_CITE },
  ORDINARY_2: { value: 1500, citation: REMOTE_CITE },
  EXTRA_1: { value: 2500, citation: REMOTE_CITE },
  EXTRA_2: { value: 2500, citation: REMOTE_CITE },
};

/** Density-driven flow (gpm) over a head's protection area. */
export function densityFloorGpm(hazard: HazardClass, perHeadAreaSqFt?: number): number {
  const area = perHeadAreaSqFt ?? PER_HEAD_AREA_SQFT[hazard].value;
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error(`densityFloorGpm: perHeadAreaSqFt must be finite > 0; got ${perHeadAreaSqFt}`);
  }
  return DESIGN_DENSITY_GPM_SQFT[hazard].value * area;
}

/** Pressure (psi) needed to discharge `flowGpm` through a K-factor head: (Q/K)^2. */
export function pressureForFlow(flowGpm: number, kFactor: number): number {
  if (!Number.isFinite(kFactor) || kFactor <= 0) {
    throw new Error(`pressureForFlow: kFactor must be finite > 0; got ${kFactor}`);
  }
  if (!Number.isFinite(flowGpm) || flowGpm < 0) {
    throw new Error(`pressureForFlow: flowGpm must be finite >= 0; got ${flowGpm}`);
  }
  return (flowGpm / kFactor) ** 2;
}

export interface HeadDemand {
  flowGpm: number;
  pressurePsi: number;
  governedBy: 'min-pressure' | 'density-floor';
  citation: string;
}

/**
 * The effective per-head demand: the GREATER of the minimum-operating-pressure
 * flow (kFactor*sqrt(minOperatingPsi)) and the density floor. Throws on
 * non-positive kFactor or minOperatingPsi.
 */
export function effectiveHeadDemand(
  kFactor: number,
  minOperatingPsi: number,
  hazard: HazardClass,
  perHeadAreaSqFt?: number,
): HeadDemand {
  if (!Number.isFinite(kFactor) || kFactor <= 0) {
    throw new Error(`effectiveHeadDemand: kFactor must be finite > 0; got ${kFactor}`);
  }
  if (!Number.isFinite(minOperatingPsi) || minOperatingPsi <= 0) {
    throw new Error(`effectiveHeadDemand: minOperatingPsi must be finite > 0; got ${minOperatingPsi}`);
  }
  const qMin = kFactor * Math.sqrt(minOperatingPsi);
  const qFloor = densityFloorGpm(hazard, perHeadAreaSqFt);
  if (qFloor > qMin) {
    return {
      flowGpm: qFloor,
      pressurePsi: pressureForFlow(qFloor, kFactor),
      governedBy: 'density-floor',
      citation: DESIGN_DENSITY_GPM_SQFT[hazard].citation,
    };
  }
  return {
    flowGpm: qMin,
    pressurePsi: minOperatingPsi,
    governedBy: 'min-pressure',
    citation: MIN_PRESSURE_CITE,
  };
}
