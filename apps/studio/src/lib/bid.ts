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
// PRICING (REAL pricebook medians, fail-soft):
//   - public/parts/pricebook-medians.json holds REAL in-band MEDIANS computed by
//     scripts/build-pricebook-medians.mjs over the imported Victaulic/ARGCO/FFF
//     pricebook (~7,208 rows) — the SAME PRICE_BANDS keyword+band-median logic as
//     apps/autosprink/src/engine/pricebook-pricing.js. loadPricebook(fetchImpl)
//     loads it at runtime. When the file is absent (or no fetch is supplied),
//     buildBidEstimate fails soft to the documented REPRESENTATIVE_UNIT_PRICES and
//     marks every affected line `representative-fallback` instead of
//     `pricebook-median`, so the UI is honest about which source is active.
//
// HONESTY (hard, fail-closed): this is a BEST-EFFORT ESTIMATE. When the real
// pricebook medians are present, materials use a REAL pricebook-derived in-band
// MEDIAN (a representative pricebook price, NOT a fabricated constant, NOT a live
// per-line manufacturer quote). When they are absent, materials use documented
// REPRESENTATIVE per-unit figures (clearly labelled fallback). Labor + OH&P use
// documented public construction conventions. The total is still an ESTIMATE —
// NOT a quote, NOT a committed bid, NOT AHJ / PE / permit / code-compliant. The
// autosprink app retains the REAL pricebook-backed bid + claim gates; THIS panel
// is a quick estimate only. We NEVER fabricate a live pricebook lookup here.

import { layoutHeads, type LayoutResult, type LayoutInput } from './layout';

/* ------------------------------------------------------------------ consts */

/**
 * REPRESENTATIVE per-unit prices (USD) — the FALLBACK used only when the real
 * pricebook-medians.json is unavailable. These are documented, defensible
 * REPRESENTATIVE figures chosen in the spirit of the autosprink PRICE_BANDS
 * in-band medians for a small-diameter commercial wet system — they are NOT a
 * live pricebook lookup and NOT a manufacturer quote. Each is a single
 * representative point inside the same sane bands the autosprink resolver uses:
 *   sprinkler_head  $18/EA   (PRICE_BANDS.sprinkler_head band 5..80)
 *   branch_pipe     $4.50/ft (PRICE_BANDS.branch_pipe band 0.5..20, per linear ft)
 *   cross_main_pipe $12/ft   (PRICE_BANDS.cross_main_pipe band 3..45)
 *   fitting         $6/EA    (PRICE_BANDS.fitting band 0.5..30)
 *   drop_armover    $8/EA    (PRICE_BANDS.drop_armover band 1..40)
 *   hanger          $3.50/EA (PRICE_BANDS.hanger band 0.3..15)
 *   escutcheon      $1.25/EA (PRICE_BANDS.escutcheon band 0.2..12)
 *   riser_valve_assy $1850/EA (representative alarm/check valve + riser trim set,
 *                    in the spirit of autosprink SYSTEM_COMPONENT fallbacks — has
 *                    NO pricebook band, so it is ALWAYS a representative line)
 * Callers may override any of these via opts so the model stays configurable.
 */
export const REPRESENTATIVE_UNIT_PRICES = Object.freeze({
  sprinkler_head: 18,
  branch_pipe: 4.5, // per linear foot
  cross_main_pipe: 12, // per linear foot
  fitting: 6,
  drop_armover: 8,
  hanger: 3.5,
  escutcheon: 1.25,
  riser_valve_assy: 1850,
});

export type BidMaterialKey = keyof typeof REPRESENTATIVE_UNIT_PRICES;

/** Where a line item's unit price came from. */
export type PriceSource = 'pricebook-median' | 'representative-fallback' | 'representative-only';

/** Human-readable labels for each line item. */
export const MATERIAL_DESCRIPTIONS: Record<BidMaterialKey, string> = {
  sprinkler_head: 'Sprinkler head',
  branch_pipe: 'Branch-line pipe (per ft)',
  cross_main_pipe: 'Cross-main pipe (per ft)',
  fitting: 'Fitting — tee / elbow / coupling',
  drop_armover: 'Drop / armover assembly',
  hanger: 'Pipe hanger',
  escutcheon: 'Escutcheon',
  riser_valve_assy: 'Riser / alarm-valve assembly (representative)',
};

/** The unit of measure for each material line. */
export const MATERIAL_UNITS: Record<BidMaterialKey, string> = {
  sprinkler_head: 'EA',
  branch_pipe: 'FT',
  cross_main_pipe: 'FT',
  fitting: 'EA',
  drop_armover: 'EA',
  hanger: 'EA',
  escutcheon: 'EA',
  riser_valve_assy: 'EA',
};

