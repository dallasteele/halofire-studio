// PURE manufacturer-connector registry logic — no React / three / network.
//
// Typed loader + validator for the per-manufacturer CONNECTOR REGISTRY described
// in docs/research/manufacturer-integration-matrix.md (§2.1). Mirrors the
// fail-soft / typed conventions of manufacturer-step.ts + manufacturer-catalog.ts.
//
// HONESTY (hard, fail-closed):
//   - The registry stores ONLY the NAME of a credential (apiKeyRef) — NEVER a
//     literal key/secret. A value that LOOKS like a secret is rejected at parse
//     time (treated as a config error -> apiKeyRef collapses to null) so a leaked
//     key can never ride into the studio through the registry.
//   - status is truthful per the research: "enabled" ONLY for genuinely
//     zero-credential ungated sources; gated sources are "needs_config" naming the
//     specific key/login in apiKeyRef; non-automatable sources are "manual".
//   - Saving a connector config in the UI does NOT perform a live integration —
//     the registry is a config + status ledger only (see the settings panel).
//   - The loader fail-softs to an EMPTY registry on any error. Malformed connector
//     rows are DROPPED (never patched / fabricated).

/** Source kind a connector pulls from (matrix §2.1). */
export type ConnectorSourceType =
  | 'rest_api' // documented REST API (only TraceParts today)
  | 'cadenas' // CADENAS PARTcommunity / 3Dfindit native catalog
  | 'direct_download' // ungated/soft-gated manufacturer ZIP/file tree
  | 'bim_aggregator' // ARCAT / BIMobject / MEPcontent etc. (scrape, often login)
  | 'manual_import' // no automatable source; operator drops files (T54 lane)
  | 'unknown'; // not yet researched (the 7 user-added vendors)

/** Operator-facing connector status (matrix §2.1). */
export type ConnectorStatus =
  | 'enabled' // automatable now; no missing config
  | 'needs_config' // automatable BUT requires an operator-supplied key/login/link
  | 'manual' // not automatable; operator uses the T54 import lane
  | 'disabled'; // operator turned it off

/** Which provenance lane this connector feeds. */
export type ConnectorIngestLane =
  | 'manufacturer_step'
  | 'catalog_spec'
  | 'both';

export const CONNECTOR_SOURCE_TYPES: readonly ConnectorSourceType[] = [
  'rest_api',
  'cadenas',
  'direct_download',
  'bim_aggregator',
  'manual_import',
  'unknown',
] as const;

export const CONNECTOR_STATUSES: readonly ConnectorStatus[] = [
  'enabled',
  'needs_config',
  'manual',
  'disabled',
] as const;

export const CONNECTOR_INGEST_LANES: readonly ConnectorIngestLane[] = [
  'manufacturer_step',
  'catalog_spec',
  'both',
] as const;

export interface ManufacturerConnector {
  /** Stable slug, e.g. "victaulic", "viking", "potter-electric". */
  id: string;
  /** Display name. */
  name: string;
  status: ConnectorStatus;
  sourceType: ConnectorSourceType;
  /** Primary catalog/resource URL the connector polls or walks. null if none. */
  catalogUrl: string | null;
  /**
   * Reference to a credential in env/secret config — NEVER a literal key.
   * e.g. "TRACEPARTS_API_KEY". null when the source is ungated. The sync agent
   * resolves this at runtime via process.env; the registry only holds the NAME.
   */
  apiKeyRef: string | null;
  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSynced: string | null;
  /** Count of parts this connector has contributed (geometry + spec). */
  partCount: number;
  /** Honest operator-facing note: what this connector does and its limits. */
  notes: string;
  /** Which provenance lane this connector feeds. */
  ingestLane: ConnectorIngestLane;
  /** Optional second-tier enrichment key NAME (e.g. Victaulic Tier-2 TraceParts). */
  secondaryApiKeyRef: string | null;
}

export interface ConnectorRegistry {
  generatedAt: string | null;
  connectors: ManufacturerConnector[];
}

const EMPTY: ConnectorRegistry = { generatedAt: null, connectors: [] };

/**
 * Heuristic "this string looks like a real secret value, not an env-var NAME".
 *
 * apiKeyRef MUST be an env/config NAME (SCREAMING_SNAKE_CASE letters/digits/_),
 * e.g. "TRACEPARTS_API_KEY". Anything that looks like an actual provider key
 * (sk-..., long base64/hex blobs, JWTs, values with non-name characters) is
 * rejected so a leaked secret can never enter the studio via the registry.
 *
 * Returns true when `v` is a SAFE env-var name reference. Pure.
 */
