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

/**
 * T23 — Bid-fidelity field-labor assumptions (hours-based).
 *
 * These are DEFENSIBLE public fire-sprinkler rules of thumb, NOT figures
 * reverse-engineered to hit any target total. They are deliberately
 * conservative/representative and are documented so a reviewer can sanity-check
 * them:
 *   - hoursPerHead 0.8 hr/head — a commercial spray-head install including the
 *     arm-over/drop and trim commonly runs ~0.5-1.0 hr/head; 0.8 is mid-range.
 *   - hoursPerPipeFt 0.05 hr/ft — handling + hanging mains/branch pipe at a
 *     practical ~20 linear ft per labor-hour.
 *   - hoursPerFitting 0.3 hr/fitting — cut/groove/thread + make-up of a fitting.
 *   - laborRatePerHour 90 $/hr — a loaded composite sprinkler-fitter rate
 *     (wage + burden), a public rule-of-thumb composite, NOT a quoted wage.
 * Callers may override any of these via opts so the model stays configurable.
 */
export const LABOR_ASSUMPTIONS = Object.freeze({
  hoursPerHead: 0.8,
  hoursPerPipeFt: 0.05,
  hoursPerFitting: 0.3,
  laborRatePerHour: 90,
});

/**
 * T23 — Overhead & profit assumptions. Standard small-/mid-job convention of
 * 10% overhead + 10% profit. These are documented public conventions, NOT tuned
 * to any reference total. Callers may override via opts.
 */
export const OHP_ASSUMPTIONS = Object.freeze({
  overhead: 0.1, // 10% — general/field overhead (assumption)
  profit: 0.1, // 10% — profit (assumption)
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
  service_manifold: 'Riser manifold assembly',
  dry_pipe_valve: 'Dry-pipe valve assembly',
  preaction_valve: 'Preaction valve assembly',
  deluge_valve: 'Deluge valve assembly',
  auxiliary_drain: 'Auxiliary drain assembly',
});

export function evaluateSystemDesignGate(opts = {}) {
  const backbone = opts.systemBackbone;
  if (!backbone) {
    return {
      status: 'blocked',
      blockers: [
        'SYSTEM_BACKBONE_DESIGN_REQUIRED',
        'RISER_AND_MANIFOLD_COUNT_REQUIRED',
        'PUMP_DECISION_REQUIRED',
        'MAIN_AND_AUXILIARY_DRAIN_DESIGN_REQUIRED',
      ],
    };
  }
  if (backbone.artifactType !== 'halofire.system-backbone-design.v1') {
    return { status: 'blocked', blockers: ['SYSTEM_BACKBONE_SCHEMA_INVALID'] };
  }
  const blockers = Array.isArray(backbone.issues) ? backbone.issues.map((entry) => entry.code) : [];
  if (backbone.quoteReady !== true || backbone.plan2dReady !== true || backbone.model3dReady !== true) {
    if (!blockers.length) blockers.push('SYSTEM_BACKBONE_NOT_RELEASE_READY');
    return { status: 'blocked', blockers: [...new Set(blockers)] };
  }
  return { status: 'passed', blockers: [] };
}

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
  const backboneRows = opts.systemBackbone?.takeoff?.systemComponents;
  if (Array.isArray(backboneRows) && backboneRows.length) {
    return backboneRows.map((row) => ({
      key: row.key,
      description: row.description || SYSTEM_COMPONENT_DESCRIPTIONS[row.key] || row.key,
      unit: row.unit || 'EA',
      quantity: row.quantity,
      systemIds: Array.isArray(row.systemIds) ? row.systemIds : [],
      source: 'system-backbone-design',
    }));
  }
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
    const hasFallback = Object.hasOwn(SYSTEM_COMPONENT_FALLBACK_COSTS, item.key);
    const unitCost = usable ? resolved : (hasFallback ? SYSTEM_COMPONENT_FALLBACK_COSTS[item.key] : 0);
    return {
      ...item,
      unitCost: round(unitCost),
      lineTotal: round(unitCost * item.quantity),
      priceSource: usable ? 'pricebook' : (hasFallback ? 'fallback_estimate' : 'unpriced'),
    };
  });
  return {
    lines,
    componentCost: round(lines.reduce((sum, l) => sum + l.lineTotal, 0)),
    anyEstimated: lines.some((l) => l.priceSource !== 'pricebook'),
  };
}

