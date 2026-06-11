/**
 * AB3 — Estimate assembly (pure module).
 *
 * Turns either:
 *   (a) a CAD W5C bid-payload  { projectName, source, generatedAt, items:[{sku, description, quantity, unit}], disclaimer }
 *   (b) manual line items      [{ description, quantity, unit, unitCost?, bomKey? }]
 * into a priced estimate the renderer (bid-html.js) and the DB layer consume:
 *   { lineItems:[{description, quantity, unit, unitCost, extendedCost, priceSource, bomKey?}],
 *     subtotal, overheadPct, profitPct, total, anyEstimated, disclaimer, source }
 *
 * Pricing comes from the real pricebook resolver (buildResolverFromDb) keyed by
 * the canonical BOM keys (sprinkler_head, branch_pipe, fitting, ...). CAD items
 * carry no price; we map their sku/kind to a BOM key and resolve a real in-band
 * median where one exists, otherwise a clearly-labelled fallback unit cost.
 * Manual items may supply an explicit unitCost (priceSource 'manual').
 *
 * HONESTY (fail-closed): every estimate carries the design-aid disclaimer string
 * and per-line priceSource so a fabricated price can never masquerade as a quote.
 * Nothing here commits or sends anything.
 */

import { FALLBACK_UNIT_COSTS } from '../engine/sprinkler-layout.js';
import { PRICE_BANDS } from '../engine/pricebook-pricing.js';

/** The single design-aid disclaimer stored with every estimate (verbatim). */
export const ESTIMATE_DISCLAIMER =
  'This is a best-effort design-aid estimate generated from imported vendor '
  + 'pricebooks and CAD takeoff quantities. It is NOT a committed bid, not a '
  + 'sealed/PE engineering document, and carries no AHJ approval. Quantities and '
  + 'prices are representative and must be verified before any commitment.';

const VALID_BOM_KEYS = new Set(Object.keys(PRICE_BANDS));

/** Round to cents. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Heuristically map a CAD takeoff line (sku is `${kind}:${sizeIn}:${material}`,
 * plus the human description) onto a canonical BOM key for pricebook lookup.
 * Returns null when nothing plausibly matches (line is then a labelled fallback
 * of $0 and flagged 'unpriced').
 */
export function bomKeyForCadItem(item) {
  const hay = `${item.sku || ''} ${item.description || ''}`.toLowerCase();
  const kind = String(item.sku || '').split(':')[0];
  // Most specific first.
  if (/\besfr\b/.test(hay)) return 'esfr_head';
  if (/\bhead\b|pendent|upright|sprinkler/.test(hay)) return 'sprinkler_head';
  if (/escutcheon/.test(hay)) return 'escutcheon';
  if (/hanger/.test(hay)) return 'hanger';
  if (/seismic|sway|brace/.test(hay)) return 'seismic_brace';
  if (/drop|armover|arm-over/.test(hay)) return 'drop_armover';
  if (/underground|c900|ductile/.test(hay)) return 'underground_main';
  if (/bulk\s*main/.test(hay)) return 'bulk_main_pipe';
  if (/feed\s*main/.test(hay)) return 'feed_main_pipe';
  if (/cross\s*main/.test(hay)) return 'cross_main_pipe';
  // Pipe before fittings: 'tee' is a substring of 'steel', so a steel-pipe line
  // must resolve to pipe, not be hijacked by a word-boundaried 'tee'.
  if (/\bpipe\b|sch\s?40|sch\s?10/.test(hay) || kind === 'pipe') return 'branch_pipe';
  if (/\btee\b|\belbow\b|\bcoupling\b|\bfitting\b/.test(hay) || kind === 'fitting') return 'fitting';
  return null;
}

/** Resolve a unit cost for a BOM key. Returns {unitCost, priceSource}. */
function resolveUnitCost(bomKey, priceResolver) {
  if (bomKey && VALID_BOM_KEYS.has(bomKey)) {
    const resolved = priceResolver ? priceResolver(bomKey) : null;
    if (typeof resolved === 'number' && resolved >= 0) {
      return { unitCost: round2(resolved), priceSource: 'pricebook-median' };
    }
    const fallback = FALLBACK_UNIT_COSTS[bomKey];
    if (typeof fallback === 'number') {
      return { unitCost: round2(fallback), priceSource: 'representative-fallback' };
    }
  }
  // No mappable key and no manual price — honest $0, clearly flagged.
  return { unitCost: 0, priceSource: 'unpriced' };
}

function finiteQty(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`estimate: ${label} must be a finite, non-negative number`);
  }
  return n;
}

/**
 * Build priced line items from a CAD bid-payload.
 * @param {object} payload  the W5C BidPayload
 * @param {(key:string)=>number|null} priceResolver
 */