/**
 * Keys that have a real PRICE_BANDS band in pricebook-pricing.js and therefore
 * a real in-band median in pricebook-medians.json. `riser_valve_assy` is NOT in
 * this set — there is no defensible single pricebook band for a full riser/valve
 * trim set, so that line is ALWAYS a representative figure.
 */
export const PRICEBOOK_BACKED_KEYS: ReadonlySet<BidMaterialKey> = new Set<BidMaterialKey>([
  'sprinkler_head',
  'branch_pipe',
  'cross_main_pipe',
  'fitting',
  'drop_armover',
  'hanger',
  'escutcheon',
]);

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
  'BEST-EFFORT ESTIMATE. Materials use REAL pricebook-derived in-band MEDIANS ' +
  'over the imported Victaulic/ARGCO/FFF rows when available (a representative ' +
  'pricebook price, NOT a live per-line manufacturer quote), else documented ' +
  'REPRESENTATIVE per-unit figures (clearly labelled fallback). Labor + OH&P use ' +
  'documented public construction conventions. This is NOT a quote, NOT a ' +
  'committed bid, NOT AHJ / PE / permit / code-compliant. Real pricing requires ' +
  'the live pricebook + a licensed estimator. Deterministic.';

/* ------------------------------------------------------- pricebook medians */

/** One median entry from pricebook-medians.json. */
export interface PricebookMedianEntry {
  unitPrice: number;
  unit: string;
  matchedRows: number;
  band: [number, number];
}

/** The parsed pricebook-medians.json document. */
export interface PricebookMedians {
  generatedAt: string;
  sourceRowCount: number;
  currency: string;
  medians: Partial<Record<string, PricebookMedianEntry>>;
}

/**
 * A resolved price table handed to buildBidEstimate. `kind` records whether the
 * real pricebook medians are in play or we fell back to representative figures.
 */
export interface PriceTable {
  /** 'pricebook' = real medians loaded; 'representative' = fallback figures. */
  kind: 'pricebook' | 'representative';
  /** Per-key unit price (USD). */
  prices: Record<BidMaterialKey, number>;
  /** How many real pricebook rows backed each pricebook-derived key. */
  matchedRows: Partial<Record<BidMaterialKey, number>>;
  /** Total real pricebook rows the medians were computed over (0 in fallback). */
  sourceRowCount: number;
}

/** Validate one raw median entry from JSON. */
function isMedianEntry(v: unknown): v is PricebookMedianEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.unitPrice === 'number' && Number.isFinite(e.unitPrice) && e.unitPrice > 0;
}

/**
 * Fail-soft loader for the REAL pricebook medians. With NO fetch implementation
 * supplied, or a fetch that fails / returns non-2xx / yields invalid JSON / has
 * no usable medians, this returns null — and buildBidEstimate then falls back to
 * the documented REPRESENTATIVE figures. We NEVER fabricate medians here.
 */
export async function loadPricebook(
  fetchImpl?: typeof fetch,
): Promise<PricebookMedians | null> {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const res = await fetchImpl('/parts/pricebook-medians.json');
    if (!res || !res.ok) return null;
    const json = (await res.json()) as unknown;
    return parsePricebook(json);
  } catch {
    return null;
  }
}

/**
 * Parse + validate a raw pricebook-medians JSON object. Exported so tests (and
 * non-fetch callers) can parse a known document directly. Returns null when the
 * shape is wrong or no median is usable.
 */
export function parsePricebook(json: unknown): PricebookMedians | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const rawMedians = obj.medians;
  if (!rawMedians || typeof rawMedians !== 'object') return null;

  const medians: Record<string, PricebookMedianEntry> = {};
  for (const [key, entry] of Object.entries(rawMedians as Record<string, unknown>)) {
    if (isMedianEntry(entry)) medians[key] = entry;
  }
  if (Object.keys(medians).length === 0) return null;

  const sourceRowCount =
    typeof obj.sourceRowCount === 'number' && Number.isFinite(obj.sourceRowCount)
      ? obj.sourceRowCount
      : 0;

  return {
    generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : '',
    sourceRowCount,
    currency: typeof obj.currency === 'string' ? obj.currency : 'USD',
    medians,
  };
}

/**
 * Build a resolved PriceTable from loaded pricebook medians (or null). When
 * `book` is present, each pricebook-backed key takes its REAL in-band median;
 * any key the book is missing falls back to the representative figure. When
 * `book` is null, every key uses the representative figure and kind is
 * 'representative'. Caller overrides (opts.unitPrices) win over both.
 */