/**
 * T23 — Build the detailed field-labor scope from physical drivers (head count,
 * pipe footage, fitting count) using hours-based assumptions. This REPLACES the
 * crude flat $85/head allowance baked into priceBid for the full-scope figure;
 * the full-scope build below deliberately starts from un-marked-up MATERIAL cost
 * (pricedBid.materialCost) so this labor is NOT stacked on top of priceBid's
 * existing labor + markup (anti-double-count).
 *
 * One line each for head-install, pipe-handling, and fitting labor. Missing or
 * zero drivers yield 0 hours for that line (no throw). Constants default to
 * LABOR_ASSUMPTIONS but each is overridable via opts so the model is configurable.
 *
 * @param {{totalHeadCount?:number, pipeFootage?:number, fittingCount?:number}} drivers
 * @param {{hoursPerHead?:number, hoursPerPipeFt?:number, hoursPerFitting?:number,
 *          laborRatePerHour?:number}} opts
 * @returns {{lines:Array, laborHours:number, laborCost:number}}
 */
export function buildLaborScope(drivers = {}, opts = {}) {
  const hoursPerHead = numOr(opts.hoursPerHead, LABOR_ASSUMPTIONS.hoursPerHead);
  const hoursPerPipeFt = numOr(opts.hoursPerPipeFt, LABOR_ASSUMPTIONS.hoursPerPipeFt);
  const hoursPerFitting = numOr(opts.hoursPerFitting, LABOR_ASSUMPTIONS.hoursPerFitting);
  const ratePerHour = numOr(opts.laborRatePerHour, LABOR_ASSUMPTIONS.laborRatePerHour);

  const heads = positiveOrZero(drivers.totalHeadCount);
  const pipeFt = positiveOrZero(drivers.pipeFootage);
  const fittings = positiveOrZero(drivers.fittingCount);

  const specs = [
    { key: 'head_install', description: 'Field labor — sprinkler head install (assumption)', hours: heads * hoursPerHead },
    { key: 'pipe_handling', description: 'Field labor — pipe handling & hanging (assumption)', hours: pipeFt * hoursPerPipeFt },
    { key: 'fitting_install', description: 'Field labor — fitting make-up (assumption)', hours: fittings * hoursPerFitting },
  ];

  const lines = specs.map((s) => {
    const hours = round(s.hours);
    return {
      key: s.key,
      description: s.description,
      unit: 'HR',
      hours,
      ratePerHour,
      lineTotal: round(hours * ratePerHour),
      priceSource: 'labor_assumption',
    };
  });

  const laborHours = round(lines.reduce((sum, l) => sum + l.hours, 0));
  const laborCost = round(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  return { lines, laborHours, laborCost };
}

/**
 * T23 — Build overhead & profit lines from a cost subtotal. Documented order:
 * overhead is applied on the cost subtotal, then profit is applied on
 * (cost subtotal + overhead) — i.e. profit margins the overhead-loaded cost,
 * the common construction convention. Both percentages are documented public
 * conventions (OHP_ASSUMPTIONS), overridable via opts, NOT tuned to a target.
 *
 * @param {number} costSubtotal  base cost (materials + components + labor + soft)
 * @param {{overhead?:number, profit?:number}} opts
 * @returns {{lines:Array, overheadTotal:number, profitTotal:number, ohpTotal:number}}
 */
export function buildOverheadProfit(costSubtotal, opts = {}) {
  const base = typeof costSubtotal === 'number' && costSubtotal > 0 ? costSubtotal : 0;
  const overheadPct = numOr(opts.overhead, OHP_ASSUMPTIONS.overhead);
  const profitPct = numOr(opts.profit, OHP_ASSUMPTIONS.profit);

  const overheadTotal = round(base * overheadPct);
  const profitTotal = round((base + overheadTotal) * profitPct);
  const ohpTotal = round(overheadTotal + profitTotal);

  return {
    lines: [
      {
        key: 'overhead',
        description: 'Overhead (assumption)',
        unit: 'PCT',
        pct: overheadPct,
        lineTotal: overheadTotal,
        priceSource: 'ohp_assumption',
      },
      {
        key: 'profit',
        description: 'Profit, on cost + overhead (assumption)',
        unit: 'PCT',
        pct: profitPct,
        lineTotal: profitTotal,
        priceSource: 'ohp_assumption',
      },
    ],
    overheadTotal,
    profitTotal,
    ohpTotal,
  };
}

/** Coerce to a finite number, else fall back to the default. */
function numOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a non-negative finite number, else 0. */
function positiveOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

const FULL_SCOPE_DISCLAIMER =
  'best-effort internal-alpha FULL-SCOPE estimate — system components, field '
  + 'labor, soft costs, and overhead & profit (OH&P) are representative/assumed '
  + '(documented public conventions, NOT tuned), NOT a complete priced bid, NOT '
  + 'manufacturer-quoted, and require licensed professional review.';

/**
 * Build a best-effort FULL-SCOPE bid from an existing priced bare-materials bid
 * (as produced by priceBid) plus assumed system components, detailed field
 * labor, soft costs, and overhead & profit.
 *
 * T23 anti-double-count basis: the full-scope figure is built from the bid's
 * un-marked-up MATERIAL cost (pricedBid.materialCost) — NOT pricedBid.total,
 * which already embeds priceBid's crude flat $85/head labor allowance + 25%
 * markup. Stacking the new hours-based labor on top of pricedBid.total would
 * double-count labor and markup, so we deliberately start from materials only.
 *
 * Composition:
 *   costSubtotal = materialsOnly + systemComponentCost + laborCost + softCostTotal
 *   softCosts apply to (materialsOnly + systemComponentCost + laborCost)
 *   OH&P applies to costSubtotal (overhead on cost, profit on cost+overhead)
 *   fullScopeTotal = costSubtotal + ohpTotal
 *
 * bareMaterialsTotal (= pricedBid.total) is preserved UNCHANGED for
 * back-compat/reference. Everything new stays labelled estimate/assumption.
 *
 * @param {{total:number, materialCost?:number}} pricedBid  the bare-materials priced bid
 * @param {{totalHeadCount?:number, pipeFootage?:number, fittingCount?:number,
 *          hazard?:string, priceResolver?:Function, firePumpRequired?:boolean,
 *          requiredPressure?:number, availablePressure?:number,
 *          hoursPerHead?:number, hoursPerPipeFt?:number, hoursPerFitting?:number,
 *          laborRatePerHour?:number, overhead?:number, profit?:number}} opts
 */
export function buildFullScopeBid(pricedBid, opts = {}) {
  const { priceResolver = () => null } = opts;
  // Preserved untouched for back-compat/reference (the marked-up bare total).
  const bareMaterialsTotal = round(pricedBid?.total ?? 0);
  // T23 cost basis: un-marked-up materials only (avoids double-counting labor/markup).
  const materialsOnly = round(pricedBid?.materialCost ?? 0);

  const components = buildSystemComponents(opts);
  const priced = priceSystemComponents(components, priceResolver);
  const systemDesignGate = evaluateSystemDesignGate(opts);
  const unpricedSystemComponentKeys = priced.lines
    .filter((line) => line.priceSource === 'unpriced')
    .map((line) => line.key);

  // T23: detailed hours-based field labor from physical drivers.
  const labor = buildLaborScope(
    {
      totalHeadCount: opts.totalHeadCount,
      pipeFootage: opts.pipeFootage,
      fittingCount: opts.fittingCount,
    },
    opts,
  );

  // Soft costs scale with the priced hardware + labor scope.
  const softBase = round(materialsOnly + priced.componentCost + labor.laborCost);
  const softCostLines = buildSoftCosts(softBase);
  const softCostTotal = round(softCostLines.reduce((sum, l) => sum + l.lineTotal, 0));

  // Cost subtotal then OH&P markup on it.
  const costSubtotal = round(materialsOnly + priced.componentCost + labor.laborCost + softCostTotal);
  const ohp = buildOverheadProfit(costSubtotal, opts);

  const fullScopeTotal = round(costSubtotal + ohp.ohpTotal);

  return {
    estimate: true,
    bareMaterialsTotal,
    materialsOnly,
    systemComponentLines: priced.lines,
    systemComponentCost: priced.componentCost,
    laborScope: labor,
    laborCost: labor.laborCost,
    softCostLines,
    softCostTotal,
    ohp,
    fullScopeTotal,
    // The full scope ALWAYS contains assumption-priced lines (field labor +
    // OH&P are documented assumptions), so estimated pricing is always flagged.
    anyEstimated: true,
    systemDesignGate,
    systemDesignReady: systemDesignGate.status === 'passed',
    unpricedSystemComponentKeys,
    quoteReady: systemDesignGate.status === 'passed'
      && unpricedSystemComponentKeys.length === 0
      && priced.lines.every((line) => line.priceSource === 'pricebook')
      && opts.pricingVerified === true,
    disclaimer: FULL_SCOPE_DISCLAIMER,
  };
}
