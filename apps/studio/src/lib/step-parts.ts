// PURE step.parts public-API client logic — no React / three.
// Networking is performed ONLY through an INJECTED fetch (fetchImpl); the module
// itself imports nothing that touches the network.
//
// SCOPE: GENERIC HARDWARE ONLY. The step.parts catalog is a library of generic
// mechanical/fastener/CAD parts (ISO fasteners, brackets, heat pipes, servos…).
//
// HONESTY (hard, verified live 2026-06-05): step.parts has ZERO fire-sprinkler /
// MEP coverage. q=sprinkler -> total:0 items:[]; q=pipe -> only thermal "heat
// pipe" (NOT plumbing); q=bolt -> real ISO fasteners. This module STRUCTURALLY
// prevents a fire/MEP query from being silently sourced from step.parts and
// mistaken for a real fire component — see isFireSprinklerQuery / assertGenericOnly.
//
// Any step.parts-sourced part maps to provenance source "step.parts" ->
// model_status "proxy" (see deriveModelStatus). Proxy is NOT engineering-accurate
// and NOT dimensionally verified.

export const STEP_PARTS_BASE_URL = 'https://api.step.parts/v1';

/** A single catalog part. Unknown extra fields pass through untouched. */
export interface StepPart {
  id: string;
  name: string;
  description: string;
  category: string;
  family: string;
  tags: string[];
  aliases: string[];
  standard?: Record<string, unknown>;
  productPage?: string;
  attributes?: Record<string, unknown>;
  /** Any additional fields the API returns are tolerated and preserved. */
  [extra: string]: unknown;
}

/** Catalog integrity / provenance block returned with every search response. */
export interface StepPartsCatalogMeta {
  partCount: number;
  lastModified: string;
  sha256: string;
  schemaUrl: string;
  openApiUrl: string;
  [extra: string]: unknown;
}

/** A faceted tag bucket. */
export interface StepPartsFacetTag {
  value: string;
  count: number;
}

