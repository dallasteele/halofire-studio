/**
 * Full-scope bid extension for the HaloFire auto-bid engine.
 *
 * The bare auto-bid (sprinkler-layout.js -> priceBid) only prices the head/pipe
 * BOM. A real fire-sprinkler bid also needs system components (riser assembly,
 * FDC, backflow, etc.) and soft costs (permit/design/freight). This module adds
 * those line items as a CLEARLY-LABELLED best-effort estimate — it is NOT a
 * complete priced bid, NOT AHJ-approved, NOT PE-reviewed, and NOT AutoSprink
 * parity. All claim gates stay fail-closed.
 *
 * Pure, deterministic, browser-free. Component unit costs are resolved from the
 * real pricebook via the same priceResolver contract used by priceBid(); when a
 * lookup is unavailable we fall back to a labelled placeholder and flag the line.
 */

/** Round to 2 decimals, mirroring sprinkler-layout's money rounding. */
function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Soft-cost percentage assumptions (fraction of the priced subtotal).
 * These are labelled assumptions, not quoted figures.
 */
export const SOFT_COST_ASSUMPTIONS = Object.freeze({
  permit: 0.02, // 2% — AHJ permit/plan-review fees (assumption)
  engineering_design: 0.06, // 6% — engineering/design/hydraulic calcs (assumption)
  freight: 0.03, // 3% — freight/delivery (assumption)
});

/** Human-readable labels for each soft cost. */
const SOFT_COST_DESCRIPTIONS = Object.freeze({
  permit: 'Permit / plan-review fees (assumption)',
  engineering_design: 'Engineering / design / hydraulic calcs (assumption)',
  freight: 'Freight / delivery (assumption)',
});

/**
 * Fallback unit costs (USD) for system components, used only when a pricebook
 * lookup is unavailable. Clearly-labelled placeholders for internal-alpha math.
 */
export const SYSTEM_COMPONENT_FALLBACK_COSTS = Object.freeze({
  alarm_check_valve: 1850,
  fdc: 650,
  backflow_preventer: 2400,
  riser_trim: 900,
  inspectors_test_and_drain: 320,
  main_drain: 280,
  fire_pump: 45000,
});

/** Descriptions for system components. */
const SYSTEM_COMPONENT_DESCRIPTIONS = Object.freeze({
  alarm_check_valve: 'Alarm / check valve assembly',
  fdc: 'Fire department connection (FDC)',
  backflow_preventer: 'Backflow preventer assembly',
  riser_trim: 'Riser trim + gauges (set)',
  inspectors_test_and_drain: "Inspector's test & drain",
  main_drain: 'Main drain',
  fire_pump: 'Fire pump + controller (when required)',
});

/**
 * Decide whether a fire pump is warranted.
 * Honours an explicit boolean first; otherwise compares required vs. available
 * pressure (a pump is warranted only when the required pressure exceeds what the
 * supply provides). Returns false when there is no basis to decide.
 */
function firePumpWarranted({ firePumpRequired, requiredPressure, availablePressure }) {
  if (typeof firePumpRequired === 'boolean') return firePumpRequired;
  if (typeof requiredPressure === 'number' && typeof availablePressure === 'number') {
    return requiredPressure > availablePressure;
  }
  return false;
}

/**
 * Build the system-component scope line items.
 * Each item: {key, description, unit:'EA', quantity}. Quantities are 1 for the
 * single-riser core scope; a fire pump is appended only when warranted.
 *
 * @param {{totalHeadCount?:number, hazard?:string, firePumpRequired?:boolean,
 *          requiredPressure?:number, availablePressure?:number}} opts
 * @returns {Array<{key:string, description:string, unit:'EA', quantity:number}>}
 */