export function resolvePriceTable(
  book: PricebookMedians | null,
  overrides?: Partial<Record<BidMaterialKey, number>>,
): PriceTable {
  const prices = { ...REPRESENTATIVE_UNIT_PRICES } as Record<BidMaterialKey, number>;
  const matchedRows: Partial<Record<BidMaterialKey, number>> = {};
  let kind: 'pricebook' | 'representative' = 'representative';
  let sourceRowCount = 0;

  if (book) {
    sourceRowCount = book.sourceRowCount;
    for (const key of PRICEBOOK_BACKED_KEYS) {
      const entry = book.medians[key];
      if (entry && Number.isFinite(entry.unitPrice) && entry.unitPrice > 0) {
        prices[key] = entry.unitPrice;
        matchedRows[key] = entry.matchedRows;
        kind = 'pricebook';
      }
    }
  }

  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'number' && Number.isFinite(v)) prices[k as BidMaterialKey] = v;
    }
  }

  return { kind, prices, matchedRows, sourceRowCount };
}

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
  /** Price per unit (USD) — a real pricebook median or representative figure. */
  unitPrice: number;
  /** qty * unitPrice (USD, rounded to cents). */
  extended: number;
  /** Where this line's unit price came from (honesty). */
  priceSource: PriceSource;
  /** Real pricebook rows backing this price (only for pricebook-median lines). */
  matchedRows?: number;
}

/** Physical drivers for a bid estimate (counts + footage). */
export interface BidDrivers {
  headCount: number;
  branchPipeFt: number;
  fittingCount: number;
  hangerCount: number;
  /** Cross-main linear feet (priced separately from branch pipe). Optional. */
  crossMainFt?: number;
  /** Drop / armover assemblies (typically one per head). Optional. */
  dropCount?: number;
  /** Number of escutcheons (typically one per head). Optional. */
  escutcheonCount?: number;
  /** Number of riser / alarm-valve assemblies. Optional, default 1. */
  riserValveCount?: number;
}

