// PURE manufacturer-catalog logic — no React / three imports.
//
// Loads + parses the REAL manufacturer catalog ingested from public sprinkler
// data sheets (scripts/ingest-catalog/crawl.py -> public/catalog/manufacturer-
// catalog.json) into typed CatalogPart[], plus group-by / search-filter helpers
// and a fail-soft loader.
//
// HONESTY (hard, fail-closed):
//   - These are catalog SPEC records extracted from PUBLIC manufacturer data
//     sheets. Every field is a real extracted value; unparseable fields are null
//     in the source JSON — this module NEVER invents a value to fill a gap.
//   - They are NOT manufacturer-exact geometry, NOT AHJ / PE / code-certified
//     selections. Provenance is catalog metadata only; the 3D geometry tier
//     (manufacturer-step / build123d) is separate and is NOT attached here.
//   - The loader fail-softs to { entries: [] } on any error. Parsing drops any
//     malformed entry (missing the mandatory mfr / model / datasheetUrl) rather
//     than fabricating fields for it.

/** Connectivity port (subset of the §2 Port model carried by a catalog entry). */
export interface CatalogPort {
  method: string | null;
  nominalSizeIn: number | null;
  role: string | null;
}

/** One ingested catalog spec record. */
export interface CatalogPart {
  id: string;
  mfr: string;
  model: string;
  sin: string | null;
  category: string;
  kFactor: number | null;
  port: CatalogPort | null;
  tempRatingsF: number[] | null;
  responseType: string | null;
  finishes: string[] | null;
  datasheetUrl: string;
  sourceUrl: string;
}

/** A source row from the crawl report (which sheets were read / failed). */
export interface CatalogSource {
  mfr: string;
  url: string;
  partCount: number;
  error?: string;
}

export interface ManufacturerCatalog {
  generatedAt: string | null;
  disclaimer: string | null;
  sources: CatalogSource[];
  entries: CatalogPart[];
}

/** Group of catalog parts under one manufacturer (then one category). */
export interface CatalogGroup {
  mfr: string;
  /** Parts grouped by category within this manufacturer. */
  categories: { category: string; parts: CatalogPart[] }[];
  /** Flat count across all categories. */
  count: number;
}

const EMPTY: ManufacturerCatalog = {
  generatedAt: null,
  disclaimer: null,
  sources: [],
  entries: [],
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asNumberArrayOrNull(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const nums = v.filter(isFiniteNumber);
  return nums.length > 0 ? nums : null;
}

function asStringArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const strs = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return strs.length > 0 ? strs : null;
}

function parsePort(v: unknown): CatalogPort | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const method = typeof o.method === 'string' && o.method.length > 0 ? o.method : null;
  const nominalSizeIn = isFiniteNumber(o.nominalSizeIn) ? o.nominalSizeIn : null;
  const role = typeof o.role === 'string' && o.role.length > 0 ? o.role : null;
  // An entirely empty port carries no information — collapse to null.
  if (method === null && nominalSizeIn === null && role === null) return null;
  return { method, nominalSizeIn, role };
}

/**
 * Parse one raw entry into a CatalogPart, or null if it is malformed. The HARD
 * requirement: a real non-empty mfr, model, and datasheetUrl. Without all three
 * the entry cannot be trusted to trace to a real data sheet, so it is dropped
 * (never patched).
 */
