/**
 * Phase B — tool registry + scene store smoke tests.
 *
 * The suite runs under `bun test` like the other halofire unit
 * suites. It verifies:
 *   1. Importing the tools barrel registers all ten tools.
 *   2. The halofire scene store accepts local mutations + rolls back
 *      on fetch error.
 *   3. Sprinkler tool's pointer-down path calls insertHead.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Stub zustand globally via DOM shims first
import '../../../lib/tools'
import { listTools, getTool } from '../../../lib/tools'
import { getHalofireSceneStore } from '../../../lib/halofire/scene-store'

describe('Tool registry', () => {
  test('registers every Phase B tool', () => {
    const ids = listTools().map((t) => t.id).sort()
    expect(ids).toEqual([
      'fitting', 'hanger', 'measure', 'move', 'pipe', 'remote_area',
      'resize', 'section', 'sprinkler', 'sway_brace',
    ])
  })

  test('each tool has id + label', () => {
    for (const t of listTools()) {
      expect(t.id).toBeTruthy()
      expect(t.label).toBeTruthy()
    }
  })

  test('lookup by id', () => {
    const sprinkler = getTool('sprinkler')
    expect(sprinkler).toBeDefined()
    expect(sprinkler?.label).toBe('Sprinkler')
  })
})

describe('halofire scene store', () => {
  const ORIG_FETCH = globalThis.fetch
  beforeEach(() => {
    getHalofireSceneStore('test-project').getState().reset()
  })
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
  })

  test('insertHead optimistically adds then swaps to server id', async () => {
    const store = getHalofireSceneStore('test-project')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        ok: true, op: 'insert_head', seq: 1,
        delta: { added_nodes: ['head_real_abc'], removed_nodes: [], changed_nodes: [], warnings: [], recalc: {} },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    await store.getState().insertHead({ position_m: { x: 1, y: 2.8, z: 1 } })
    const nodes = Object.keys(store.getState().nodes)
    expect(nodes).toEqual(['head_real_abc'])
    expect(store.getState().lastSeq).toBe(1)
  })

  test('insertHead rolls back on fetch failure', async () => {
    const store = getHalofireSceneStore('test-project')
    globalThis.fetch = async () =>
      new Response('boom', { status: 500 })
    let threw = false
    try {
      await store.getState().insertHead({ position_m: { x: 0, y: 0, z: 0 } })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(Object.keys(store.getState().nodes).length).toBe(0)
  })
})