/** Overridable price + assumption knobs (all optional). */
export interface BidOptions {
  /** Per-key unit-price overrides — win over the price table. */
  unitPrices?: Partial<Record<BidMaterialKey, number>>;
  /**
   * A resolved price table (real pricebook medians preferred). When supplied,
   * its prices are used (with unitPrices overrides on top) and its kind drives
   * each line's priceSource. When omitted, the representative fallback is used.
   */
  priceTable?: PriceTable;
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
  /**
   * Overall price provenance: 'pricebook-median' when ANY pricebook-backed line
   * used a real median, else 'representative-fallback'.
   */
  priceSource: 'pricebook-median' | 'representative-fallback';
  /** Real pricebook rows the medians were computed over (0 in fallback). */
  pricebookRowCount: number;
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
 * Pricing: when `opts.priceTable` is supplied with kind 'pricebook', the
 * pricebook-backed lines use their REAL in-band median (priceSource
 * 'pricebook-median', carrying matchedRows); `riser_valve_assy` is always
 * representative. With no priceTable (or a 'representative' one), every line is
 * 'representative-fallback' / 'representative-only'. opts.unitPrices override any
 * source.
 *
 * Math (matches autosprink bid-scope.js):
 *   materialTotal = sum(qty * unitPrice) over all line items
 *   laborHours    = headCount*0.8 + (branchPipeFt+crossMainFt)*0.05 + fittingCount*0.3
 *   laborCost     = laborHours * $90/hr
 *   subtotal      = materialTotal + laborCost
 *   overhead      = subtotal * 0.10
 *   profit        = (subtotal + overhead) * 0.10   (profit margins the OH-loaded cost)
 *   total         = subtotal + overhead + profit
 *
 * Hangers + escutcheons + drops are MATERIAL lines (priced) but carry NO
 * separate labor line (their handling is folded into the pipe/head labor) —
 * mirroring the autosprink labor scope, which is driven by heads, pipe-ft, and
 * fittings only.
 */
export function buildBidEstimate(drivers: BidDrivers, opts: BidOptions = {}): BidEstimate {
  // Resolve the active price table. Precedence: opts.priceTable (with
  // opts.unitPrices layered on top) -> representative + opts.unitPrices.
  const baseTable: PriceTable = opts.priceTable ?? {
    kind: 'representative',
    prices: { ...REPRESENTATIVE_UNIT_PRICES },
    matchedRows: {},
    sourceRowCount: 0,
  };
  const prices: Record<BidMaterialKey, number> = { ...baseTable.prices };
  if (opts.unitPrices) {
    for (const [k, v] of Object.entries(opts.unitPrices)) {
      if (typeof v === 'number' && Number.isFinite(v)) prices[k as BidMaterialKey] = v;
    }
  }
  const tableKind = baseTable.kind;
  const matchedRows = baseTable.matchedRows;

  const headCount = positiveOrZero(drivers.headCount);
  const branchPipeFt = positiveOrZero(drivers.branchPipeFt);
  const crossMainFt = positiveOrZero(drivers.crossMainFt);
  const fittingCount = positiveOrZero(drivers.fittingCount);
  const hangerCount = positiveOrZero(drivers.hangerCount);
  const dropCount = drivers.dropCount === undefined ? 0 : positiveOrZero(drivers.dropCount);
  const escutcheonCount =
    drivers.escutcheonCount === undefined ? headCount : positiveOrZero(drivers.escutcheonCount);
  const riserValveCount =
    drivers.riserValveCount === undefined ? 1 : positiveOrZero(drivers.riserValveCount);

  // Build the takeoff. Lines with a zero qty are still emitted for keys that are
  // always present (heads, branch pipe, fitting, hanger, escutcheon, riser);
  // optional cross-main + drop lines are emitted only when they carry a qty so
  // backward-compatible callers (no crossMainFt/dropCount) keep the 6-line shape.
  const specs: { key: BidMaterialKey; qty: number; optional?: boolean }[] = [
    { key: 'sprinkler_head', qty: headCount },
    { key: 'branch_pipe', qty: branchPipeFt },
    { key: 'cross_main_pipe', qty: crossMainFt, optional: true },
    { key: 'fitting', qty: fittingCount },
    { key: 'drop_armover', qty: dropCount, optional: true },
    { key: 'hanger', qty: hangerCount },
    { key: 'escutcheon', qty: escutcheonCount },
    { key: 'riser_valve_assy', qty: riserValveCount },
  ];

  const lineItems: BidLineItem[] = specs
    .filter((s) => !s.optional || s.qty > 0)
    .map(({ key, qty }) => {
      const unitPrice = prices[key];
      // priceSource is per-line + honest: riser_valve_assy has no pricebook band
      // so it is representative-only; other keys are pricebook-median when the
      // table is pricebook-backed AND this key has a real matched median, else
      // representative-fallback.
      let priceSource: PriceSource;
      if (!PRICEBOOK_BACKED_KEYS.has(key)) {
        priceSource = 'representative-only';
      } else if (tableKind === 'pricebook' && (matchedRows[key] ?? 0) > 0) {
        priceSource = 'pricebook-median';
      } else {
        priceSource = 'representative-fallback';
      }
      const item: BidLineItem = {
        key,
        description: MATERIAL_DESCRIPTIONS[key],
        qty: round(qty),
        unit: MATERIAL_UNITS[key],
        unitPrice: round(unitPrice),
        extended: round(qty * unitPrice),
        priceSource,
      };
      if (priceSource === 'pricebook-median') item.matchedRows = matchedRows[key];
      return item;
    });

  const materialTotal = round(lineItems.reduce((sum, l) => sum + l.extended, 0));

  // Field labor from physical drivers (hours-based assumptions). Cross-main feet
  // count as pipe-ft labor alongside branch feet.
  const hoursPerHead = numOr(opts.hoursPerHead, LABOR_ASSUMPTIONS.hoursPerHead);
  const hoursPerPipeFt = numOr(opts.hoursPerPipeFt, LABOR_ASSUMPTIONS.hoursPerPipeFt);
  const hoursPerFitting = numOr(opts.hoursPerFitting, LABOR_ASSUMPTIONS.hoursPerFitting);
  const ratePerHour = numOr(opts.laborRatePerHour, LABOR_ASSUMPTIONS.laborRatePerHour);

  const laborHours = round(
    headCount * hoursPerHead +
      (branchPipeFt + crossMainFt) * hoursPerPipeFt +
      fittingCount * hoursPerFitting,
  );
  const laborCost = round(laborHours * ratePerHour);

  const subtotal = round(materialTotal + laborCost);

  // OH&P: overhead on subtotal, profit on (subtotal + overhead).
  const overheadPct = numOr(opts.overhead, OHP_ASSUMPTIONS.overhead);
  const profitPct = numOr(opts.profit, OHP_ASSUMPTIONS.profit);
  const overhead = round(subtotal * overheadPct);
  const profit = round((subtotal + overhead) * profitPct);

  const total = round(subtotal + overhead + profit);

  const anyPricebook = lineItems.some((l) => l.priceSource === 'pricebook-median');

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
    priceSource: anyPricebook ? 'pricebook-median' : 'representative-fallback',
    pricebookRowCount: anyPricebook ? baseTable.sourceRowCount : 0,
    disclaimer: BID_DISCLAIMER,
  };
}

