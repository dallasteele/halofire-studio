// HaloFire CAD — bid PRICING SINGLE-SOURCE re-export (W6).
//
// The CAD app does NOT fork or reimplement the bid math. Every pricing rule —
// the REAL pricebook-median loader (loadPricebook / parsePricebook /
// resolvePriceTable), the deterministic estimate (buildBidEstimate: materials =
// sum(qty*unitPrice), labor 0.8 hr/head + 0.05 hr/pipe-ft + 0.3 hr/fitting @
// $90/hr, OH&P 10%+10% compounded), the per-line priceSource honesty, and the
// disclaimer — comes from the ONE authored source in the studio app:
//
//   apps/studio/src/lib/bid.ts
//
// This mirrors the nfpa13-rules.ts + head-catalog.ts cross-app shim pattern: if a
// pricing number is wrong it is wrong in exactly one place. No price is duplicated
// or fabricated here. The CAD-specific glue (turn a routed-network takeoff into the
// studio's BidDrivers, then price it) lives in priced-bid.ts.
//
// HONESTY: re-exporting preserves every honest priceSource and the BEST-EFFORT
// ESTIMATE disclaimer. Materials use the REAL pricebook-derived in-band medians
// over the imported Victaulic/ARGCO/FFF rows when present; unpriced/absent lines
// fall back to documented representative figures (clearly labelled). This is NOT a
// committed quote, NOT AHJ / PE / final bid.

export * from '../../../studio/src/lib/bid';