export function lineItemsFromCadPayload(payload, priceResolver) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('estimate: CAD payload must have a non-empty items array');
  }
  return payload.items.map((item, i) => {
    const quantity = finiteQty(item.quantity, `items[${i}].quantity`);
    const description = String(item.description ?? item.sku ?? `Item ${i + 1}`);
    const unit = String(item.unit ?? 'ea');
    const bomKey = bomKeyForCadItem(item);
    const { unitCost, priceSource } = resolveUnitCost(bomKey, priceResolver);
    return {
      description,
      quantity,
      unit,
      unitCost,
      extendedCost: round2(unitCost * quantity),
      priceSource,
      bomKey: bomKey || null,
    };
  });
}

/**
 * Build priced line items from manual entries. A manual unitCost (when finite,
 * >= 0) is authoritative ('manual'); otherwise we price by bomKey via the
 * pricebook resolver (same path as CAD).
 */
export function lineItemsFromManual(items, priceResolver) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('estimate: manual items must be a non-empty array');
  }
  return items.map((item, i) => {
    const quantity = finiteQty(item.quantity, `items[${i}].quantity`);
    const description = String(item.description ?? `Item ${i + 1}`).trim();
    if (!description) throw new Error(`estimate: items[${i}].description is required`);
    const unit = String(item.unit ?? 'ea');
    let unitCost;
    let priceSource;
    let bomKey = item.bomKey && VALID_BOM_KEYS.has(item.bomKey) ? item.bomKey : null;
    if (item.unitCost != null && item.unitCost !== '') {
      const uc = Number(item.unitCost);
      if (!Number.isFinite(uc) || uc < 0) {
        throw new Error(`estimate: items[${i}].unitCost must be a finite, non-negative number`);
      }
      unitCost = round2(uc);
      priceSource = 'manual';
    } else {
      const resolved = resolveUnitCost(bomKey, priceResolver);
      unitCost = resolved.unitCost;
      priceSource = resolved.priceSource;
    }
    return {
      description,
      quantity,
      unit,
      unitCost,
      extendedCost: round2(unitCost * quantity),
      priceSource,
      bomKey,
    };
  });
}

/**
 * Assemble a full estimate from priced line items + OH/profit percentages.
 * subtotal = sum(extendedCost); overhead and profit are compounded
 * (subtotal * (1+oh) * (1+profit)) — matching the studio bid OH&P convention.
 */
export function assembleEstimate(lineItems, { overheadPct = 10, profitPct = 10, source = 'manual' } = {}) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error('estimate: lineItems must be a non-empty array');
  }
  const oh = Number(overheadPct);
  const profit = Number(profitPct);
  if (!Number.isFinite(oh) || oh < 0) throw new Error('estimate: overheadPct must be a finite, non-negative number');
  if (!Number.isFinite(profit) || profit < 0) throw new Error('estimate: profitPct must be a finite, non-negative number');

  const subtotal = round2(lineItems.reduce((sum, l) => sum + l.extendedCost, 0));
  const total = round2(subtotal * (1 + oh / 100) * (1 + profit / 100));
  return {
    lineItems,
    subtotal,
    overheadPct: oh,
    profitPct: profit,
    total,
    anyEstimated: lineItems.some((l) => l.priceSource !== 'manual' && l.priceSource !== 'pricebook-median'),
    disclaimer: ESTIMATE_DISCLAIMER,
    source,
  };
}

/** Detects a CAD W5C bid-payload shape (vs a manual {items:[...]} body). */
export function isCadPayload(body) {
  return Boolean(body && body.source === 'halofire-cad' && Array.isArray(body.items));
}

/**
 * Top-level: build a full estimate from a request body that is EITHER a CAD
 * bid-payload or a manual estimate request.
 *
 * body (CAD):    { source:'halofire-cad', items:[{sku,description,quantity,unit}], ... overheadPct?, profitPct? }
 * body (manual): { items:[{description,quantity,unit,unitCost?,bomKey?}], overheadPct?, profitPct? }
 */
export function buildEstimateFromBody(body, priceResolver) {
  if (!body || typeof body !== 'object') {
    throw new Error('estimate: request body must be an object');
  }
  const overheadPct = body.overheadPct != null ? Number(body.overheadPct) : 10;
  const profitPct = body.profitPct != null ? Number(body.profitPct) : 10;
  if (isCadPayload(body)) {
    const lineItems = lineItemsFromCadPayload(body, priceResolver);
    return assembleEstimate(lineItems, { overheadPct, profitPct, source: 'halofire-cad' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('estimate: provide a CAD bid-payload (source:halofire-cad) or a non-empty items array');
  }
  const lineItems = lineItemsFromManual(body.items, priceResolver);
  return assembleEstimate(lineItems, { overheadPct, profitPct, source: 'manual' });
}

export default {
  ESTIMATE_DISCLAIMER,
  bomKeyForCadItem,
  lineItemsFromCadPayload,
  lineItemsFromManual,
  assembleEstimate,
  isCadPayload,
  buildEstimateFromBody,
};