export function parseCatalogEntry(raw: unknown): CatalogPart | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const mfr = typeof o.mfr === 'string' ? o.mfr.trim() : '';
  const model = typeof o.model === 'string' ? o.model.trim() : '';
  const datasheetUrl =
    typeof o.datasheetUrl === 'string' ? o.datasheetUrl.trim() : '';
  if (mfr.length === 0 || model.length === 0 || datasheetUrl.length === 0) {
    return null;
  }

  const sourceUrl =
    typeof o.sourceUrl === 'string' && o.sourceUrl.trim().length > 0
      ? o.sourceUrl.trim()
      : datasheetUrl;

  const category =
    typeof o.category === 'string' && o.category.length > 0 ? o.category : 'head';

  const sin = typeof o.sin === 'string' && o.sin.length > 0 ? o.sin : null;
  const id =
    typeof o.id === 'string' && o.id.length > 0
      ? o.id
      : `${mfr}-${sin ?? model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id,
    mfr,
    model,
    sin,
    category,
    kFactor: isFiniteNumber(o.kFactor) ? o.kFactor : null,
    port: parsePort(o.port),
    tempRatingsF: asNumberArrayOrNull(o.tempRatingsF),
    responseType:
      typeof o.responseType === 'string' && o.responseType.length > 0
        ? o.responseType
        : null,
    finishes: asStringArrayOrNull(o.finishes),
    datasheetUrl,
    sourceUrl,
  };
}

function parseSources(v: unknown): CatalogSource[] {
  if (!Array.isArray(v)) return [];
  const out: CatalogSource[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const mfr = typeof o.mfr === 'string' ? o.mfr : '';
    const url = typeof o.url === 'string' ? o.url : '';
    if (mfr.length === 0 || url.length === 0) continue;
    out.push({
      mfr,
      url,
      partCount: isFiniteNumber(o.partCount) ? o.partCount : 0,
      ...(typeof o.error === 'string' && o.error.length > 0
        ? { error: o.error }
        : {}),
    });
  }
  return out;
}

/**
 * Parse a raw JSON object into a typed ManufacturerCatalog. Unknown / malformed
 * shapes yield an empty catalog; individual malformed entries are dropped.
 */
export function parseManufacturerCatalog(json: unknown): ManufacturerCatalog {
  if (!json || typeof json !== 'object') return { ...EMPTY };
  const o = json as Record<string, unknown>;
  const rawEntries = Array.isArray(o.entries) ? o.entries : [];
  const entries: CatalogPart[] = [];
  for (const r of rawEntries) {
    const p = parseCatalogEntry(r);
    if (p) entries.push(p);
  }
  return {
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : null,
    disclaimer: typeof o.disclaimer === 'string' ? o.disclaimer : null,
    sources: parseSources(o.sources),
    entries,
  };
}

/**
 * Group catalog parts by manufacturer, then by category within each
 * manufacturer. Preserves first-seen order at both levels. Every input part
 * lands in exactly one (mfr, category) bucket; none dropped or duplicated.
 */
export function groupByManufacturer(parts: readonly CatalogPart[]): CatalogGroup[] {
  const mfrOrder: string[] = [];
  const mfrMap = new Map<
    string,
    { catOrder: string[]; cats: Map<string, CatalogPart[]> }
  >();

  for (const p of parts) {
    let m = mfrMap.get(p.mfr);
    if (!m) {
      m = { catOrder: [], cats: new Map() };
      mfrMap.set(p.mfr, m);
      mfrOrder.push(p.mfr);
    }
    let bucket = m.cats.get(p.category);
    if (!bucket) {
      bucket = [];
      m.cats.set(p.category, bucket);
      m.catOrder.push(p.category);
    }
    bucket.push(p);
  }

  return mfrOrder.map((mfr) => {
    const m = mfrMap.get(mfr)!;
    const categories = m.catOrder.map((category) => ({
      category,
      parts: m.cats.get(category)!,
    }));
    const count = categories.reduce((s, c) => s + c.parts.length, 0);
    return { mfr, categories, count };
  });
}

/**
 * Case-insensitive filter over a catalog part's model, SIN, mfr, category, and
 * response type. Empty / whitespace query returns all parts (input order). Never
 * fabricates; returns [] when nothing matches.
 */
export function filterCatalog(
  parts: readonly CatalogPart[],
  query: string,
): CatalogPart[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...parts];
  return parts.filter((p) => {
    return (
      p.model.toLowerCase().includes(q) ||
      (p.sin?.toLowerCase().includes(q) ?? false) ||
      p.mfr.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.responseType?.toLowerCase().includes(q) ?? false) ||
      (p.kFactor !== null && String(p.kFactor).includes(q))
    );
  });
}

/**
 * Fail-soft loader. With NO fetch implementation, or a fetch that fails /
 * returns non-2xx / yields invalid JSON, this returns an EMPTY catalog. The
 * honest default — the studio never claims catalog parts it could not load.
 */
export async function loadManufacturerCatalog(
  fetchImpl?: typeof fetch,
): Promise<ManufacturerCatalog> {
  if (typeof fetchImpl !== 'function') return { ...EMPTY };
  try {
    const res = await fetchImpl('/catalog/manufacturer-catalog.json');
    if (!res || !res.ok) return { ...EMPTY };
    const json = (await res.json()) as unknown;
    return parseManufacturerCatalog(json);
  } catch {
    return { ...EMPTY };
  }
}