/** Shape of GET /parts?q=… (verified live against the real API). */
export interface StepPartsSearchResponse {
  catalog: StepPartsCatalogMeta;
  items: StepPart[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  facets: { tags: StepPartsFacetTag[] };
  [extra: string]: unknown;
}

export interface StepPartsSearchOptions {
  limit?: number;
  page?: number;
}

export interface BuildStepPartsClientOptions {
  /** Injected fetch; defaults to globalThis.fetch. Tests pass a mock. */
  fetchImpl?: typeof fetch;
  /** Override the API base URL (e.g. for a proxy). Defaults to STEP_PARTS_BASE_URL. */
  baseUrl?: string;
  /**
   * OPT-IN feature flag. DEFAULT false. When false the client performs NO network
   * calls — searchParts/getPart throw a disabled error instead. The client must
   * never auto-call the network unless this is explicitly true.
   */
  enabled?: boolean;
}

export interface StepPartsClient {
  /** True only when the client was constructed with enabled:true. */
  readonly enabled: boolean;
  readonly baseUrl: string;
  /** Search generic hardware. Throws if disabled, on a fire query, or non-2xx. */
  searchParts(
    query: string,
    opts?: StepPartsSearchOptions,
  ): Promise<StepPartsSearchResponse>;
  /** Fetch a single part by id. Throws if disabled or non-2xx. */
  getPart(id: string): Promise<StepPart>;
}

/**
 * Fire-sprinkler / MEP vocabulary. A query touching ANY of these must NOT be
 * routed to step.parts (zero coverage) — it belongs on the catalog / build123d
 * path. Kept lowercase; matching is case-insensitive.
 */
export const FIRE_SPRINKLER_TERMS: readonly string[] = [
  'sprinkler',
  'head',
  'pendent',
  'upright',
  'sidewall',
  'esfr',
  'fdc',
  'standpipe',
  'riser',
  'deluge',
  'alarm valve',
  'fire pump',
  'escutcheon',
  'preaction',
  'dry pipe',
  'wet pipe',
  'backflow',
  'hose valve',
  'nfpa',
  'fire department connection',
] as const;

/** Word-boundary-aware tester for a single term against a lowercased query. */
function termMatches(loweredQuery: string, term: string): boolean {
  if (term.includes(' ')) {
    // Multi-word phrase: plain substring is sufficient and intent-clear.
    return loweredQuery.includes(term);
  }
  // Single token: require a word boundary so "head" matches but "header"/"headphone"
  // do not, and "bracket"/"bolt"/"screw" never accidentally trip a fire term.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(loweredQuery);
}

/**
 * THE GUARD. Returns true when a query refers to fire-sprinkler / MEP hardware
 * that step.parts cannot honestly serve. Case-insensitive, word-aware.
 */
export function isFireSprinklerQuery(q: string): boolean {
  if (typeof q !== 'string' || q.length === 0) {
    return false;
  }
  const lowered = q.toLowerCase();
  return FIRE_SPRINKLER_TERMS.some((term) => termMatches(lowered, term));
}

export interface RoutingDecision {
  /** The query that was evaluated. */
  query: string;
  /** Where this query should be sourced. */
  route: 'step.parts' | 'catalog/build123d';
  /** True when the query is safe for step.parts (generic hardware only). */
  allowed: boolean;
  /** Human-readable reason — surfaced so a fire route is never silent. */
  reason: string;
}

/**
 * Decide routing for a query WITHOUT throwing, so callers can branch.
 * Generic hardware -> step.parts; anything fire/MEP -> catalog/build123d.
 */
export function routeQuery(query: string): RoutingDecision {
  if (isFireSprinklerQuery(query)) {
    return {
      query,
      route: 'catalog/build123d',
      allowed: false,
      reason:
        'Fire-sprinkler / MEP query: step.parts has ZERO fire coverage — route ' +
        'to the catalog / build123d path. A step.parts result here would be a ' +
        'generic-hardware false match (proxy at best), never a real fire component.',
    };
  }
  return {
    query,
    route: 'step.parts',
    allowed: true,
    reason: 'Generic hardware query — safe to source from step.parts (proxy tier).',
  };
}

/**
 * Hard guard used on the network path. Throws on a fire/MEP query so it can NEVER
 * be silently sent to step.parts and mistaken for a real source. Returns the
 * (allowed) routing decision for a generic query.
 */
export function assertGenericOnly(query: string): RoutingDecision {
  const decision = routeQuery(query);
  if (!decision.allowed) {
    throw new Error(`step.parts routing blocked: ${decision.reason}`);
  }
  return decision;
}

/** Read the catalog integrity hash from a search response, if present. */
export function catalogSha(response: StepPartsSearchResponse): string | undefined {
  return response?.catalog?.sha256;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Build an OPT-IN step.parts client. Disabled by default: with enabled !== true,
 * searchParts/getPart throw a clear "disabled" error and perform NO network call.
 */
export function buildStepPartsClient(
  opts: BuildStepPartsClientOptions = {},
): StepPartsClient {
  const enabled = opts.enabled === true;
  const baseUrl = trimTrailingSlash(opts.baseUrl ?? STEP_PARTS_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);

  function ensureEnabled(): void {
    if (!enabled) {
      throw new Error(
        'step.parts client is disabled (opt-in feature flag is off). Construct ' +
          'with { enabled: true } to allow network calls. No request was sent.',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error(
        'step.parts client has no fetch implementation. Pass fetchImpl or run ' +
          'where globalThis.fetch exists.',
      );
    }
  }

  async function readJson<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      throw new Error(
        `step.parts ${what} failed: HTTP ${res.status} ${res.statusText}`.trim(),
      );
    }
    return (await res.json()) as T;
  }

  return {
    enabled,
    baseUrl,

    async searchParts(
      query: string,
      searchOpts: StepPartsSearchOptions = {},
    ): Promise<StepPartsSearchResponse> {
      ensureEnabled();
      // Block fire/MEP BEFORE any network call — structural honesty guard.
      assertGenericOnly(query);

      const params = new URLSearchParams();
      params.set('q', query);
      if (typeof searchOpts.limit === 'number') {
        params.set('limit', String(searchOpts.limit));
      }
      if (typeof searchOpts.page === 'number') {
        params.set('page', String(searchOpts.page));
      }
      const url = `${baseUrl}/parts?${params.toString()}`;
      const res = await fetchImpl!(url);
      return readJson<StepPartsSearchResponse>(res, `search "${query}"`);
    },

    async getPart(id: string): Promise<StepPart> {
      ensureEnabled();
      const url = `${baseUrl}/parts/${encodeURIComponent(id)}`;
      const res = await fetchImpl!(url);
      return readJson<StepPart>(res, `getPart "${id}"`);
    },
  };
}
