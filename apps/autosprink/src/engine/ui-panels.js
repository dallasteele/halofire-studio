import { buildSubmittal } from './submittal.js';

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function preferredHydraulics(data = {}) {
  const network = data.hydraulicNetwork;
  if (network && !network.error) return network;
  const singlePath = data.hydraulics;
  return singlePath && !singlePath.error ? singlePath : null;
}

function preferredCompliance(data = {}) {
  const compliance = data.compliance;
  return compliance && !compliance.error ? compliance : null;
}

export function getSubmittalData(data = {}) {
  if (!data.cadModel || !Array.isArray(data.cadModel.solids)) return null;
  const bid = data.bid
    ? {
      ...data.bid,
      total: data.bid.total ?? data.bid.pricing?.total ?? null,
      anyEstimated: data.bid.anyEstimated ?? data.bid.pricing?.anyEstimated ?? null,
    }
    : null;
  return buildSubmittal({
    project: {
      name: data.projectName ?? data.floorPlan?.name ?? data.bid?.floorPlanName ?? data.cadModel.name ?? 'Project',
      client: data.project?.client ?? null,
      address: data.project?.address ?? null,
    },
    bid,
    cadModel: data.cadModel,
    hydraulics: preferredHydraulics(data),
    compliance: preferredCompliance(data),
  });
}

export function getBidTotal(data = {}) {
  const fullScopeTotal = numberOrNull(data.fullScopeBid?.fullScopeTotal);
  if (fullScopeTotal != null) {
    return {
      amount: fullScopeTotal,
      label: 'Full-scope estimate',
      source: 'full_scope_bid',
      estimated: true,
    };
  }
  const pricedTotal = numberOrNull(data.bid?.pricing?.total);
  if (pricedTotal != null) {
    return {
      amount: pricedTotal,
      label: `Bare-materials total (+${data.bid?.pricing?.markupPct ?? 0}%)`,
      source: 'bid_pricing',
      estimated: data.bid?.pricing?.anyEstimated === true,
    };
  }
  const summaryTotal = numberOrNull(data.submittalData?.bidSummary?.total);
  if (summaryTotal != null) {
    return {
      amount: summaryTotal,
      label: 'Bid summary total',
      source: 'submittal_summary',
      estimated: data.submittalData?.bidSummary?.estimate === true,
    };
  }
  return null;
}

export function getBidRiskDisplay(result = {}) {
  const payload = result && typeof result === 'object' && 'value' in result ? result.value : result;
  if (!payload || typeof payload !== 'object') return null;

  return {
    score: numberOrNull(payload.score),
    level: typeof payload.level === 'string' && payload.level.trim() ? payload.level : 'unrated',
    drivers: Array.isArray(payload.drivers)
      ? payload.drivers.filter((driver) => typeof driver === 'string' && driver.trim())
      : [],
    error: typeof result?.error === 'string' ? result.error : null,
  };
}
