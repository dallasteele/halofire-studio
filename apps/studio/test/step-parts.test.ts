import { describe, expect, it, vi } from 'vitest';
import {
  STEP_PARTS_BASE_URL,
  FIRE_SPRINKLER_TERMS,
  buildStepPartsClient,
  isFireSprinklerQuery,
  assertGenericOnly,
  routeQuery,
  catalogSha,
  type StepPart,
  type StepPartsSearchResponse,
} from '../src/lib/step-parts';
import { deriveModelStatus } from '../src/lib/provenance';

// ---------------------------------------------------------------------------
// REAL captured shapes (verified live against https://api.step.parts/v1 by the
// parent on 2026-06-05). Tests use these via a MOCK fetch — they NEVER hit the
// live network. Do NOT claim a live fetch happened from this suite.
// ---------------------------------------------------------------------------

const CATALOG_SHA =
  '05a527749de56cf65c30030e5456b4dbef67ea7c9a5ff712996efdb26be0833e';

function catalogMeta() {
  return {
    partCount: 12734,
    lastModified: '2026-06-01T00:00:00.000Z',
    sha256: CATALOG_SHA,
    schemaUrl: 'https://api.step.parts/v1/schema.json',
    openApiUrl: 'https://api.step.parts/v1/openapi.json',
  };
}

// q=sprinkler -> ZERO fire coverage (verified live).
const SPRINKLER_RESPONSE: StepPartsSearchResponse = {
  catalog: catalogMeta(),
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
  facets: { tags: [] },
};

// q=bolt -> one real ISO fastener (verified live).
const BOLT_PART: StepPart = {
  id: 'iso4017_hex_head_cap_screw_m6x25',
  name: 'ISO 4017 Hex Head Cap Screw M6x25',
  description: 'Fully threaded hex head cap screw per ISO 4017, M6 x 25 mm.',
  category: 'fastener',
  family: 'hex_head_cap_screw',
  tags: ['fastener', 'screw', 'iso', 'hex'],
  aliases: ['hex bolt', 'cap screw'],
  standard: { id: 'ISO 4017', size: 'M6', length: 25 },
  productPage: 'https://step.parts/parts/iso4017_hex_head_cap_screw_m6x25',
  attributes: { thread: 'M6', length_mm: 25, head: 'hex' },
};

const BOLT_RESPONSE: StepPartsSearchResponse = {
  catalog: catalogMeta(),
  items: [BOLT_PART],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
  facets: { tags: [{ value: 'fastener', count: 1 }] },
};

/** Build a mock fetch that returns a 200 JSON body and records called URLs. */
function okFetch(body: unknown, urls: string[] = []): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/** Build a mock fetch that returns a non-2xx error. */
function errFetch(status: number, statusText: string): typeof fetch {
  return vi.fn(async () => {
    return new Response('nope', { status, statusText });
  }) as unknown as typeof fetch;
}

describe('buildStepPartsClient — opt-in / disabled by default', () => {
  it('is DISABLED by default and performs NO network call', async () => {
    const fetchImpl = okFetch(BOLT_RESPONSE);
    const client = buildStepPartsClient({ fetchImpl }); // no enabled flag
    expect(client.enabled).toBe(false);

    await expect(client.searchParts('bolt')).rejects.toThrow(/disabled/i);
    await expect(client.getPart('iso4017_hex_head_cap_screw_m6x25')).rejects.toThrow(
      /disabled/i,
    );
    // Mock fetch must have been left completely untouched.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call the network even when enabled is explicitly false', async () => {
    const fetchImpl = okFetch(BOLT_RESPONSE);
    const client = buildStepPartsClient({ fetchImpl, enabled: false });
    await expect(client.searchParts('bolt')).rejects.toThrow(/disabled/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the canonical base URL by default', () => {
    expect(STEP_PARTS_BASE_URL).toBe('https://api.step.parts/v1');
    const client = buildStepPartsClient({ enabled: true, fetchImpl: okFetch({}) });
    expect(client.baseUrl).toBe('https://api.step.parts/v1');
  });
});

describe('buildStepPartsClient — searchParts (enabled, mocked)', () => {
  it('parses items/total/catalog.sha256 for a generic query (q=bolt)', async () => {
    const urls: string[] = [];
    const fetchImpl = okFetch(BOLT_RESPONSE, urls);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });

    const res = await client.searchParts('bolt', { limit: 5, page: 1 });
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('iso4017_hex_head_cap_screw_m6x25');
    expect(res.items[0].category).toBe('fastener');
    expect(catalogSha(res)).toBe(CATALOG_SHA);
    expect(res.catalog.partCount).toBe(12734);

    // URL is well-formed and URL-encodes the query + paging.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('https://api.step.parts/v1/parts?');
    expect(urls[0]).toContain('q=bolt');
    expect(urls[0]).toContain('limit=5');
    expect(urls[0]).toContain('page=1');
  });

  it('URL-encodes a query with spaces/special chars', async () => {
    const urls: string[] = [];
    const fetchImpl = okFetch(BOLT_RESPONSE, urls);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });
    await client.searchParts('hex cap screw');
    expect(urls[0]).toContain('q=hex+cap+screw');
    expect(urls[0]).not.toContain('q=hex cap screw');
  });

  it('returns the VERIFIED zero-coverage contract for q=sprinkler shape', async () => {
    // We bypass the routing guard here to prove the captured shape itself is empty.
    // (The client would block this query before fetching — see the guard tests.)
    const fetchImpl = okFetch(SPRINKLER_RESPONSE);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });
    // Use a non-fire query but assert against the sprinkler body to verify parsing
    // of an empty result set without tripping assertGenericOnly.
    const res = await client.searchParts('servo-that-returns-empty');
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.hasNextPage).toBe(false);
  });

  it('throws a clear error on a non-2xx response', async () => {
    const client = buildStepPartsClient({
      enabled: true,
      fetchImpl: errFetch(500, 'Internal Server Error'),
    });
    await expect(client.searchParts('bolt')).rejects.toThrow(/HTTP 500/);
  });
});

