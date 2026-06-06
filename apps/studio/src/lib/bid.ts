// HaloFire Studio — DETERMINISTIC auto-bid ESTIMATE (PURE: no React / three / DOM).
//
// Capstone of the studio pipeline: turn a sprinkler Layout (heads + grid) into a
// best-effort priced ESTIMATE. The bid MATH is a TypeScript port of the PROVEN
// deterministic algorithm in apps/autosprink/src/engine/bid-scope.js +
// pricebook-pricing.js:
//   - LABOR_ASSUMPTIONS: 0.8 hr/head, 0.05 hr/pipe-ft, 0.3 hr/fitting, $90/hr
//   - OHP_ASSUMPTIONS:   10% overhead, then 10% profit on (cost + overhead)
// (documented public construction conventions, NOT tuned to any target).
//
// HONESTY (hard, fail-closed): this is a BEST-EFFORT ESTIMATE built from
// REPRESENTATIVE per-unit prices (in the spirit of the autosprink PRICE_BANDS
// in-band medians) + standard labor assumptions. It is NOT a real pricebook
// quote, NOT a committed bid, NOT AHJ / PE / permit / code-compliant. The
// autosprink app retains the REAL pricebook-backed bid + claim gates; THIS panel
// is a quick estimate only. See BID_DISCLAIMER. We NEVER fabricate a live
// pricebook lookup here.

import { layoutHeads, type LayoutResult, type LayoutInput } from './layout';

/* ------------------------------------------------------------------ consts */

/**
 * REPRESENTATIVE per-unit prices (USD). These are documented, defensible
 * REPRESENTATIVE figures chosen in the spirit of the autosprink PRICE_BANDS
 * in-band medians for a small-diameter commercial wet system — they are NOT a
 * live pricebook lookup and NOT a manufacturer quote. Each is a single
 * representative point inside the same sane bands the autosprink resolver uses:
 *   sprinkler_head  $18/EA   (PRICE_BANDS.sprinkler_head band 5..80)
 *   branch_pipe     $4.50/ft (PRICE_BANDS.branch_pipe band 0.5..20, per linear ft)
 *   fitting         $6/EA    (PRICE_BANDS.fitting band 0.5..30)
 *   hanger          $3.50/EA (PRICE_BANDS.hanger band 0.3..15)
 *   escutcheon      $1.25/EA (PRICE_BANDS.escutcheon band 0.2..12)
 *   riser_valve_assy $1850/EA (representative alarm/check valve + riser trim set,
 *                    in the spirit of autosprink SYSTEM_COMPONENT fallbacks)
 * Callers may override any of these via opts so the model stays configurable.
 */
export const REPRESENTATIVE_UNIT_PRICES = Object.freeze({
  sprinkler_head: 18,
  branch_pipe: 4.5, // per linear foot
  fitting: 6,
  hanger: 3.5,
  escutcheon: 1.25,
  riser_valve_assy: 1850,
});

export type BidMaterialKey = keyof typeof REPRESENTATIVE_UNIT_PRICES;

/** Human-readable labels for each line item. */
export const MATERIAL_DESCRIPTIONS: Record<BidMaterialKey, string> = {
  sprinkler_head: 'Sprinkler head (representative)',
  branch_pipe: 'Branch / main pipe (representative, per ft)',
  fitting: 'Fitting — tee / elbow / coupling (representative)',
  hanger: 'Pipe hanger (representative)',
  escutcheon: 'Escutcheon (representative)',
  riser_valve_assy: 'Riser / alarm-valve assembly (representative)',
};

/** The unit of measure for each material line. */
export const MATERIAL_UNITS: Record<BidMaterialKey, string> = {
  sprinkler_head: 'EA',
  branch_pipe: 'FT',
  fitting: 'EA',
  hanger: 'EA',
  escutcheon: 'EA',
  riser_valve_assy: 'EA',
};

/**
 * Field-labor assumptions (hours-based), ported verbatim from autosprink
 * bid-scope.js LABOR_ASSUMPTIONS. Documented public fire-sprinkler rules of
 * thumb, NOT tuned to any target.
 */
export const LABOR_ASSUMPTIONS = Object.freeze({
  hoursPerHead: 0.8,
  hoursPerPipeFt: 0.05,
  hoursPerFitting: 0.3,
  laborRatePerHour: 90,
});

/**
 * Overhead & profit assumptions, ported from autosprink bid-scope.js
 * OHP_ASSUMPTIONS: 10% overhead + 10% profit. Overhead applies to the
 * (material + labor) cost subtotal; profit then applies to (subtotal + overhead)
 * — the common construction convention, mirroring buildOverheadProfit.
 */
export const OHP_ASSUMPTIONS = Object.freeze({
  overhead: 0.1,
  profit: 0.1,
});