export function isSafeApiKeyRef(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length === 0) return false;
  // Reject obvious provider-key shapes outright.
  if (/^sk-/i.test(s)) return false; // OpenAI/Anthropic-style live keys
  if (s.includes('.') && s.split('.').length >= 3) return false; // JWT-ish
  // An env-var NAME: letters, digits, underscores only; must contain a letter;
  // bounded length so a long opaque token cannot masquerade as a name.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (s.length > 64) return false;
  // A long opaque token (32+ chars, contains a digit, NO underscore separators)
  // is a key, not an env-var NAME — reject it. Real names like TRACEPARTS_API_KEY
  // carry underscores and stay short, so they pass.
  if (s.length >= 32 && /[0-9]/.test(s) && !s.includes('_')) return false;
  return true;
}

function asSourceType(v: unknown): ConnectorSourceType {
  return CONNECTOR_SOURCE_TYPES.includes(v as ConnectorSourceType)
    ? (v as ConnectorSourceType)
    : 'unknown';
}

function asStatus(v: unknown): ConnectorStatus | null {
  return CONNECTOR_STATUSES.includes(v as ConnectorStatus)
    ? (v as ConnectorStatus)
    : null;
}

function asIngestLane(v: unknown): ConnectorIngestLane {
  return CONNECTOR_INGEST_LANES.includes(v as ConnectorIngestLane)
    ? (v as ConnectorIngestLane)
    : 'catalog_spec';
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Parse one raw object into a ManufacturerConnector, or null if it is malformed.
 * HARD requirement: a real id, name, and a recognized status. apiKeyRef /
 * secondaryApiKeyRef are sanitized through isSafeApiKeyRef — a value that looks
 * like a secret is dropped to null rather than carried into the studio.
 */
export function parseConnector(raw: unknown): ManufacturerConnector | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const id = asNonEmptyString(o.id);
  const name = asNonEmptyString(o.name);
  const status = asStatus(o.status);
  if (id === null || name === null || status === null) return null;

  const apiKeyRef = isSafeApiKeyRef(o.apiKeyRef) ? o.apiKeyRef.trim() : null;
  const secondaryApiKeyRef = isSafeApiKeyRef(o.secondaryApiKeyRef)
    ? (o.secondaryApiKeyRef as string).trim()
    : null;

  const partCount =
    typeof o.partCount === 'number' && Number.isFinite(o.partCount) && o.partCount >= 0
      ? Math.floor(o.partCount)
      : 0;

  return {
    id,
    name,
    status,
    sourceType: asSourceType(o.sourceType),
    catalogUrl: asNonEmptyString(o.catalogUrl),
    apiKeyRef,
    lastSynced: asNonEmptyString(o.lastSynced),
    partCount,
    notes: typeof o.notes === 'string' ? o.notes : '',
    ingestLane: asIngestLane(o.ingestLane),
    secondaryApiKeyRef,
  };
}

/**
 * Parse a raw JSON object into a typed ConnectorRegistry. Unknown / malformed
 * shapes yield an empty registry; individual malformed connector rows are dropped.
 * Deterministic: preserves connector order.
 */
export function parseConnectorRegistry(json: unknown): ConnectorRegistry {
  if (!json || typeof json !== 'object') return { ...EMPTY };
  const o = json as Record<string, unknown>;
  const rawConnectors = Array.isArray(o.connectors) ? o.connectors : [];
  const connectors: ManufacturerConnector[] = [];
  for (const r of rawConnectors) {
    const c = parseConnector(r);
    if (c) connectors.push(c);
  }
  return {
    generatedAt: asNonEmptyString(o.generatedAt),
    connectors,
  };
}

/** Count of connectors in the registry. */
export function connectorCount(reg: ConnectorRegistry | null | undefined): number {
  return reg?.connectors.length ?? 0;
}

/** Count of connectors whose status is "enabled". */
export function connectorsEnabledCount(
  reg: ConnectorRegistry | null | undefined,
): number {
  if (!reg) return 0;
  return reg.connectors.filter((c) => c.status === 'enabled').length;
}

/**
 * Fail-soft loader. With NO fetch implementation, or a fetch that fails /
 * returns non-2xx / yields invalid JSON, this returns an EMPTY registry. The
 * honest default — the studio never claims connectors it could not load.
 */
export async function loadConnectorRegistry(
  fetchImpl?: typeof fetch,
): Promise<ConnectorRegistry> {
  if (typeof fetchImpl !== 'function') return { ...EMPTY };
  try {
    const res = await fetchImpl('/connectors/manufacturer-connectors.json');
    if (!res || !res.ok) return { ...EMPTY };
    const json = (await res.json()) as unknown;
    return parseConnectorRegistry(json);
  } catch {
    return { ...EMPTY };
  }
}
