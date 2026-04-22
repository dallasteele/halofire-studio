/**
 * Phase H.4 — Catalog enrichment store.
 *
 * Owns the TS-side mirror of `packages/halofire-catalog/enriched.json`.
 *
 *   - initial load via fetch('/halofire-catalog/enriched.json') (same
 *     mount point the catalog.json lives at)
 *   - live updates via the existing gateway SSE bus: the orchestrator
 *     emits a `catalog_enriched` event carrying the full per-SKU record
 *     after each successful run, we upsert into the local map and fan
 *     out a `halofire:catalog-enriched` CustomEvent for components that
 *     don't subscribe via the store
 *
 * This file is the ONLY place on the TS side that knows the shape of
 * `enriched.json` — the CatalogCard / CatalogDetailPanel read via the
 * `useEnriched(sku)` hook so the store can evolve without a sweep.
 */

'use client'

import { create } from 'zustand'
import { useMemo, useSyncExternalStore } from 'react'
import { GATEWAY_URL } from './gateway-client'

// ── Types ───────────────────────────────────────────────────────────

export type EnrichmentStatus =
  | 'validated'
  | 'needs_review'
  | 'rejected'
  | 'fallback'
  | 'not_yet_run'

export interface EnrichedMesh {
  glb_path?: string | null
  version?: number | null
  source?: string | null
  bounds_m?: [[number, number, number], [number, number, number]] | null
  confidence?: number | null
}

export interface EnrichedSourcePhoto {
  path?: string | null
  sha256?: string | null
  width?: number | null
  height?: number | null
}

export interface EnrichedGrounding {
  bbox?: [number, number, number, number] | null
  confidence?: number | null
  reasoning?: string | null
  source?: string | null
}

export interface EnrichedMask {
  iou?: number | null
  area_px?: number | null
  bbox?: [number, number, number, number] | null
  aspect?: number | null
}

export interface EnrichedProvenanceEntry {
  agent: string
  timestamp?: string
  ok: boolean
  confidence?: number
  reason?: string | null
  output_keys?: string[]
  duration_ms?: number
}

export interface EnrichedRecord {
  sku_id: string
  status: EnrichmentStatus
  enriched_at?: string
  mesh?: EnrichedMesh | null
  source_photo?: EnrichedSourcePhoto | null
  grounding?: EnrichedGrounding | null
  mask?: EnrichedMask | null
  provenance?: EnrichedProvenanceEntry[]
  failure?: { step?: string; reason?: string } | null
  escalation?: Record<string, unknown> | null
}

interface EnrichedDoc {
  schema_version?: number
  updated_at?: string
  entries: Record<string, EnrichedRecord>
}

// ── Store ───────────────────────────────────────────────────────────

interface CatalogStoreState {
  /** Map of sku → record. Missing entries mean `not_yet_run`. */
  entries: Record<string, EnrichedRecord>
  /** Last time we received a fresh document, ms since epoch. */
  lastSyncedAt: number
  /** Latest mtime/updated_at from the on-disk doc, if known. */
  updatedAt: string | null
  /** Non-fatal load error surfaced to the UI. */
  loadError: string | null
  /** SKUs currently being re-enriched (UI can show spinners). */
  inFlight: Set<string>
  /** Per-SKU local preference: force the crude SCAD fallback over the
   *  enriched mesh. Persisted to localStorage, keyed by sku. */
  crudePrefs: Record<string, boolean>

  setDoc(doc: EnrichedDoc): void
  upsertRecord(record: EnrichedRecord): void
  setLoadError(err: string | null): void
  markInFlight(sku: string, on: boolean): void
  setCrudePref(sku: string, crude: boolean): void
}

const CRUDE_PREF_KEY = 'halofire:catalog:crude-prefs'

function loadCrudePrefs(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CRUDE_PREF_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v
      }
      return out
    }
  } catch {
    /* ignore malformed */
  }
  return {}
}

function persistCrudePrefs(prefs: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CRUDE_PREF_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / privacy */
  }
}

