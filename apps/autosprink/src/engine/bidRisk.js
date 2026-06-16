/**
 * Best-effort bid risk factor for the internal-alpha autobid flow.
 *
 * This is deliberately simple and transparent: callers may pass an explicit
 * riskFactor, otherwise a few documented project-context flags add small
 * percentage increments. This is an estimate input, not a quote or acceptance
 * gate.
 */

function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * @param {object} [projectContext]
 * @returns {{riskFactor:number, drivers:Array<{key:string, increment:number}>}}
 */
export function bidRisk(projectContext = {}) {
  const explicit = Number(projectContext.riskFactor);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return {
      riskFactor: round4(explicit),
      drivers: [{ key: 'explicit_risk_factor', increment: round4(explicit) }],
    };
  }

  const rules = [
    ['renovation', 0.1],
    ['occupiedBuilding', 0.05],
    ['phasedWork', 0.05],
    ['nightWork', 0.05],
    ['tightAccess', 0.03],
    ['highCeiling', 0.02],
  ];

  const drivers = rules
    .filter(([key]) => Boolean(projectContext[key]))
    .map(([key, increment]) => ({ key, increment }));
  const riskFactor = round4(drivers.reduce((sum, driver) => sum + driver.increment, 0));
  return { riskFactor, drivers };
}

