/**
 * Phase H.4 — catalog store reactivity.
 *
 * Verifies:
 *   - initial setDoc() populates the entries map
 *   - upsertRecord() replaces per-SKU records
 *   - the `isCatalogEnrichedPayload` type-guard rejects malformed frames
 *   - `reenrichSku` marks + clears the in-flight set
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  _internals,
  getEnrichedSnapshot,
  reenrichSku,
  useCatalogStore,
} from '../../../lib/halofire/catalog-store'

describe('catalog store', () => {
  beforeEach(() => {
    useCatalogStore.setState({
      entries: {},
      inFlight: new Set<string>(),
      crudePrefs: {},
      loadError: null,
      updatedAt: null,
      lastSyncedAt: 0,
    })
  })

  test('setDoc populates the entries map', () => {
    useCatalogStore.getState().setDoc({
      entries: {
        a: { sku_id: 'a', status: 'validated' },
        b: { sku_id: 'b', status: 'needs_review' },
      },
      updated_at: '2026-04-22T14:49:51.917222+00:00',
    })
    expect(Object.keys(getEnrichedSnapshot())).toEqual(['a', 'b'])
    expect(useCatalogStore.getState().updatedAt).toContain('2026-04-22')
    expect(useCatalogStore.getState().loadError).toBeNull()
  })

  test('upsertRecord replaces a single SKU without touching others', () => {
    useCatalogStore.getState().setDoc({
      entries: {
        a: { sku_id: 'a', status: 'validated' },
        b: { sku_id: 'b', status: 'needs_review' },
      },
    })
    useCatalogStore
      .getState()
      .upsertRecord({ sku_id: 'a', status: 'rejected' })
    const snap = getEnrichedSnapshot()
    expect(snap.a.status).toBe('rejected')
    expect(snap.b.status).toBe('needs_review')
  })

  test('isCatalogEnrichedPayload rejects malformed frames', () => {
    const guard = _internals.isCatalogEnrichedPayload
    expect(guard(null)).toBe(false)
    expect(guard({})).toBe(false)
    expect(guard({ kind: 'scene_delta' })).toBe(false)
    expect(guard({ kind: 'catalog_enriched', sku_id: 'x' })).toBe(false)
    expect(
      guard({
        kind: 'catalog_enriched',
        sku_id: 'x',
        record: { sku_id: 'x', status: 'validated' },
      }),
    ).toBe(true)
  })

  test('reenrichSku marks in-flight + clears on success', async () => {
    const fetchOrig = globalThis.fetch
    globalThis.fetch = async (url: string | URL | Request) => {
      if (String(url).endsWith('/projects/catalog/enrich')) {
        return new Response(
          JSON.stringify({
            results: [{ sku: 'x', status: 'validated' }],
            summary: { validated: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }
    try {
      await reenrichSku('x')
    } finally {
      globalThis.fetch = fetchOrig
    }
    expect(useCatalogStore.getState().inFlight.has('x')).toBe(false)
  })
})
