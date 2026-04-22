/**
 * Phase H.4 — CatalogDetailPanel actions.
 *
 * Exercises the detail slide-over's wire-up without mounting the
 * component (Bun's SSR doesn't reliably resolve React 19's dispatcher
 * when the render tree contains a zustand v5 selector — which is this
 * panel's entire raison d'être). The presentation layer is covered by
 * the Playwright suite in Phase G; here we pin the behavior that
 * matters when a human clicks the CTAs.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  reenrichSku,
  useCatalogStore,
} from '../../../lib/halofire/catalog-store'

const ORIG_FETCH = globalThis.fetch
const ORIG_STORAGE = globalThis.localStorage

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(k) {
      return map.has(k) ? (map.get(k) as string) : null
    },
    setItem(k, v) {
      map.set(k, String(v))
    },
    removeItem(k) {
      map.delete(k)
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null
    },
  }
}

describe('CatalogDetailPanel actions', () => {
  beforeEach(() => {
    useCatalogStore.setState({
      entries: {},
      inFlight: new Set<string>(),
      crudePrefs: {},
      loadError: null,
      updatedAt: null,
      lastSyncedAt: 0,
    })
    // biome-ignore lint/suspicious/noExplicitAny: test globals
    ;(globalThis as any).localStorage = memoryStorage()
  })
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
    // biome-ignore lint/suspicious/noExplicitAny: test globals
    ;(globalThis as any).localStorage = ORIG_STORAGE
  })

  test('reenrichSku POSTs the sku to /projects/catalog/enrich', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    globalThis.fetch = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), init })
      const u = String(url)
      if (u.endsWith('/projects/catalog/enrich')) {
        return new Response(
          JSON.stringify({
            results: [{ sku: 'demo_valve_1', status: 'needs_review' }],
            summary: { needs_review: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }

    const out = await reenrichSku('demo_valve_1')
    expect(out.results[0].sku).toBe('demo_valve_1')

    const enrichCall = calls.find((c) =>
      c.url.endsWith('/projects/catalog/enrich'),
    )
    expect(enrichCall).toBeDefined()
    expect(enrichCall?.init?.method).toBe('POST')
    const body = JSON.parse(String(enrichCall?.init?.body ?? '{}'))
    expect(body.sku).toBe('demo_valve_1')
    expect(body.mode).toBe('sku')
    expect(body.parallel).toBe(1)
  })

  test('reenrichSku clears the in-flight flag even on failure', async () => {
    globalThis.fetch = async () => new Response('boom', { status: 500 })
    let threw = false
    try {
      await reenrichSku('demo_valve_1')
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(useCatalogStore.getState().inFlight.has('demo_valve_1')).toBe(false)
  })

  test('setCrudePref persists to localStorage', () => {
    useCatalogStore.getState().setCrudePref('demo_valve_1', true)
    expect(useCatalogStore.getState().crudePrefs['demo_valve_1']).toBe(true)
    const raw = globalThis.localStorage.getItem(
      'halofire:catalog:crude-prefs',
    )
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    expect(parsed['demo_valve_1']).toBe(true)
  })

  test('setCrudePref(false) clears the key from localStorage', () => {
    useCatalogStore.getState().setCrudePref('demo_valve_1', true)
    useCatalogStore.getState().setCrudePref('demo_valve_1', false)
    expect(useCatalogStore.getState().crudePrefs['demo_valve_1']).toBeUndefined()
    const raw = globalThis.localStorage.getItem(
      'halofire:catalog:crude-prefs',
    )
    const parsed = JSON.parse(raw as string)
    expect('demo_valve_1' in parsed).toBe(false)
  })
})
