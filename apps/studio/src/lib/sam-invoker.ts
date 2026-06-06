// T48 — SAM raster-lane invoker builder for the studio.
//
// segmentFloorPlanViaSam (sam-floorplan.ts) calls a single-arg async invoker(payload).
// This module builds that invoker, wired to the OpenClaw governed bridge — mirroring
// apps/autosprink/src/api/sam-invoker.js (POST {tool, args} to
// bridgeUrl + '/codex-bridge/invoke').
//
// CRITICAL DEFAULT: with NO bridgeUrl this returns undefined (SAM DISABLED), so the
// studio NEVER silently calls a network / SAM service by default. The Building-mode UI
// reads this: when the invoker is undefined it shows that the raster fallback is
// unavailable (vector PDFs still work via the T47 lane) rather than pretending a SAM
// run happened.
//
// HONESTY / fail-closed: the invoker THROWS on non-2xx / network error; the caller
// (segmentFloorPlanViaSam) catches that and returns { skipped:true }. NOTHING here
// fabricates a segmentation. fetchImpl is INJECTABLE so unit tests never touch the
// network.

import type { SamInvoker, SamPayload, SamResult } from './sam-floorplan';

/** OpenClaw bridge tool name the SAM raster-segmentation service is exposed under. */
export const SAM_BRIDGE_TOOL = 'sam_segment_floorplan';

export interface BuildSamInvokerOpts {
  /** OpenClaw bridge base URL. ABSENT => SAM DISABLED (returns undefined). */
  bridgeUrl?: string;
  /** Injected fetch (production passes globalThis.fetch); required when bridgeUrl set. */
  fetchImpl?: typeof fetch;
}

/**
 * Build the single-arg invoker(payload) segmentFloorPlanViaSam calls, wired to the
 * OpenClaw bridge. Returns undefined when no bridgeUrl is configured (the honest
 * default — SAM DISABLED, so the caller passes no invoker and the lane skips
 * fail-soft).
 */
export function buildSamInvoker(opts: BuildSamInvokerOpts = {}): SamInvoker | undefined {
  const bridgeUrl = opts && opts.bridgeUrl;
  if (typeof bridgeUrl !== 'string' || !bridgeUrl.trim()) return undefined;

  const base = bridgeUrl.replace(/\/+$/, '');
  const endpoint = `${base}/codex-bridge/invoke`;
  const fetchImpl =
    typeof opts.fetchImpl === 'function'
      ? opts.fetchImpl
      : typeof fetch === 'function'
        ? fetch.bind(globalThis)
        : undefined;

  return async function samInvoke(payload: SamPayload): Promise<SamResult> {
    if (typeof fetchImpl !== 'function') {
      throw new Error('buildSamInvoker: no fetch implementation available for the SAM bridge');
    }
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: SAM_BRIDGE_TOOL, args: payload }),
    });
    if (!res.ok) {
      throw new Error(`sam bridge HTTP ${res.status}`);
    }
    return (await res.json()) as SamResult;
  };
}
