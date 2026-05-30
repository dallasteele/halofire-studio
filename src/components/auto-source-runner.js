/**
 * S5 — VPS <-> OpenClaw bridge wiring for the autonomous part-sourcing run.
 *
 * The VPS HaloFire stack reaches OpenClaw (on GX10) through a GOVERNED bridge (an
 * SSH tunnel; OPENCLAW_BRIDGE_URL in the VPS .env, e.g. http://127.0.0.1:15000).
 * This module is the thin, PURE + injectable glue between that bridge and the
 * already-fail-soft sourcers in auto-source.js. It is browser-free and performs NO
 * top-level network call — every transport is injected (fetchImpl), so tests run
 * fully offline.
 *
 * HONESTY / fail-closed (NON-NEGOTIABLE):
 *   - makeBridgeInvoker THROWS on any non-2xx / network error / timeout. It NEVER
 *     resolves a fabricated model on failure. The sourcer layer (auto-source.js)
 *     catches that throw and returns null, so degrade happens honestly there.
 *   - buildAutoSourceStatus FORCES manufacturerExactCount:0 and
 *     parityGateStatus:'blocked' regardless of the runResult handed to it. An
 *     auto-source run can NEVER clear AUTOSPRINK / AHJ / PE / manufacturer parity.
 */

/** Honesty note stamped on every status object. */
const AUTO_SOURCE_STATUS_NOTE =
  'Best-effort autonomous sourcing; OpenClaw-found/created parts are NOT ' +
  'manufacturer-exact and never clear the AUTOSPRINK parity gate.';

/** Trim a trailing slash so we can append a fixed path cleanly. */
function trimTrailingSlash(url) {
  const s = String(url == null ? '' : url);
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Build the OpenClaw tool-invocation function the catalog/gen3d/sam sourcers call.
 *
 * POSTs JSON `{ tool, args }` to `<base>/codex-bridge/invoke` using the injected
 * `fetchImpl` (production passes globalThis.fetch; tests inject a fake). An
 * AbortController enforces the timeout (guarded for fetch impls that ignore the
 * signal). On a non-2xx response OR a network error OR a timeout it THROWS — so the
 * sourcer catches it and returns null (fail-soft happens at the sourcer layer,
 * never fabricated here). On 2xx it parses JSON and returns the payload, unwrapping
 * a `{ result }` envelope when the bridge wraps the body.
 *
 * @param {{ bridgeUrl?:string, fetchImpl?:typeof fetch, timeoutMs?:number }} [opts]
 * @returns {(tool:string, args:object) => Promise<any>}
 */
export function makeBridgeInvoker(opts = {}) {
  const bridgeUrl = opts && opts.bridgeUrl;
  const fetchImpl = opts && opts.fetchImpl;
  const timeoutMs = opts && typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 20000;
  const endpoint = `${trimTrailingSlash(bridgeUrl)}/codex-bridge/invoke`;

  return async function bridgeInvoke(tool, args) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('bridge invoker: no fetch implementation injected');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try { controller.abort(); } catch { /* ignore */ }
        }, timeoutMs)
      : null;

    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, args }),
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Non-2xx -> throw so the sourcer fails soft (returns null). Never fabricate.
    if (!res || !res.ok) {
      const status = res && res.status != null ? res.status : 'unknown';
      throw new Error(`bridge invoke ${tool} failed: HTTP ${status}`);
    }

    const body = await res.json();
    // Unwrap a { result } envelope when the bridge wraps its payload.
    if (body && typeof body === 'object' && 'result' in body) return body.result;
    return body;
  };
}

/**
 * Build a reachability probe for the governed bridge.
 *
 * GETs `<base>/status` and reports reachability + the OpenClaw service status for
 * observability. Fully fail-soft: any error / non-2xx => { reachable:false,
 * openclaw:null } and it NEVER throws. On 200 it parses the JSON and reports
 * reachable:true + openclaw = body.services?.openclaw?.status ?? null.
 *
 * @param {{ bridgeUrl?:string, fetchImpl?:typeof fetch, timeoutMs?:number }} [opts]
 * @returns {() => Promise<{ reachable:boolean, openclaw:(string|null), raw?:object }>}
 */
export function probeBridge(opts = {}) {
  const bridgeUrl = opts && opts.bridgeUrl;
  const fetchImpl = opts && opts.fetchImpl;
  const timeoutMs = opts && typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000;
  const endpoint = `${trimTrailingSlash(bridgeUrl)}/status`;

  return async function probe() {
    if (typeof fetchImpl !== 'function') return { reachable: false, openclaw: null };

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try { controller.abort(); } catch { /* ignore */ }
        }, timeoutMs)
      : null;

    try {
      const res = await fetchImpl(endpoint, {
        method: 'GET',
        signal: controller ? controller.signal : undefined,
      });
      if (!res || !res.ok) return { reachable: false, openclaw: null };
      const raw = await res.json();
      const openclaw =
        raw && raw.services && raw.services.openclaw && raw.services.openclaw.status != null
          ? raw.services.openclaw.status
          : null;
      return { reachable: true, openclaw, raw };
    } catch {
      // bridge down / connection refused / timeout -> not reachable, never throw.
      return { reachable: false, openclaw: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

/**
 * Build the OBSERVABLE auto-source status object.
 *
 * PURE: no filesystem, no reading the system clock. The caller passes
 * startedAtMs / finishedAtMs as plain millisecond numbers; lastRunAt is derived as
 * an ISO-8601 string from finishedAtMs and durationMs = finishedAtMs - startedAtMs.
 *
 * FAIL-CLOSED on honesty: manufacturerExactCount is FORCED to 0 and
 * parityGateStatus is FORCED to 'blocked' REGARDLESS of runResult — an auto-source
 * run can NEVER clear parity.
 *
 * @param {{
 *   runResult: object,
 *   bridge: { bridgeUrl?:string, reachable?:boolean, openclaw?:string|null },
 *   startedAtMs: number,
 *   finishedAtMs: number,
 * }} args
 * @returns {object}
 */
export function buildAutoSourceStatus({ runResult, bridge, startedAtMs, finishedAtMs } = {}) {
  const run = runResult || {};
  const br = bridge || {};
  const report = run.report || {};

  return {
    lastRunAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    bridgeUrl: br.bridgeUrl || null,
    openclawReachable: !!br.reachable,
    openclawStatus: br.openclaw || null,
    invokeAttempted: !!br.reachable,
    report: {
      foundCount: report.foundCount || 0,
      createdCount: report.createdCount || 0,
      generatedCount: report.generatedCount || 0,
      missingCount: report.missingCount || 0,
    },
    functionalCoverage: run.functionalCoverage,
    // FORCED — auto-sourced models are never manufacturer-exact and never clear parity.
    manufacturerExactCount: 0,
    parityGateStatus: 'blocked',
    disclaimer: run.disclaimer,
    note: AUTO_SOURCE_STATUS_NOTE,
  };
}

export { AUTO_SOURCE_STATUS_NOTE };
