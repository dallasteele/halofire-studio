import { computeCoverage } from './coverage.js';
import { analyzeGraphLoops } from './hardy-cross.js';
import {
  hazenWilliamsLossPsiPerFt,
  remoteAreaDemand,
  requiredPressureAtRiser,
} from './hydraulics.js';
import { autoRemoteArea, computeRemoteArea } from './remote-area.js';
import { buildGraph } from './network-solve.js';

function resolveHazard(model) {
  return String(
    model?.hazard
      || model?.hazardClass
      || model?.sizing?.hazard
      || 'ordinary',
  ).toLowerCase();
}

function asPosition(head) {
  if (Array.isArray(head)) return head;
  if (Array.isArray(head?.position)) return head.position;
  if (typeof head?.x === 'number' && typeof head?.y === 'number') {
    return [head.x, head.y, typeof head?.z === 'number' ? head.z : 8];
  }
  return null;
}

function normalizeCadModel(model) {
  if (Array.isArray(model?.solids)) return model;

  const rawHeads = Array.isArray(model?.sprinklerLayout)
    ? model.sprinklerLayout
    : Array.isArray(model?.sprinklerLayout?.heads)
      ? model.sprinklerLayout.heads
      : Array.isArray(model?.layout?.heads)
        ? model.layout.heads
        : [];

  const solids = rawHeads
    .map((head, index) => {
      const position = asPosition(head);
      if (!Array.isArray(position)) return null;
      return {
        kind: 'head',
        name: head?.name || `head-${index}`,
        hazard: head?.hazard,
        position,
      };
    })
    .filter(Boolean);

  return {
    solids,
    sizing: {
      hazard: resolveHazard(model),
    },
    network: model?.network,
  };
}

export function checkCoverage(model) {
  const cadModel = normalizeCadModel(model);
  const hazard = resolveHazard(model);
  const coverage = computeCoverage(cadModel, hazard);

  return {
    isCompliant: coverage.counts.tooClose === 0
      && coverage.counts.tooFar === 0
      && coverage.counts.gaps === 0,
    coveragePercent: Number(coverage.coveredPct || 0),
    missingZones: coverage.gapCells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      nearestHeadFt: cell.nearestHeadFt,
    })),
    details: coverage,
  };
}

function computeRemoteAreaResult(cadModel, hazard, boundary) {
  if (boundary) return computeRemoteArea(cadModel, boundary, { hazard });

  const auto = autoRemoteArea(cadModel, { hazard });
  if (!auto?.boundary) return null;
  return {
    ...computeRemoteArea(cadModel, auto.boundary, { hazard }),
    autoSelectedBoundary: auto.boundary,
  };
}

export function computeHydraulics(model) {
  const cadModel = normalizeCadModel(model);
  const hazard = resolveHazard(model);
  const coverageResult = checkCoverage(model);

  let requiredPressure = null;
  if (cadModel?.network || Array.isArray(cadModel?.branchLines) || Array.isArray(cadModel?.solids)) {
    try {
      requiredPressure = requiredPressureAtRiser({
        cadModel,
        network: cadModel.network,
        hazard,
      });
    } catch {
      requiredPressure = null;
    }
  }

  let loopAnalysis = null;
  if (Array.isArray(cadModel?.solids) && cadModel.solids.some((solid) => solid?.kind === 'pipe')) {
    try {
      loopAnalysis = analyzeGraphLoops(buildGraph(cadModel));
    } catch {
      loopAnalysis = null;
    }
  }

  const remoteAreaResult = computeRemoteAreaResult(
    cadModel,
    hazard,
    model?.remoteAreaBoundary || model?.remoteArea?.boundary || null,
  );

  return {
    hazard,
    demand: remoteAreaDemand(hazard),
    requiredPressure,
    loopAnalysis,
    coverageResult,
    remoteAreaResult,
    hazenWilliamsReference: requiredPressure?.segments?.[0]
      ? {
          segment: requiredPressure.segments[0].name,
          psiPerFt: hazenWilliamsLossPsiPerFt(
            requiredPressure.segments[0].flowGpm,
            requiredPressure.segments[0].diameterIn,
          ),
        }
      : null,
  };
}

export default {
  checkCoverage,
  computeHydraulics,
};
