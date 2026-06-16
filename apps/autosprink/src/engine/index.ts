import { requiredPressureAtRiser } from './hydraulics.js';
import { analyzeGraphLoops } from './hardy-cross.js';
import { autoRemoteArea, computeRemoteArea, getDensityCurve } from './remote-area.js';
import { buildGraph } from './network-solve.js';

function hasBranchNetwork(model: any) {
  return !!(model && model.network && Array.isArray(model.network.branchLines));
}

function hasCadSolids(model: any) {
  return !!(model && Array.isArray(model.solids));
}

function resolveHazard(model: any) {
  return String(model?.sizing?.hazard || model?.hazard || 'ordinary').toLowerCase();
}

function resolveRemoteArea(model: any, hazard: string) {
  if (!hasCadSolids(model)) {
    const curve = getDensityCurve(hazard);
    return {
      autoSelected: false,
      boundary: null,
      hazard,
      hazardLabel: curve.label,
      densityGpmFt2: curve.densityGpmFt2,
      designAreaSqFt: curve.designAreaSqFt,
      areaSqFt: curve.designAreaSqFt,
      demandGpm: curve.densityGpmFt2 * curve.designAreaSqFt,
      flowingHeadCount: 0,
      note: 'remote-area fallback used because model.solids is unavailable',
    };
  }

  const auto = autoRemoteArea(model, { hazard });
  if (!auto?.boundary) return auto;
  return {
    ...computeRemoteArea(model, auto.boundary, { hazard }),
    autoSelected: auto.autoSelected === true,
    boundary: auto.boundary,
    seed: auto.seed ?? null,
    basedOnPathResistance: auto.basedOnPathResistance === true,
  };
}

function resolveHardyCross(model: any, hazard: string) {
  if (!hasCadSolids(model)) {
    return {
      loopCount: 0,
      converged: false,
      hardyCrossBalanced: false,
      flows: [],
      note: 'Hardy-Cross analysis unavailable because model.solids is unavailable',
    };
  }

  return analyzeGraphLoops(buildGraph(model), { hazard });
}

export function computeHydraulics(model: any) {
  if (!model || (!hasBranchNetwork(model) && !hasCadSolids(model))) {
    throw new Error('computeHydraulics requires a model with cad solids or a branch-line network');
  }

  const hazard = resolveHazard(model);
  const hazenWilliams = requiredPressureAtRiser({
    cadModel: hasCadSolids(model) ? model : undefined,
    network: hasBranchNetwork(model) ? model.network : model,
    hazard,
  });
  const remoteArea = resolveRemoteArea(model, hazard);
  const hardyCross = resolveHardyCross(model, hazard);

  return {
    flow: remoteArea?.demandGpm ?? hazenWilliams.requiredFlowGpm ?? null,
    pressure: hazenWilliams.requiredPressurePsi ?? null,
    headLoss: hazenWilliams.frictionLossPsi ?? null,
    hazard,
    hazenWilliams,
    hardyCross,
    remoteArea,
  };
}