export const useCatalogStore = create<CatalogStoreState>((set, get) => ({
  entries: {},
  lastSyncedAt: 0,
  updatedAt: null,
  loadError: null,
  inFlight: new Set<string>(),
  crudePrefs: loadCrudePrefs(),

  setDoc(doc) {
    const entries = doc.entries ?? {}
    set({
      entries: { ...entries },
      updatedAt: doc.updated_at ?? null,
      lastSyncedAt: Date.now(),
      loadError: null,
    })
  },

  upsertRecord(record) {
    if (!record || !record.sku_id) return
    set((s) => ({
      entries: { ...s.entries, [record.sku_id]: record },
      lastSyncedAt: Date.now(),
    }))
  },

  setLoadError(err) {
    set({ loadError: err })
  },

  markInFlight(sku, on) {
    set((s) => {
      const next = new Set(s.inFlight)
      if (on) next.add(sku)
      else next.delete(sku)
      return { inFlight: next }
    })
  },

  setCrudePref(sku, crude) {
    const prefs = { ...get().crudePrefs, [sku]: crude }
    if (!crude) delete prefs[sku]
    persistCrudePrefs(prefs)
    set({ crudePrefs: prefs })
  },
}))

// ── Hooks ───────────────────────────────────────────────────────────

/**
 * Subscribe to a single SKU's enrichment record. Returns `null` when
 * no record exists yet (which the UI should surface as `not_yet_run`).
 */
export function useEnriched(sku: string | null | undefined): EnrichedRecord | null {
  const entries = useCatalogStore((s) => s.entries)
  return useMemo(() => {
    if (!sku) return null
    return entries[sku] ?? null
  }, [entries, sku])
}

/**
 * Derive the effective status for a SKU, accounting for the
 * `force-crude` local preference.
 */
export function useEffectiveStatus(sku: string | null | undefined): EnrichmentStatus {
  const rec = useEnriched(sku)
  const crude = useCatalogStore((s) => (sku ? !!s.crudePrefs[sku] : false))
  if (!sku) return 'not_yet_run'
  if (crude) return 'fallback'
  if (!rec) return 'not_yet_run'
  return rec.status
}

/** Whether the orchestrator is currently running for this SKU. */
export function useInFlight(sku: string | null | undefined): boolean {
  // Subscribe to the Set reference; Zustand re-renders when set() replaces it.
  return useCatalogStore(
    (s) => (sku ? s.inFlight.has(sku) : false),
  )
}

// ── Initial fetch ───────────────────────────────────────────────────

let _loadStarted = false

/**
 * Trigger a one-shot load of `/halofire-catalog/enriched.json`. Safe to
 * call from multiple consumers; the first call wins.
 *
 * If the file isn't present (first deploy, Node SSR, etc.) we set an
 * empty doc and surface a non-fatal load error for debugging.
 */
export function ensureEnrichedLoaded(): void {
  if (_loadStarted) return
  if (typeof window === 'undefined') return
  _loadStarted = true
  const url = '/halofire-catalog/enriched.json'
  fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) {
        useCatalogStore.getState().setDoc({ entries: {} })
        useCatalogStore
          .getState()
          .setLoadError(`enriched.json ${res.status}`)
        return
      }
      const doc = (await res.json()) as EnrichedDoc
      useCatalogStore.getState().setDoc({
        schema_version: doc.schema_version,
        updated_at: doc.updated_at,
        entries: doc.entries ?? {},
      })
    })
    .catch((err) => {
      useCatalogStore.getState().setDoc({ entries: {} })
      useCatalogStore
        .getState()
        .setLoadError(String(err?.message ?? err))
    })
}

// ── SSE reactivity ──────────────────────────────────────────────────
//
// The gateway's project SSE bus (`/projects/<id>/events`) carries the
// `catalog_enriched` event under a project id. Rather than tie catalog
// enrichment to a specific project, we also broadcast on a reserved
// project id `_catalog` so any open studio tab receives updates. The
// orchestrator emits to that topic (see `catalog_enrichment.py`).

const CATALOG_TOPIC = '_catalog'
let _catalogEventSource: EventSource | null = null

interface CatalogEnrichedPayload {
  kind: 'catalog_enriched'
  sku_id: string
  record: EnrichedRecord
}

function isCatalogEnrichedPayload(x: unknown): x is CatalogEnrichedPayload {
  if (!x || typeof x !== 'object') return false
  const v = x as Record<string, unknown>
  return (
    v.kind === 'catalog_enriched' &&
    typeof v.sku_id === 'string' &&
    !!v.record &&
    typeof v.record === 'object'
  )
}

