// AI image->3D placeholder invoker for the studio — mirrors sam-invoker.ts.
//
// Builds a single-arg async invoker(payload) that calls the OpenClaw governed
// bridge tool `generate_3d_model` (POST {tool, args} to bridgeUrl +
// '/codex-bridge/invoke') to turn a part image + prompt into a LOW-FIDELITY
// AI mesh, returned as a visual_reference ai-placeholder asset.
//
// CRITICAL DEFAULT — DISABLED: with NO injected invoker (and no bridgeUrl) this
// builder returns undefined. The studio NEVER silently calls a network / AI 3D
// service. With the invoker disabled, generateAiPlaceholder generates NOTHING
// and returns null, and the shipped /parts/ai-placeholder.json is EMPTY.
//
// HONESTY / fail-closed (HARD):
//   - This NEVER fabricates geometry. A successful call yields at most a
//     visual_reference asset with engineeringAccurate=false — it can never be
//     upgraded to a higher provenance tier here.
//   - The invoker THROWS on non-2xx / network error; generateAiPlaceholder
//     catches that and returns null (fail-soft, nothing fabricated).
//   - fetchImpl is INJECTABLE so unit tests never touch the network.
//
// LIVE BACKEND STATUS (2026-06-05): the image->3D backend is DOWN. OpenClaw
// `generate_3d_model` via the HAL governed bridge errors server-side immediately
// ("[Errno 21] Is a directory: .") and the gateway :19002 is unreachable. So no
// real AI meshes can be produced this run: aiPlaceholderCount MUST be 0
// (fail-closed). This module is the wired-but-disabled path for when the backend
// returns; it generates nothing today.

import type { AiPlaceholderEntry } from './catalog-geometry';

/** OpenClaw bridge tool name the image->3D service is exposed under. */
export const AI_3D_BRIDGE_TOOL = 'generate_3d_model';

/** Payload sent to the generate_3d_model bridge tool for one part. */
export interface Ai3dPayload {
  /** Catalog SKU id this generation is for. */
  skuId: string;
  /** Reference image URL / data URI for the part. */
  imageUrl: string;
  /** Text prompt describing the part (model, category, size). */
  prompt: string;
}

/** Raw result shape the bridge returns for a generate_3d_model call. */
export interface Ai3dResult {
  /** URL to the generated mesh asset, when the backend produced one. */
  assetUrl?: string;
  /** Optional source/citation. */
  sourceUrl?: string;
}

/** Single-arg invoker that calls the bridge and returns the raw result. */
export type Ai3dInvoker = (payload: Ai3dPayload) => Promise<Ai3dResult>;

export interface BuildAi3dInvokerOpts {
  /** OpenClaw bridge base URL. ABSENT => AI 3D DISABLED (returns undefined). */
  bridgeUrl?: string;
  /** Injected fetch (production passes globalThis.fetch); required when bridgeUrl set. */
  fetchImpl?: typeof fetch;
}

/**
 * Build the single-arg invoker(payload) generateAiPlaceholder calls, wired to
 * the OpenClaw bridge. Returns undefined when no bridgeUrl is configured (the
 * honest default — AI 3D DISABLED, so callers pass no invoker and generation is
 * skipped fail-closed). THROWS-on-error so the caller can fail-soft to null.
 */
export function buildAi3dInvoker(
  opts: BuildAi3dInvokerOpts = {},
): Ai3dInvoker | undefined {
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

  return async function ai3dInvoke(payload: Ai3dPayload): Promise<Ai3dResult> {
    if (typeof fetchImpl !== 'function') {
      throw new Error('buildAi3dInvoker: no fetch implementation available for the AI 3D bridge');
    }
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: AI_3D_BRIDGE_TOOL, args: payload }),
    });
    if (!res.ok) {
      throw new Error(`ai-3d bridge HTTP ${res.status}`);
    }
    return (await res.json()) as Ai3dResult;
  };
}

/**
 * Generate ONE ai-placeholder asset for a part, capped at visual_reference.
 *
 * DISABLED BY DEFAULT: when `invoker` is undefined (no bridge configured), this
 * returns null and generates NOTHING — the honest, fail-closed default.
 *
 * When an invoker IS injected, it is called; a result with a non-empty assetUrl
 * yields an AiPlaceholderEntry (visual_reference only). ANY thrown error, or a
 * result with no usable assetUrl, returns null (fail-soft — nothing fabricated).
 * This NEVER returns anything above visual_reference; the tier is fixed by the
 * resolver to visual_reference / engineeringAccurate=false.
 */
export async function generateAiPlaceholder(
  payload: Ai3dPayload,
  invoker?: Ai3dInvoker,
): Promise<AiPlaceholderEntry | null> {
  if (typeof invoker !== 'function') {
    // DISABLED: no invoker -> generate nothing (honest, fail-closed default).
    return null;
  }
  try {
    const result = await invoker(payload);
    const url = result?.assetUrl;
    if (typeof url !== 'string' || url.trim().length === 0) {
      // Backend returned no usable asset -> nothing fabricated.
      return null;
    }
    const entry: AiPlaceholderEntry = {
      skuId: payload.skuId,
      assetUrl: url.trim(),
    };
    if (typeof result.sourceUrl === 'string' && result.sourceUrl.trim().length > 0) {
      entry.sourceUrl = result.sourceUrl.trim();
    }
    return entry;
  } catch {
    // Network / non-2xx / bridge error (e.g. the current [Errno 21] backend
    // failure) -> fail-soft to null. NEVER fabricate geometry.
    return null;
  }
}
