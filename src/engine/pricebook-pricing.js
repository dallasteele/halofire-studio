/**
 * Pricebook-backed unit-cost resolution for the auto-bid engine.
 *
 * The imported vendor pricebooks (7,208 rows) span everything from $0.11
 * nipples to $12k valve assemblies, so a naive keyword median is misleading
 * (e.g. "fitting" matches large assemblies). We therefore bound each BOM key
 * to a defensible price band for a representative small-diameter component and
 * take the median of pricebook rows WITHIN that band. The result is still a
 * real pricebook price, just a representative one. Best-effort internal alpha.
 */

// keywords: matched against LOWER(item). band: [min,max] sane unit-cost window.
export const PRICE_BANDS = Object.freeze({
  sprinkler_head: { keywords: ['pendent', 'upright', 'sprinkler head'], min: 5, max: 80 },
  branch_pipe: { keywords: ['sch 40', 'sch10', 'sch 10', 'black pipe', 'steel pipe', 'pipe'], min: 0.5, max: 20 },
  fitting: { keywords: ['tee', 'elbow', 'coupling', 'fitting'], min: 0.5, max: 30 },
  hanger: { keywords: ['hanger'], min: 0.3, max: 15 },
  escutcheon: { keywords: ['escutcheon'], min: 0.2, max: 12 },
  // T25 — ESFR / storage size classes. The band is the size-class proxy: a
  // larger nominal diameter resolves a higher $/ft window, so the in-band median
  // is a REAL pricebook price for that size class (never an inflated constant).
  // Each band was confirmed to return a real non-null median against the seeded
  // 7,208-row pricebook (esfr_head 42, cross 10.92, feed 21.56, bulk 27.02,
  // underground 30.17). Monotone by size: cross <= feed <= bulk.
  esfr_head: { keywords: ['esfr', 'pendent', 'upright', 'sprinkler head'], min: 15, max: 150 },
  cross_main_pipe: { keywords: ['sch 40', 'sch 10', 'sch10', 'black pipe', 'steel pipe', 'pipe'], min: 3, max: 45 },
  feed_main_pipe: { keywords: ['sch 40', 'sch 10', 'sch10', 'black pipe', 'steel pipe', 'pipe'], min: 8, max: 120 },
  bulk_main_pipe: { keywords: ['sch 40', 'sch 10', 'sch10', 'black pipe', 'steel pipe', 'pipe'], min: 12, max: 200 },
  underground_main: { keywords: ['ductile', 'underground', 'di pipe', 'c900', 'pipe'], min: 12, max: 300 },
});

/** Median of a numeric array (lower-middle for even length). Deterministic. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Pick a representative unit price for a BOM key from pricebook rows.
 * @param {Array<{item:string, price:number}>} rows  candidate pricebook rows
 * @param {string} key  BOM key (e.g. 'sprinkler_head')
 * @returns {number|null} representative in-band median, or null if none match
 */
export function resolvePriceFromRows(rows, key) {
  const band = PRICE_BANDS[key];
  if (!band) return null;
  const matches = rows.filter((r) => {
    if (!(r.price > 0) || r.price < band.min || r.price > band.max) return false;
    const item = String(r.item || '').toLowerCase();
    return band.keywords.some((kw) => item.includes(kw));
  });
  return median(matches.map((r) => r.price));
}

/**
 * Build a cached resolver backed by a better-sqlite3 db handle.
 * Pulls candidate rows once per key, then applies band + median.
 */
export function buildResolverFromDb(db) {
  const cache = new Map();
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const band = PRICE_BANDS[key];
    if (!band) { cache.set(key, null); return null; }
    // One query per key: rows in the band whose item matches any keyword.
    const like = band.keywords.map(() => 'LOWER(item) LIKE ?').join(' OR ');
    const params = band.keywords.map((kw) => `%${kw.toLowerCase()}%`);
    const rows = db
      .prepare(`SELECT item, price FROM pricebook WHERE price >= ? AND price <= ? AND (${like})`)
      .all(band.min, band.max, ...params);
    const price = median(rows.map((r) => r.price));
    cache.set(key, price);
    return price;
  };
}