export function buildSystemComponents(opts = {}) {
  const core = [
    'alarm_check_valve',
    'fdc',
    'backflow_preventer',
    'riser_trim',
    'inspectors_test_and_drain',
    'main_drain',
  ];
  const items = core.map((key) => ({
    key,
    description: SYSTEM_COMPONENT_DESCRIPTIONS[key],
    unit: 'EA',
    quantity: 1,
  }));
  if (firePumpWarranted(opts)) {
    items.push({
      key: 'fire_pump',
      description: SYSTEM_COMPONENT_DESCRIPTIONS.fire_pump,
      unit: 'EA',
      quantity: 1,
    });
  }
  return items;
}

/**
 * Build soft-cost line items as labelled percentage assumptions of a subtotal.
 * Each item: {key, description, unit:'PCT', quantity:1, pct, lineTotal,
 * priceSource:'soft_cost_assumption'}.
 *
 * @param {number} subtotal  base amount the percentages apply to
 */
export function buildSoftCosts(subtotal) {
  const base = typeof subtotal === 'number' && subtotal > 0 ? subtotal : 0;
  return Object.keys(SOFT_COST_ASSUMPTIONS).map((key) => {
    const pct = SOFT_COST_ASSUMPTIONS[key];
    return {
      key,
      description: SOFT_COST_DESCRIPTIONS[key],
      unit: 'PCT',
      quantity: 1,
      pct,
      lineTotal: round(base * pct),
      priceSource: 'soft_cost_assumption',
    };
  });
}

/**
 * Price the system components, mirroring priceBid's resolver/fallback contract.
 * @returns {{lines:Array, componentCost:number, anyEstimated:boolean}}
 */
function priceSystemComponents(components, priceResolver) {
  const lines = components.map((item) => {
    const resolved = priceResolver(item.key);
    const usable = typeof resolved === 'number' && resolved >= 0;
    const unitCost = usable ? resolved : (SYSTEM_COMPONENT_FALLBACK_COSTS[item.key] ?? 0);
    return {
      ...item,
      unitCost: round(unitCost),
      lineTotal: round(unitCost * item.quantity),
      priceSource: usable ? 'pricebook' : 'fallback_estimate',
    };
  });
  return {
    lines,
    componentCost: round(lines.reduce((sum, l) => sum + l.lineTotal, 0)),
    anyEstimated: lines.some((l) => l.priceSource === 'fallback_estimate'),
  };
}

const FULL_SCOPE_DISCLAIMER =
  'best-effort internal-alpha FULL-SCOPE estimate — system components and soft '
  + 'costs are representative/assumed, NOT a complete priced bid, NOT '
  + 'manufacturer-quoted, and require licensed professional review.';

/**
 * Merge system components + soft costs into an existing priced bare-materials
 * bid (as produced by priceBid) to compute a full-scope total alongside the
 * bare materials total.
 *
 * Soft costs are applied to (bareMaterialsTotal + systemComponentCost) so they
 * scale with the priced hardware scope. Everything stays labelled estimate.
 *
 * @param {{total:number}} pricedBid  the bare-materials priced bid
 * @param {{totalHeadCount?:number, hazard?:string, priceResolver?:Function,
 *          firePumpRequired?:boolean, requiredPressure?:number,
 *          availablePressure?:number}} opts
 */
export function buildFullScopeBid(pricedBid, opts = {}) {
  const { priceResolver = () => null } = opts;
  const bareMaterialsTotal = round(pricedBid?.total ?? 0);

  const components = buildSystemComponents(opts);
  const priced = priceSystemComponents(components, priceResolver);

  const softBase = round(bareMaterialsTotal + priced.componentCost);
  const softCostLines = buildSoftCosts(softBase);
  const softCostTotal = round(softCostLines.reduce((sum, l) => sum + l.lineTotal, 0));

  const fullScopeTotal = round(bareMaterialsTotal + priced.componentCost + softCostTotal);

  return {
    estimate: true,
    bareMaterialsTotal,
    systemComponentLines: priced.lines,
    systemComponentCost: priced.componentCost,
    softCostLines,
    softCostTotal,
    fullScopeTotal,
    anyEstimated: priced.anyEstimated || (pricedBid?.anyEstimated ?? false),
    disclaimer: FULL_SCOPE_DISCLAIMER,
  };
}
