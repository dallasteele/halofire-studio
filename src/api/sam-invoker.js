/**
 * T36 — Production SAM-3.1 invoker builder for the SERVER pdf path.
 *
 * T35 built the engine adapter (sam-floorplan.js segmentFloorPlanViaSam, which calls a
 * single-arg async `invoker(payload)`) and floorPlanFromPdf extract:"sam". But the
 * server's makeBridgeInvoker (auto-source-runner.js) returns a TWO-arg `(tool, args)`
 * function. This module adapts the bridge invoker to the single-arg payload shape
 * segmentFloorPlanViaSam expects, and — critically — only constructs an invoker when an
 * OPENCLAW_BRIDGE_URL is actually present. With no bridge wired it returns null, so the
 * engine fails soft (samSkipped) and the server falls back to the vector path.
 *
 * HONESTY / fail-closed: the bridge invoker THROWS on non-2xx / network error / timeout
 * (see makeBridgeInvoker). segmentFloorPlanViaSam catches that throw and returns
 * { skipped:true }. NOTHING here fabricates a segmentation. The OpenClaw/SAM bridge on
 * GX10 is CURRENTLY HTTP_UNREACHABLE, so in practice this invoker (when built) will
 * fail-soft until the bridge is reachable; the real SAM run is DEFERRED.
 *
 * Pure + injectable: fetchImpl is injected (production passes globalThis.fetch); no
 * top-level network call, fully unit-testable offline.
 */

import { makeBridgeInvoker } from '../components/auto-source-runner.js';

/** OpenClaw tool name the GX10 SAM plan-segmentation service is exposed under. */
export const SAM_BRIDGE_TOOL = 'sam_segment_floorplan';

/**
 * Build the single-arg `invoker(payload)` that segmentFloorPlanViaSam calls, wired to
 * the OpenClaw governed bridge. Returns null when no bridge URL is configured (so the
 * caller passes no invoker -> the engine skips SAM fail-soft).
 *
 * @param {{ bridgeUrl?:string, fetchImpl?:typeof fetch, timeoutMs?:number }} [opts]
 * @returns {((payload:object) => Promise<any>) | null}
 */
export function buildSamInvoker(opts = {}) {
  const bridgeUrl = opts && opts.bridgeUrl;
  if (typeof bridgeUrl !== 'string' || !bridgeUrl.trim()) return null;

  const bridgeInvoke = makeBridgeInvoker({
    bridgeUrl,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });

  // Adapt: segmentFloorPlanViaSam calls invoker(payload) with ONE arg; the bridge wants
  // (tool, args). Wrap the SAM payload as the args of the sam_segment_floorplan tool.
  return function samInvoke(payload) {
    return bridgeInvoke(SAM_BRIDGE_TOOL, payload);
  };
}
