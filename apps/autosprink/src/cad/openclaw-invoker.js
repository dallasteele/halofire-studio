/**
 * Production OpenClaw bridge invoker — the REAL wiring for openclaw-cad.js.
 *
 * The GX10 HAL API exposes a codex bridge at POST {base}/codex-bridge/invoke that
 * accepts { kind: 'openclaw_tool', tool, args } and proxies to OpenClaw's CAD
 * tools (generate_3d_model, generate_dxf, generate_pdf_report, memory_search).
 *
 * Config (env, in priority order):
 *   OPENCLAW_CAD_BRIDGE_URL   — explicit bridge base, e.g. http://192.168.1.76:9000
 *   HAL_API_URL               — general HAL API base (same service)
 *   OPENCLAW_CAD_BRIDGE_TOKEN — optional bearer token for the bridge
 *
 * Fail-soft contract: buildBridgeInvoker returns NULL when no base url is set —
 * invokeOpenClawCad then returns its honest { ok:false, skipped:true } shape, so
 * HaloFire works with or without the GX10 gateway. Network/HTTP errors THROW from
 * the invoker; invokeOpenClawCad catches and degrades. No fabricated results.
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/** Resolve the bridge base url from env (null when unconfigured). */
export function resolveBridgeBase(env = process.env) {
  const base = String(env.OPENCLAW_CAD_BRIDGE_URL || env.HAL_API_URL || '').trim();
  return base ? base.replace(/\/+$/, '') : null;
}

/**
 * Build the production invoker for invokeOpenClawCad, or null when the bridge
 * is not configured. The returned function POSTs one tool call and returns the
 * bridge's parsed JSON result (throws on HTTP/network failure).
 *
 * @param {object} [env] - process.env (injectable for tests)
 * @param {function} [fetchImpl] - fetch (injectable for tests)
 * @returns {null | ((toolName: string, payload: object) => Promise<any>)}
 */
export function buildBridgeInvoker(env = process.env, fetchImpl = fetch) {
  const base = resolveBridgeBase(env);
  if (!base) return null;
  const token = String(env.OPENCLAW_CAD_BRIDGE_TOKEN || env.HAL_API_TOKEN || '').trim();
  const timeoutMs = Number(env.OPENCLAW_CAD_BRIDGE_TIMEOUT_MS) > 0
    ? Number(env.OPENCLAW_CAD_BRIDGE_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  return async function bridgeInvoker(toolName, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/codex-bridge/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kind: 'openclaw_tool', tool: toolName, args: payload }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenClaw bridge HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
}
