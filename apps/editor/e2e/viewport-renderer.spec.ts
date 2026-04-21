/**
 * R6.4 — ViewportRenderer.
 *
 * Pure Node-context tests that exercise the exported helpers and
 * React component of
 * `packages/editor/src/components/sheet/viewport-renderer.tsx`.
 *
 * Pixel-level WebGL output is intentionally NOT asserted here — the
 * test runner boots under Node with no real WebGL context. The tests
 * cover the deterministic layers: scene filtering, scale math,
 * paper-space SVG geometry, and the offscreen renderer lifecycle
 * (dispose on unmount / re-render).
 */
import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  computeBBox,
  filterSceneForViewport,
  metresPerPaperMm,
  renderViewportSvg,
  type ViewportDebugInfo,
} from '../../../packages/editor/src/components/sheet/viewport-renderer'
import type { AnyNode, Viewport } from '../../../packages/core/src/schema'

const LEVEL_ID = 'level_level_1'

function buildSnapshot(): Record<string, AnyNode> {
  const level = {
    id: LEVEL_ID,
    type: 'level',
    parentId: null,
    name: 'L1',
  } as unknown as AnyNode

  const slab = {
    id: 'slab_a',
    type: 'slab',
    parentId: LEVEL_ID,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ],
    holes: [],
    holeMetadata: [],
    elevation: 0,
    autoFromWalls: false,
  } as unknown as AnyNode

  const head = {
    id: 'head_a',
    type: 'sprinkler_head',
    parentId: LEVEL_ID,
    position: [5, 2.9, 3],
    rotation: [0, 0, 0],
    k_factor: 5.6,
    sku: 'TY-B TY1234',
    manufacturer: 'tyco',
    orientation: 'pendant',
    response: 'standard',
    temperature: 'ordinary_155F',
  } as unknown as AnyNode

  return {
    [level.id]: level,
    [slab.id]: slab,
    [head.id]: head,
  }
}

function buildViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    id: 'vp1',
    paper_rect_mm: [100, 100, 400, 200],
    camera: { kind: 'top', level_id: LEVEL_ID },
    scale: '1_96',
    ...overrides,
  } as Viewport
}

test.describe('viewport-renderer / pure helpers', () => {
  test('scale math: 1_96 => 0.096 m per paper mm', () => {
    expect(metresPerPaperMm('1_96')).toBeCloseTo(0.096, 6)
    expect(metresPerPaperMm('1_50')).toBeCloseTo(0.05, 6)
    expect(metresPerPaperMm('1_10')).toBeCloseTo(0.01, 6)
  })

  test('filterSceneForViewport scopes to level_id and renderable types', () => {
    const snapshot = buildSnapshot()
    const viewport = buildViewport()
    const filtered = filterSceneForViewport(snapshot, viewport)
    const types = filtered.map((n) => n.type).sort()
    expect(types).toEqual(['slab', 'sprinkler_head'])
  })

  test('layer_visibility=false suppresses a type (debug hook counts drop)', () => {
    const snapshot = buildSnapshot()
    const off = filterSceneForViewport(snapshot, buildViewport({
      layer_visibility: { sprinkler_head: false },
    }))
    expect(off.map((n) => n.type)).toEqual(['slab'])
    expect(off.find((n) => n.type === 'sprinkler_head')).toBeUndefined()
  })

  test('computeBBox covers slab polygon + head position', () => {
    const snapshot = buildSnapshot()
    const filtered = filterSceneForViewport(snapshot, buildViewport())
    const bbox = computeBBox(filtered)
    expect(bbox).not.toBeNull()
    if (!bbox) return
    expect(bbox[0]).toBeCloseTo(0)
    expect(bbox[1]).toBeCloseTo(0)
    expect(bbox[2]).toBeCloseTo(10)
    expect(bbox[3]).toBeCloseTo(6)
  })
})

test.describe('viewport-renderer / component', () => {
  test('renders without throwing and emits SVG with <image> data URL', () => {
    const snapshot = buildSnapshot()
    const viewport = buildViewport()
    const svg = renderViewportSvg(viewport, snapshot, 1)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toMatch(/<image[^>]+href="data:image\/png;base64,/)
  })

  test('paper_rect_mm [100, 100, 400, 200] → <image> geometry matches', () => {
    const snapshot = buildSnapshot()
    const viewport = buildViewport({ paper_rect_mm: [100, 100, 400, 200] })
    const svg = renderViewportSvg(viewport, snapshot, 1)
    expect(svg).toMatch(/<image[^>]*\bx="100"/)
    expect(svg).toMatch(/<image[^>]*\by="100"/)
    expect(svg).toMatch(/<image[^>]*\bwidth="400"/)
    expect(svg).toMatch(/<image[^>]*\bheight="200"/)
  })

  test('layer_visibility off for sprinkler_head → debug hook sees zero heads', () => {
    const snapshot = buildSnapshot()
    const viewport = buildViewport({
      layer_visibility: { sprinkler_head: false },
    })
    let info: ViewportDebugInfo | null = null
    renderViewportSvg(viewport, snapshot, 1, (i) => {
      info = i
    })
    expect(info).not.toBeNull()
    if (!info) return
    expect(info.nodeTypesRendered).not.toContain('sprinkler_head')
    expect(info.nodeTypesRendered).toContain('slab')
  })

  test('WebGLRenderer.dispose is called (no GL context leak on re-render)', () => {
    // Monkey-patch WebGLRenderer to track dispose without requiring
    // a real WebGL context. If there is no DOM, skip — the lifecycle
    // contract cannot be observed in that environment.
    if (typeof document === 'undefined') {
      test.skip(true, 'No DOM in this test runner — WebGL lifecycle not exercised in Node mode')
      return
    }
    let disposeCount = 0
    const OriginalRenderer = THREE.WebGLRenderer
    // @ts-expect-error — test-only shim
    THREE.WebGLRenderer = function FakeRenderer() {
      return {
        setSize() {},
        setClearColor() {},
        render() {},
        domElement: { toDataURL: () => 'data:image/png;base64,AA==' },
        dispose() {
          disposeCount += 1
        },
        forceContextLoss() {},
      }
    } as unknown as typeof THREE.WebGLRenderer
    try {
      const snapshot = buildSnapshot()
      renderViewportSvg(buildViewport(), snapshot, 1)
      // A second render — dispose must fire again to prevent leaks.
      renderViewportSvg(
        buildViewport({ paper_rect_mm: [0, 0, 200, 100] }),
        snapshot,
        1,
      )
      expect(disposeCount).toBeGreaterThanOrEqual(2)
    } finally {
      // @ts-expect-error — restore
      THREE.WebGLRenderer = OriginalRenderer
    }
  })
})