export const BID_DISCLAIMER =
  'BEST-EFFORT ESTIMATE from REPRESENTATIVE prices + standard labor assumptions. ' +
  'NOT a quote, NOT a committed bid, NOT AHJ / PE / permit / code-compliant. Real ' +
  'pricing requires the live pricebook + a licensed estimator. Materials use ' +
  'representative per-unit prices (not a manufacturer quote); labor + OH&P use ' +
  'documented public construction conventions. Deterministic.';

/* ------------------------------------------------------------------- types */

/** A single priced line item. */
export interface BidLineItem {
  /** Material key (e.g. "sprinkler_head"). */
  key: BidMaterialKey;
  /** Human-readable description. */
  description: string;
  /** Quantity (count or linear feet). */
  qty: number;
  /** Unit of measure ("EA" / "FT"). */
  unit: string;
  /** Representative price per unit (USD). */
  unitPrice: number;
  /** qty * unitPrice (USD, rounded to cents). */
  extended: number;
}

/** Physical drivers for a bid estimate (counts + footage). */
export interface BidDrivers {
  headCount: number;
  branchPipeFt: number;
  fittingCount: number;
  hangerCount: number;
  /** Number of escutcheons (typically one per head). Optional. */
  escutcheonCount?: number;
  /** Number of riser / alarm-valve assemblies. Optional, default 1. */
  riserValveCount?: number;
}

/** Overridable price + assumption knobs (all optional). */
export interface BidOptions {
  unitPrices?: Partial<Record<BidMaterialKey, number>>;
  hoursPerHead?: number;
  hoursPerPipeFt?: number;
  hoursPerFitting?: number;
  laborRatePerHour?: number;
  overhead?: number;
  profit?: number;
}

/** A fully priced best-effort bid estimate. */
export interface BidEstimate {
  /** Always true — this is an ESTIMATE, never a real quote. */
  estimate: true;
  lineItems: BidLineItem[];
  /** Sum of all line-item extended costs (USD). */
  materialTotal: number;
  /** Total field-labor hours. */
  laborHours: number;
  /** Total field-labor cost (USD). */
  laborCost: number;
  /** materialTotal + laborCost (the cost subtotal OH&P applies to). */
  subtotal: number;
  /** Overhead amount (subtotal * overhead pct). */
  overhead: number;
  /** Profit amount ((subtotal + overhead) * profit pct). */
  profit: number;
  /** subtotal + overhead + profit (the bottom-line estimate). */
  total: number;
  /** Honesty disclaimer, shown verbatim in the UI. */
  disclaimer: string;
}

/* ------------------------------------------------------------------- utils */

/** Round to 2 decimals (cents), mirroring the autosprink money rounding. */
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce to a finite number, else fall back to the default. */
function numOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a non-negative finite number, else 0. */
function positiveOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/* --------------------------------------------------------- buildBidEstimate */

/**
 * Build a DETERMINISTIC best-effort priced bid estimate from physical drivers.
 *
 * Math (matches autosprink bid-scope.js):
 *   materialTotal = sum(qty * representative unitPrice) over all line items
 *   laborHours    = headCount*0.8 + branchPipeFt*0.05 + fittingCount*0.3
 *   laborCost     = laborHours * $90/hr
 *   subtotal      = materialTotal + laborCost
 *   overhead      = subtotal * 0.10
 *   profit        = (subtotal + overhead) * 0.10   (profit margins the OH-loaded cost)
 *   total         = subtotal + overhead + profit
 *
 * Hangers + escutcheons are MATERIAL lines (priced) but carry NO separate labor
 * line (their handling is folded into the pipe/head labor) — mirroring the
 * autosprink labor scope, which is driven by heads, pipe-ft, and fittings only.
 */
