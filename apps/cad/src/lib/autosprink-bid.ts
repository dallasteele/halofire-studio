// HaloFire CAD — best-effort "Send to HaloFire bid" autosprink integration (W6).
// PURE-ish: a single fetch with NO DOM dependency beyond an injectable fetch +
// token reader, so it is fully unit-testable. NEVER blocks the in-app bid.
//
// The autosprink backend (apps/autosprink/src/api/server.js) exposes
// POST /api/bids behind Bearer-token auth (the `halofire_token` the autosprink
// login stores in localStorage). This helper POSTs the CAD design-aid bid there as
// a Pending bid line, fail-soft: when the backend is unreachable, no token is
// present, or auth is rejected, it returns an honest status WITHOUT throwing — the
// caller keeps the in-app bid regardless.
//
// HONESTY: the value sent is the design-aid ESTIMATE total, and the bid is created
// with status 'Pending' (never auto-approved). The status this returns is honest:
//   'wired'        — backend accepted the bid (real 2xx response, id returned)
//   'unauthorized' — no token, or the backend rejected the token (401/403)
//   'not-reachable'— network error / no backend / non-auth non-2xx
//   'skipped'      — caller asked to send but there is nothing to send (no total)
// "best-effort" in the UI = any non-'wired' outcome that did not throw.

export const AUTOSPRINK_BID_ENDPOINT = 'http://localhost:3210/api/bids';

/** Where the integration ended up — surfaced verbatim in the UI. */
export type AutosprinkSendStatus = 'wired' | 'unauthorized' | 'not-reachable' | 'skipped';

/** The result of a best-effort send (never throws). */
export interface AutosprinkSendResult {
  status: AutosprinkSendStatus;
  /** A short honest message for the UI. */
  message: string;
  /** The created bid id, when the backend returned one. */
  bidId?: number | string;
  /** The HTTP status code observed, when a response came back. */
  httpStatus?: number;
}

/** The minimal bid payload the autosprink POST /api/bids accepts. */
export interface AutosprinkBidPayload {
  project: string;
  contractor: string;
  /** The design-aid estimate total (USD). */
  value: number;
  status: 'Pending';
  sqft: number;
  system_type: string;
  notes: string;
}

/** Options for sendBidToAutosprink (all injectable for tests). */
export interface SendBidOptions {
  /** The bottom-line estimate total (USD). Required; <= 0 -> 'skipped'. */
  total: number;
  /** Project label (e.g. the CAD project name). */
  project?: string;
  /** Contractor label. Defaults to 'HaloFire CAD'. */
  contractor?: string;
  /** Building area (ft²) for the bid record. Optional. */
  sqft?: number;
  /** System type (Wet / Dry / ...). Defaults to 'Wet'. */
  systemType?: string;
  /** Honest note attached to the bid (design-aid disclaimer). */
  notes?: string;
  /** Bearer token. When omitted, tokenReader() is used; absent -> 'unauthorized'. */
  token?: string | null;
  /** Reads the stored halofire_token (defaults to localStorage). */
  tokenReader?: () => string | null;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Override the endpoint (defaults to AUTOSPRINK_BID_ENDPOINT). */
  endpoint?: string;
}

const DEFAULT_NOTE =
  'Design-aid ESTIMATE from HaloFire CAD (W6 takeoff -> priced bid). NOT a ' +
  'committed quote / AHJ / PE / final bid. Created as Pending for review.';

/** Read the stored halofire_token from localStorage (browser), or null. */
export function readHalofireToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('halofire_token') ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort POST the design-aid bid to the autosprink backend. NEVER throws;
 * returns an honest status. Does NOT block — the caller keeps its in-app bid no
 * matter what this returns.
 */
export async function sendBidToAutosprink(
  opts: SendBidOptions,
): Promise<AutosprinkSendResult> {
  const total = Number(opts.total);
  if (!Number.isFinite(total) || total <= 0) {
    return { status: 'skipped', message: 'No estimate total to send.' };
  }

  const token = opts.token ?? (opts.tokenReader ?? readHalofireToken)();
  if (!token) {
    return {
      status: 'unauthorized',
      message: 'No HaloFire token found — sign in to the HaloFire portal first. In-app bid kept.',
    };
  }

  const fetchImpl =
    opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (!fetchImpl) {
    return { status: 'not-reachable', message: 'No fetch available in this environment. In-app bid kept.' };
  }

  const payload: AutosprinkBidPayload = {
    project: opts.project?.trim() || 'HaloFire CAD estimate',
    contractor: opts.contractor?.trim() || 'HaloFire CAD',
    value: Math.round(total * 100) / 100,
    status: 'Pending',
    sqft: Number.isFinite(opts.sqft) ? Math.round((opts.sqft as number) * 100) / 100 : 0,
    system_type: opts.systemType?.trim() || 'Wet',
    notes: opts.notes?.trim() || DEFAULT_NOTE,
  };

  const endpoint = opts.endpoint ?? AUTOSPRINK_BID_ENDPOINT;

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      status: 'not-reachable',
      message: 'HaloFire backend not reachable (offline or not running). In-app bid kept.',
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      status: 'unauthorized',
      message: 'HaloFire rejected the token (expired or invalid). In-app bid kept.',
      httpStatus: res.status,
    };
  }
  if (!res.ok) {
    return {
      status: 'not-reachable',
      message: `HaloFire backend returned ${res.status}. In-app bid kept.`,
      httpStatus: res.status,
    };
  }

  // Honest success: try to surface the created bid id, but a 2xx alone is enough.
  let bidId: number | string | undefined;
  try {
    const json = (await res.json()) as { id?: number | string } | null;
    if (json && (typeof json.id === 'number' || typeof json.id === 'string')) bidId = json.id;
  } catch {
    /* a 2xx with no/invalid body is still a successful send */
  }

  return {
    status: 'wired',
    message: bidId !== undefined
      ? `Sent to HaloFire bids (Pending, id ${bidId}).`
      : 'Sent to HaloFire bids (Pending).',
    httpStatus: res.status,
    ...(bidId !== undefined ? { bidId } : {}),
  };
}