/**
 * Open a dedicated EventSource on the `_catalog` project topic so the
 * store receives enrichment updates live from the orchestrator. Returns
 * a disposer for the caller's effect.
 */
export function connectCatalogSSE(): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }
  if (_catalogEventSource) {
    return () => {}
  }
  const url = `${GATEWAY_URL}/projects/${CATALOG_TOPIC}/events`
  const es = new EventSource(url)
  _catalogEventSource = es

  const handle = (raw: string) => {
    try {
      const payload: unknown = JSON.parse(raw)
      if (!isCatalogEnrichedPayload(payload)) return
      const store = useCatalogStore.getState()
      store.upsertRecord(payload.record)
      store.markInFlight(payload.sku_id, false)
      window.dispatchEvent(
        new CustomEvent('halofire:catalog-enriched', {
          detail: { sku: payload.sku_id, record: payload.record },
        }),
      )
    } catch {
      /* malformed frame */
    }
  }

  es.onmessage = (e) => handle(e.data)
  es.addEventListener('catalog_enriched', (e) => {
    handle((e as MessageEvent).data)
  })

  return () => {
    try {
      es.close()
    } catch {
      /* */
    }
    if (_catalogEventSource === es) _catalogEventSource = null
  }
}

// ── Re-run trigger ──────────────────────────────────────────────────

export interface EnrichRunSummary {
  results: Array<{ sku: string; status: string; failed_at?: string }>
  summary: Record<string, number>
}

/**
 * Kick the orchestrator for a single SKU via `POST /projects/catalog/enrich`.
 * The UI can poll the in-flight flag; when SSE delivers the completion
 * event we upsert + clear the flag automatically.
 */
export async function reenrichSku(sku: string): Promise<EnrichRunSummary> {
  const store = useCatalogStore.getState()
  store.markInFlight(sku, true)
  try {
    const res = await fetch(`${GATEWAY_URL}/projects/catalog/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, mode: 'sku', parallel: 1 }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`enrich HTTP ${res.status}: ${body.slice(0, 240)}`)
    }
    const summary = (await res.json()) as EnrichRunSummary
    // Even if SSE is unavailable, re-fetch the doc so the UI converges.
    await refetchEnriched()
    return summary
  } finally {
    store.markInFlight(sku, false)
  }
}

/** Manual refetch — used after a re-run or from a UI refresh button. */
export async function refetchEnriched(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const res = await fetch('/halofire-catalog/enriched.json', {
      cache: 'no-store',
    })
    if (!res.ok) return
    const doc = (await res.json()) as EnrichedDoc
    useCatalogStore.getState().setDoc({
      schema_version: doc.schema_version,
      updated_at: doc.updated_at,
      entries: doc.entries ?? {},
    })
  } catch {
    /* transient */
  }
}

// ── useSyncExternalStore-style external subscription ────────────────
//
// Exposed for tests / imperative consumers that don't want a full
// Zustand subscribe. Not used by the two React components in the
// lane, but documented so future panels don't reinvent it.

export function subscribeEntries(cb: () => void): () => void {
  return useCatalogStore.subscribe(cb)
}

export function getEnrichedSnapshot(): Record<string, EnrichedRecord> {
  return useCatalogStore.getState().entries
}

/**
 * Hook wrapper around `useSyncExternalStore` for non-Zustand consumers.
 * Returned reference is stable across renders when the underlying map
 * doesn't change.
 */
export function useEnrichedSnapshot(): Record<string, EnrichedRecord> {
  return useSyncExternalStore(
    subscribeEntries,
    getEnrichedSnapshot,
    getEnrichedSnapshot,
  )
}

// ── Internal for tests ──────────────────────────────────────────────

export const _internals = {
  CATALOG_TOPIC,
  CRUDE_PREF_KEY,
  resetLoadFlag() {
    _loadStarted = false
  },
  closeEventSource() {
    if (_catalogEventSource) {
      try {
        _catalogEventSource.close()
      } catch {
        /* */
      }
      _catalogEventSource = null
    }
  },
  isCatalogEnrichedPayload,
}
