/**
 * Phase F — new behavior tests.
 *
 * Covers:
 *   1. HalofireBridge layer visibility state + reducer.
 *   2. resolveHalofireLayer category / tag mapping.
 *   3. Scene-store rebuildFromDesign + resyncFromServer.
 *   4. PipeHandles stepSize schedule walk.
 *   5. CommandPalette includes every tool-* command.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  useHalofireBridge,
  resolveHalofireLayer,
  DEFAULT_LAYER_VISIBILITY as HALOFIRE_DEFAULT_LAYER_VISIBILITY,
} from '@pascal-app/viewer/halofire'
import { getHalofireSceneStore } from '../../../lib/halofire/scene-store'
import { _internals as pipeHandleInternals } from '../PipeHandles'
import { DEFAULT_ENTRIES } from '../CommandPalette'

describe('HalofireBridge layer visibility', () => {
  beforeEach(() => {
    useHalofireBridge.setState({ layers: { ...HALOFIRE_DEFAULT_LAYER_VISIBILITY } })
  })

  test('setLayerVisibility mutates only the named layers', () => {
    useHalofireBridge.getState().setLayerVisibility({ heads: false })
    expect(useHalofireBridge.getState().layers.heads).toBe(false)
    expect(useHalofireBridge.getState().layers.pipes).toBe(true)
  })

  test('setAllLayers flips every layer to the given value', () => {
    useHalofireBridge.getState().setAllLayers(false)
    for (const v of Object.values(useHalofireBridge.getState().layers)) {
      expect(v).toBe(false)
    }
  })
})

describe('resolveHalofireLayer', () => {
  test('halofire_layer tag wins', () => {
    expect(
      resolveHalofireLayer({ tags: ['halofire', 'halofire_layer:pipes'] }),
    ).toBe('pipes')
  })
  test('category prefix falls through', () => {
    expect(resolveHalofireLayer({ category: 'sprinkler_head_pendent' })).toBe('heads')
    expect(resolveHalofireLayer({ category: 'pipe_sch40' })).toBe('pipes')
    expect(resolveHalofireLayer({ category: 'hanger_loop' })).toBe('hangers')
  })
  test('type fallback', () => {
    expect(resolveHalofireLayer({ type: 'wall' })).toBe('walls')
  })
  test('unknown → null', () => {
    expect(resolveHalofireLayer({})).toBeNull()
  })
})

describe('Scene store — rebuildFromDesign + resyncFromServer', () => {
  const ORIG_FETCH = globalThis.fetch
  beforeEach(() => {
    getHalofireSceneStore('phase-f').getState().reset()
  })
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
  })

  test('rebuildFromDesign populates nodes from systems[].heads + pipes', () => {
    const store = getHalofireSceneStore('phase-f')
    store.getState().rebuildFromDesign({
      systems: [
        {
          id: 'sys_1',
          heads: [
            { id: 'head_a', position_m: [1, 2, 3], sku: 'TY' },
            { id: 'head_b', position_m: [4, 5, 6] },
          ],
          pipes: [
            {
              id: 'pipe_1',
              from_point_m: [0, 0, 0],
              to_point_m: [3, 0, 0],
              size_in: 1.25,
              role: 'branch',
            },
          ],
        },
      ],
    })
    const nodes = store.getState().nodes
    expect(Object.keys(nodes).sort()).toEqual(['head_a', 'head_b', 'pipe_1'])
    expect(nodes.head_a.kind).toBe('head')
    expect(nodes.pipe_1.kind).toBe('pipe')
    if (nodes.pipe_1.kind === 'pipe') {
      expect(nodes.pipe_1.size_in).toBe(1.25)
    }
  })

  test('rebuildFromDesign resets to empty when design is null', () => {
    const store = getHalofireSceneStore('phase-f')
    store.getState().addLocal({
      id: 'ghost', kind: 'head', position_m: { x: 0, y: 0, z: 0 },
    })
    store.getState().rebuildFromDesign(null)
    expect(Object.keys(store.getState().nodes).length).toBe(0)
  })

  test('resyncFromServer fetches /scene and applies design', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          project_id: 'phase-f',
          seq: 7,
          design: {
            systems: [
              {
                id: 'sys_x',
                heads: [{ id: 'head_real', position_m: [1, 2.8, 1] }],
                pipes: [],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const store = getHalofireSceneStore('phase-f')
    await store.getState().resyncFromServer()
    expect(store.getState().lastSeq).toBe(7)
    expect(store.getState().nodes.head_real).toBeDefined()
  })

  test('resyncFromServer handles empty marker gracefully', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ project_id: 'phase-f', empty: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const store = getHalofireSceneStore('phase-f')
    store.getState().addLocal({
      id: 'stale', kind: 'head', position_m: { x: 1, y: 1, z: 1 },
    })
    await store.getState().resyncFromServer()
    expect(Object.keys(store.getState().nodes).length).toBe(0)
  })

  test('undo triggers a resync (fetch called)', async () => {
    let sceneCalls = 0
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString?.() ?? ''
      if (url.includes('/undo')) {
        return new Response(JSON.stringify({
          ok: true, op: 'undo', seq: 3,
          delta: { added_nodes: [], removed_nodes: [], changed_nodes: [], warnings: [], recalc: {} },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/scene')) {
        sceneCalls += 1
        return new Response(JSON.stringify({
          project_id: 'phase-f', seq: 3,
          design: { systems: [] },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }
    await getHalofireSceneStore('phase-f').getState().undo()
    expect(sceneCalls).toBe(1)
  })
})

describe('PipeHandles stepSize', () => {
  test('walks up the schedule', () => {
    expect(pipeHandleInternals.stepSize(1.0, 1)).toBe(1.25)
    expect(pipeHandleInternals.stepSize(1.25, 1)).toBe(1.5)
  })
  test('walks down the schedule', () => {
    expect(pipeHandleInternals.stepSize(1.25, -1)).toBe(1.0)
  })
  test('clamps at the top + bottom of the range', () => {
    expect(pipeHandleInternals.stepSize(8.0, 1)).toBe(8.0)
    expect(pipeHandleInternals.stepSize(0.75, -1)).toBe(0.75)
  })
  test('snaps non-canonical sizes to the next valid', () => {
    expect(pipeHandleInternals.stepSize(1.1, 1)).toBe(1.5)
  })
})

describe('CommandPalette Phase F entries', () => {
  const toolCmds = [
    'tool-sprinkler', 'tool-pipe', 'tool-fitting', 'tool-hanger',
    'tool-sway-brace', 'tool-remote-area', 'tool-move', 'tool-resize',
    'tool-measure', 'tool-section',
  ]
  test('every tool-* command is present in the palette', () => {
    const cmds = new Set(DEFAULT_ENTRIES.map((e) => e.cmd))
    for (const t of toolCmds) expect(cmds.has(t as any)).toBe(true)
  })
  test('each tool entry exposes a ribbon-location hint', () => {
    const toolEntries = DEFAULT_ENTRIES.filter(
      (e) => e.cmd && toolCmds.includes(e.cmd as string),
    )
    expect(toolEntries.length).toBe(toolCmds.length)
    for (const e of toolEntries) expect(e.hint).toBeTruthy()
  })
})
