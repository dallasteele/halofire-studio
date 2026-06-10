// PURE helpers bridging the live HydraulicsResult to the calc-summary report and
// the pipe-volume readout — extracted from HydraulicsPanel so they are testable
// without a DOM.
//
// HONESTY: buildReportInput copies the solver's ACTUAL numbers (no re-derivation,
// no fabrication), carries every non-empty finding citation forward, and
// GUARANTEES the Hazen-Williams citation is present so formatHydraulicReport's
// fail-closed citations check can never be satisfied by an empty list.
// safePipeVolumes is the fail-soft wrapper: unknown nominal sizes (kernel-imported
// odd diameters) return null instead of crashing the panel.

import type { ReportInput } from './hydraulic-report';
import type { HydraulicsResult, WaterSupply } from './hydraulics';
import { HAZEN_WILLIAMS_C } from './nfpa13-rules';
import {
  pipeVolumes,
  type PipeVolumeSegmentInput,
  type PipeVolumesResult,
} from './pipe-volume';

export interface ReportFromResultArgs {
  projectName: string;
  /** Hazard class label (the project's hazardDefaults.defaultClass). */
  hazard: string;
  /** The LIVE solver result (selectHydraulics). */
  result: HydraulicsResult;
  /** The operator supply, when one is set (null/undefined for demand-only). */
  supply?: WaterSupply | null;
}

/**
 * PURE. Build the formatHydraulicReport input from a HydraulicsResult.
 * - demand maps from result.systemDemand { gpm, psiAtRiser }.
 * - supply is included only when BOTH the operator supply and the solver's
 *   supplyAtDemand.psi exist (availablePsiAtDemand + adequate come from the result).
 * - nodes/segments map 1:1 from perNode/perSegment (solver field names).
 * - citations = deduped non-empty finding citations, with the Hazen-Williams
 *   C-factor citation guaranteed present (never an empty list).
 * - disclaimer = the result's own design-aid disclaimer (never empty).
 */
export function buildReportInput(args: ReportFromResultArgs): ReportInput {
  const { result } = args;

  const citations: string[] = [];
  for (const f of result.findings) {
    if (f.citation !== '' && !citations.includes(f.citation)) citations.push(f.citation);
  }
  const hazenCitation = HAZEN_WILLIAMS_C.steel_wet.citation;
  if (!citations.some((c) => c.includes('Hazen-Williams'))) citations.push(hazenCitation);

  const supplyBlock =
    args.supply != null && result.supplyAtDemand.psi != null
      ? {
          staticPsi: args.supply.staticPsi,
          residualPsi: args.supply.residualPsi,
          flowGpm: args.supply.flowGpm,
          availablePsiAtDemand: result.supplyAtDemand.psi,
          adequate: result.adequate,
        }
      : undefined;

  return {
    projectName: args.projectName,
    hazard: args.hazard,
    demandGpm: result.systemDemand.gpm,
    demandPsiAtRiser: result.systemDemand.psiAtRiser,
    supply: supplyBlock,
    nodes: result.perNode.map((n) => ({
      id: n.id,
      pressurePsi: n.pressurePsi,
      flowGpm: n.flowGpm,
    })),
    segments: result.perSegment.map((s) => ({
      id: s.id,
      flowGpm: s.flowGpm,
      frictionPsi: s.frictionPsi,
      velocityFps: s.velocityFps,
    })),
    disclaimer: result.disclaimer,
    citations,
  };
}

/**
 * PURE, fail-soft. pipeVolumes, but an unknown nominal size (kernel-imported odd
 * diameter) returns null instead of throwing — the panel renders "n/a".
 */
export function safePipeVolumes(
  segments: readonly PipeVolumeSegmentInput[],
): PipeVolumesResult | null {
  try {
    return pipeVolumes(segments);
  } catch {
    return null;
  }
}