/* ------------------------------------------------------- estimateFromLayout */

/**
 * Derive best-effort physical drivers from a laid-out grid, DETERMINISTICALLY.
 *
 * Heuristics (documented, geometry-derived — NOT tuned to any dollar target):
 *   - headCount    = layout.count (rows * cols)
 *   - branchPipeFt = total branch-line run, from grid geometry:
 *       branch run per row  = (cols - 1) * spacing   [head-to-head along a row]
 *       branch total        = rows * branchRunPerRow
 *   - crossMainFt  = (rows - 1) * spacing            [trunk spanning the rows]
 *   - fittingCount = heads (1 tee/drop per head) + branch taps (1 per branch line,
 *       i.e. rows) + a small fixed allowance for the riser/turn fittings (4).
 *   - dropCount    = headCount (one drop/armover per head)
 *   - hangerCount  = ceil((branchPipeFt + crossMainFt) / 10)  [a hanger ~every 10 ft]
 *   - escutcheon   = headCount (one per head)
 *   - riserValve   = 1
 *
 * Backward-compatibility: branchPipeFt is reported as (branch + cross-main) so
 * the legacy single-pipe figure and totals are preserved when crossMainFt is not
 * separately priced. Callers that pass the full drivers (with crossMainFt) into
 * buildBidEstimate get the richer split takeoff.
 */
export function deriveDriversFromLayout(layout: LayoutResult): BidDrivers {
  const { rows, cols, spacingFt, count } = layout;

  const branchRunPerRow = cols > 1 ? (cols - 1) * spacingFt : 0;
  const branchTotal = rows * branchRunPerRow;
  const crossMainRun = rows > 1 ? (rows - 1) * spacingFt : 0;
  // Legacy combined pipe figure (branch + cross-main) — preserves prior totals.
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
 * Derive a FULLER, split takeoff from a layout — branch pipe and cross-main
 * priced separately, plus one drop/armover per head. Deterministic, geometry-
 * derived. Used by the studio bid so the BOM is honest about its parts; the
 * legacy deriveDriversFromLayout is retained for backward-compatible totals.
 */
export function deriveFullDriversFromLayout(layout: LayoutResult): BidDrivers {
  const { rows, cols, spacingFt, count } = layout;

  const branchRunPerRow = cols > 1 ? (cols - 1) * spacingFt : 0;
  const branchPipeFt = round(rows * branchRunPerRow);
  const crossMainFt = round(rows > 1 ? (rows - 1) * spacingFt : 0);

  const RISER_FITTING_ALLOWANCE = 4;
  const fittingCount = count + rows + RISER_FITTING_ALLOWANCE;

  const totalPipeFt = branchPipeFt + crossMainFt;
  const hangerCount = totalPipeFt > 0 ? Math.ceil(totalPipeFt / 10) : 0;

  return {
    headCount: count,
    branchPipeFt,
    crossMainFt,
    fittingCount,
    dropCount: count,
    hangerCount,
    escutcheonCount: count,
    riserValveCount: 1,
  };
}

/**
 * Compute a best-effort priced bid ESTIMATE directly from a layout input
 * (width / length / hazard). DETERMINISTIC: lays out the grid, derives drivers,
 * then prices them. Convenience wrapper over layoutHeads + deriveDriversFromLayout
 * + buildBidEstimate. Pass `opts.priceTable` (from loadPricebook + resolvePriceTable)
 * to price against the REAL pricebook medians; without it the representative
 * fallback is used.
 */
export function estimateFromLayout(input: LayoutInput, opts: BidOptions = {}): BidEstimate {
  const layout = layoutHeads(input);
  const drivers = deriveDriversFromLayout(layout);
  return buildBidEstimate(drivers, opts);
}

/**
 * Like estimateFromLayout but with the FULLER split takeoff (branch + cross-main
 * priced separately, drops per head). Preferred for the studio panel.
 */
export function estimateFullFromLayout(input: LayoutInput, opts: BidOptions = {}): BidEstimate {
  const layout = layoutHeads(input);
  const drivers = deriveFullDriversFromLayout(layout);
  return buildBidEstimate(drivers, opts);
}