export function buildBidEstimate(drivers: BidDrivers, opts: BidOptions = {}): BidEstimate {
  const prices = { ...REPRESENTATIVE_UNIT_PRICES, ...(opts.unitPrices ?? {}) };

  const headCount = positiveOrZero(drivers.headCount);
  const branchPipeFt = positiveOrZero(drivers.branchPipeFt);
  const fittingCount = positiveOrZero(drivers.fittingCount);
  const hangerCount = positiveOrZero(drivers.hangerCount);
  const escutcheonCount =
    drivers.escutcheonCount === undefined ? headCount : positiveOrZero(drivers.escutcheonCount);
  const riserValveCount =
    drivers.riserValveCount === undefined ? 1 : positiveOrZero(drivers.riserValveCount);

  const specs: { key: BidMaterialKey; qty: number }[] = [
    { key: 'sprinkler_head', qty: headCount },
    { key: 'branch_pipe', qty: branchPipeFt },
    { key: 'fitting', qty: fittingCount },
    { key: 'hanger', qty: hangerCount },
    { key: 'escutcheon', qty: escutcheonCount },
    { key: 'riser_valve_assy', qty: riserValveCount },
  ];

  const lineItems: BidLineItem[] = specs.map(({ key, qty }) => {
    const unitPrice = prices[key];
    return {
      key,
      description: MATERIAL_DESCRIPTIONS[key],
      qty: round(qty),
      unit: MATERIAL_UNITS[key],
      unitPrice: round(unitPrice),
      extended: round(qty * unitPrice),
    };
  });

  const materialTotal = round(lineItems.reduce((sum, l) => sum + l.extended, 0));

  // Field labor from physical drivers (hours-based assumptions).
  const hoursPerHead = numOr(opts.hoursPerHead, LABOR_ASSUMPTIONS.hoursPerHead);
  const hoursPerPipeFt = numOr(opts.hoursPerPipeFt, LABOR_ASSUMPTIONS.hoursPerPipeFt);
  const hoursPerFitting = numOr(opts.hoursPerFitting, LABOR_ASSUMPTIONS.hoursPerFitting);
  const ratePerHour = numOr(opts.laborRatePerHour, LABOR_ASSUMPTIONS.laborRatePerHour);

  const laborHours = round(
    headCount * hoursPerHead + branchPipeFt * hoursPerPipeFt + fittingCount * hoursPerFitting,
  );
  const laborCost = round(laborHours * ratePerHour);

  const subtotal = round(materialTotal + laborCost);

  // OH&P: overhead on subtotal, profit on (subtotal + overhead).
  const overheadPct = numOr(opts.overhead, OHP_ASSUMPTIONS.overhead);
  const profitPct = numOr(opts.profit, OHP_ASSUMPTIONS.profit);
  const overhead = round(subtotal * overheadPct);
  const profit = round((subtotal + overhead) * profitPct);

  const total = round(subtotal + overhead + profit);

  return {
    estimate: true,
    lineItems,
    materialTotal,
    laborHours,
    laborCost,
    subtotal,
    overhead,
    profit,
    total,
    disclaimer: BID_DISCLAIMER,
  };
}

/* ------------------------------------------------------- estimateFromLayout */

/**
 * Derive best-effort physical drivers from a laid-out grid, DETERMINISTICALLY.
 *
 * Heuristics (documented, geometry-derived — NOT tuned to any dollar target):
 *   - headCount    = layout.count (rows * cols)
 *   - branchPipeFt = total branch-line run + cross-main run, from grid geometry:
 *       branch run per row  = (cols - 1) * spacing   [head-to-head along a row]
 *       branch total        = rows * branchRunPerRow
 *       cross-main run      = (rows - 1) * spacing    [trunk spanning the rows]
 *       branchPipeFt        = branchTotal + crossMain
 *     (mirrors layout.ts branchLines: one branch per row + one cross-main.)
 *   - fittingCount = heads (1 tee/drop per head) + branch taps (1 per branch line,
 *       i.e. rows) + a small fixed allowance for the riser/turn fittings (4).
 *   - hangerCount  = ceil(branchPipeFt / 10)   [a hanger every ~10 ft of pipe]
 *   - escutcheon   = headCount (one per head)
 *   - riserValve   = 1
 */
export function deriveDriversFromLayout(layout: LayoutResult): BidDrivers {
  const { rows, cols, spacingFt, count } = layout;

  const branchRunPerRow = cols > 1 ? (cols - 1) * spacingFt : 0;
  const branchTotal = rows * branchRunPerRow;
  const crossMainRun = rows > 1 ? (rows - 1) * spacingFt : 0;
  const branchPipeFt = round(branchTotal + crossMainRun);

  // One drop/tee fitting per head, one tap per branch line (rows), + a small
  // fixed riser/turn allowance.
  const RISER_FITTING_ALLOWANCE = 4;
  const fittingCount = count + rows + RISER_FITTING_ALLOWANCE;

  // A hanger roughly every 10 ft of pipe (a coarse, documented rule of thumb).
  const hangerCount = branchPipeFt > 0 ? Math.ceil(branchPipeFt / 10) : 0;

  return {
    headCount: count,
    branchPipeFt,
    fittingCount,
    hangerCount,
    escutcheonCount: count,
    riserValveCount: 1,
  };
}

/**
 * Compute a best-effort priced bid ESTIMATE directly from a layout input
 * (width / length / hazard). DETERMINISTIC: lays out the grid, derives drivers,
 * then prices them. Convenience wrapper over layoutHeads + deriveDriversFromLayout
 * + buildBidEstimate.
 */
export function estimateFromLayout(input: LayoutInput, opts: BidOptions = {}): BidEstimate {
  const layout = layoutHeads(input);
  const drivers = deriveDriversFromLayout(layout);
  return buildBidEstimate(drivers, opts);
}
