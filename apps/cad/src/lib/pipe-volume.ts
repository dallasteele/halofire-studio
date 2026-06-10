// H17 — pipe water volumes (PURE). Total water volume of a routed network from
// each segment's nominal size + material, using PUBLISHED nominal-to-internal-
// diameter tables (no fabricated IDs):
//
//   STEEL_SCH40 / STEEL_SCH10 — ASME B36.10M/B36.19M wrought-steel pipe dimensions.
//   CPVC                      — ASTM F442 SDR 13.5 CTS (listed fire-sprinkler CPVC).
//   COPPER                    — ASTM B88 Type M copper tube.
//
// Volume per foot = pi/4 * ID^2 (in^2) / 144 * 7.480519 gal/ft^3.
//
// HONESTY (fail-closed): a nominal size NOT in the published table (e.g. an odd
// kernel-imported diameter) THROWS rather than guessing an internal diameter.
// Callers that want fail-soft behavior catch (see report-from-result.ts). This is
// a design aid — verify the listed product's actual ID before regulated use.

import type { PipeMaterial } from './model';

export const GALLONS_PER_CUBIC_FOOT = 7.480519;

export const PIPE_VOLUME_CITATION =
  'Internal diameters from published dimension tables: ASME B36.10M/B36.19M ' +
  '(Schedule 40 / Schedule 10 steel), ASTM F442 SDR 13.5 CTS (listed CPVC), ' +
  'ASTM B88 Type M (copper tube). Water volume = pi/4 * ID^2 * length * ' +
  '7.480519 gal/ft^3. Design aid — verify the listed product\'s actual ID.';

/** Published internal diameters (inches) by nominal size, per material. */
const INTERNAL_DIAMETER_IN: Record<PipeMaterial, Record<string, number>> = {
  // ASME B36.10M Schedule 40 wrought steel.
  STEEL_SCH40: {
    '0.5': 0.622,
    '0.75': 0.824,
    '1': 1.049,
    '1.25': 1.38,
    '1.5': 1.61,
    '2': 2.067,
    '2.5': 2.469,
    '3': 3.068,
    '3.5': 3.548,
    '4': 4.026,
    '5': 5.047,
    '6': 6.065,
    '8': 7.981,
  },
  // ASME B36.19M Schedule 10 wrought steel.
  STEEL_SCH10: {
    '0.5': 0.674,
    '0.75': 0.884,
    '1': 1.097,
    '1.25': 1.442,
    '1.5': 1.682,
    '2': 2.157,
    '2.5': 2.635,
    '3': 3.26,
    '3.5': 3.76,
    '4': 4.26,
    '5': 5.295,
    '6': 6.357,
    '8': 8.249,
  },
  // ASTM F442 SDR 13.5 CTS (BlazeMaster-class listed CPVC), average IDs.
  CPVC: {
    '0.75': 0.874,
    '1': 1.101,
    '1.25': 1.394,
    '1.5': 1.598,
    '2': 2.003,
    '2.5': 2.423,
    '3': 2.95,
  },
  // ASTM B88 Type M copper tube (OD - 2*wall).
  COPPER: {
    '0.5': 0.569,
    '0.75': 0.811,
    '1': 1.055,
    '1.25': 1.291,
    '1.5': 1.527,
    '2': 2.009,
    '2.5': 2.495,
    '3': 2.981,
    '4': 3.935,
  },
};

/** The minimal segment shape pipeVolumes consumes (model.ts Segment satisfies it). */
export interface PipeVolumeSegmentInput {
  id: string;
  /** NOMINAL pipe size in inches (looked up against the published ID table). */
  diameterIn: number;
  lengthFt: number;
  material: PipeMaterial;
}

export interface SegmentVolume {
  id: string;
  internalDiameterIn: number;
  gallons: number;
}

export interface PipeVolumesResult {
  totalGallons: number;
  perSegment: SegmentVolume[];
  /** The published-table citation. NEVER empty. */
  citation: string;
}

/**
 * Published internal diameter (in) for a nominal size + material. Throws on a
 * nominal size with no published row (never guesses an ID).
 */
export function internalDiameterIn(material: PipeMaterial, nominalIn: number): number {
  const table = INTERNAL_DIAMETER_IN[material];
  for (const [key, id] of Object.entries(table)) {
    if (Math.abs(Number(key) - nominalIn) < 1e-9) return id;
  }
  throw new Error(
    `pipeVolumes: no published internal diameter for nominal ${nominalIn}" ${material} ` +
      '(non-schedule size — verify the imported geometry)',
  );
}

/**
 * PURE. Total water volume (gallons) of a segment list. Throws on an unknown
 * nominal size (fail-closed; see module header) or a non-finite/negative length.
 */
export function pipeVolumes(segments: readonly PipeVolumeSegmentInput[]): PipeVolumesResult {
  const perSegment: SegmentVolume[] = [];
  let totalGallons = 0;
  for (const seg of segments) {
    if (!Number.isFinite(seg.lengthFt) || seg.lengthFt < 0) {
      throw new Error(`pipeVolumes: segment ${seg.id} lengthFt must be finite >= 0; got ${seg.lengthFt}`);
    }
    const id = internalDiameterIn(seg.material, seg.diameterIn);
    const areaSqFt = (Math.PI / 4) * (id / 12) * (id / 12);
    const gallons = areaSqFt * seg.lengthFt * GALLONS_PER_CUBIC_FOOT;
    perSegment.push({ id: seg.id, internalDiameterIn: id, gallons });
    totalGallons += gallons;
  }
  return { totalGallons, perSegment, citation: PIPE_VOLUME_CITATION };
}
