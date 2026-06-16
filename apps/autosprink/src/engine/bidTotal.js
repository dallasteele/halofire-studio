/**
 * Bid total rollup for the internal-alpha autobid flow.
 */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function deriveTotalBid(bomResult = {}) {
  const candidates = [
    bomResult.totalBid,
    bomResult.normalizedTotal,
    bomResult.fullScopeTotal,
    bomResult.total,
    bomResult.subtotal,
    bomResult.materialCost,
  ];
  for (const candidate of candidates) {
    const amount = toAmount(candidate);
    if (amount != null) return round2(amount);
  }
  return 0;
}

/**
 * @param {object} bomResult
 * @param {number} riskFactor
 * @returns {{totalBid:number, riskFactor:number, finalBid:number}}
 */
export function bidTotal(bomResult = {}, riskFactor = 0) {
  const totalBid = deriveTotalBid(bomResult);
  const normalizedRisk = Math.max(0, Number(riskFactor) || 0);
  return {
    totalBid,
    riskFactor: normalizedRisk,
    finalBid: round2(totalBid * (1 + normalizedRisk)),
  };
}