describe('buildStepPartsClient — getPart (enabled, mocked)', () => {
  it('parses a single StepPart by id', async () => {
    const urls: string[] = [];
    const fetchImpl = okFetch(BOLT_PART, urls);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });

    const part = await client.getPart('iso4017_hex_head_cap_screw_m6x25');
    expect(part.id).toBe('iso4017_hex_head_cap_screw_m6x25');
    expect(part.family).toBe('hex_head_cap_screw');
    expect(part.tags).toContain('iso');
    expect(urls[0]).toBe(
      'https://api.step.parts/v1/parts/iso4017_hex_head_cap_screw_m6x25',
    );
  });

  it('URL-encodes the id path segment', async () => {
    const urls: string[] = [];
    const fetchImpl = okFetch(BOLT_PART, urls);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });
    await client.getPart('weird id/with?chars');
    expect(urls[0]).toBe(
      'https://api.step.parts/v1/parts/weird%20id%2Fwith%3Fchars',
    );
  });

  it('throws a clear error on a non-2xx response', async () => {
    const client = buildStepPartsClient({
      enabled: true,
      fetchImpl: errFetch(404, 'Not Found'),
    });
    await expect(client.getPart('nope')).rejects.toThrow(/HTTP 404/);
  });
});

describe('isFireSprinklerQuery — the coverage guard', () => {
  it('flags fire/MEP queries (verified zero-coverage vocabulary)', () => {
    for (const q of [
      'sprinkler',
      'fdc',
      'standpipe',
      'esfr',
      'riser',
      'pendent head',
      'sidewall',
      'deluge',
      'alarm valve',
      'fire pump',
      'escutcheon',
      'Sprinkler Head', // case-insensitive
    ]) {
      expect(isFireSprinklerQuery(q)).toBe(true);
    }
  });

  it('does NOT flag generic hardware queries step.parts actually serves', () => {
    for (const q of ['bolt', 'bracket', 'screw', 'servo', 'heat pipe', 'M6x25']) {
      expect(isFireSprinklerQuery(q)).toBe(false);
    }
  });

  it('does not false-positive on words that merely contain a term', () => {
    // "head" is a fire term but must be word-boundary matched.
    expect(isFireSprinklerQuery('header')).toBe(false);
    expect(isFireSprinklerQuery('headphone')).toBe(false);
    expect(isFireSprinklerQuery('')).toBe(false);
  });

  it('exposes a non-empty, lowercase term list', () => {
    expect(FIRE_SPRINKLER_TERMS.length).toBeGreaterThan(5);
    for (const t of FIRE_SPRINKLER_TERMS) {
      expect(t).toBe(t.toLowerCase());
    }
  });
});

describe('assertGenericOnly / routeQuery', () => {
  it('BLOCKS a fire query (cannot be silently sent to step.parts)', () => {
    expect(() => assertGenericOnly('sprinkler')).toThrow(/blocked/i);
    expect(() => assertGenericOnly('fdc')).toThrow(/zero fire coverage/i);
  });

  it('ALLOWS a generic query and returns a routing decision', () => {
    const d = assertGenericOnly('bolt');
    expect(d.allowed).toBe(true);
    expect(d.route).toBe('step.parts');
  });

  it('routes fire queries to catalog/build123d without throwing', () => {
    expect(routeQuery('standpipe')).toMatchObject({
      route: 'catalog/build123d',
      allowed: false,
    });
    expect(routeQuery('bracket')).toMatchObject({
      route: 'step.parts',
      allowed: true,
    });
  });

  it('searchParts on a fire query throws BEFORE any network call', async () => {
    const fetchImpl = okFetch(SPRINKLER_RESPONSE);
    const client = buildStepPartsClient({ enabled: true, fetchImpl });
    await expect(client.searchParts('sprinkler head')).rejects.toThrow(/blocked/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('provenance integration — step.parts is proxy (NOT accurate)', () => {
  it('maps step.parts source to proxy tier', () => {
    expect(deriveModelStatus({ source: 'step.parts' })).toBe('proxy');
  });
});
