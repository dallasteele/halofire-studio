import { describe, expect, test } from 'bun:test'
import { _internals } from '../RemoteAreaDraw'

describe('RemoteAreaDraw helpers', () => {
  test('pxToWorldM scales against the 30m visible grid', () => {
    const c = { clientWidth: 600, width: 600 } as HTMLCanvasElement
    expect(_internals.pxToWorldM(300, c)).toBeCloseTo(15, 5) // half width = 15m
    expect(_internals.pxToWorldM(0, c)).toBe(0)
    expect(_internals.pxToWorldM(600, c)).toBeCloseTo(30, 5)
  })

  test('pxToWorldM is 0 on degenerate canvas', () => {
    const c = { clientWidth: 0, width: 0 } as HTMLCanvasElement
    expect(_internals.pxToWorldM(100, c)).toBe(0)
  })

  test('worldBoundsFor sorts min/max regardless of drag direction', () => {
    const c = { clientWidth: 600, width: 600 } as HTMLCanvasElement
    // Drag from (400, 400) up-left to (100, 100)
    const rect = _internals.worldBoundsFor(
      { x: 400, y: 400 }, { x: 100, y: 100 }, c,
    )
    expect(rect.px0).toBe(100)
    expect(rect.py0).toBe(100)
    expect(rect.px1).toBe(400)
    expect(rect.py1).toBe(400)
    expect(rect.x_min_m).toBeCloseTo(5, 5)
    expect(rect.x_max_m).toBeCloseTo(20, 5)
  })

  test('worldBoundsFor computes area in m² and sqft', () => {
    const c = { clientWidth: 600, width: 600 } as HTMLCanvasElement
    // 200 px × 200 px at 30m/600px = 10m × 10m = 100 m²
    const rect = _internals.worldBoundsFor(
      { x: 0, y: 0 }, { x: 200, y: 200 }, c,
    )
    expect(rect.area_m2).toBeCloseTo(100, 3)
    // 100 m² → 1076.39 sqft
    expect(rect.area_sqft).toBeCloseTo(1076.39, 1)
  })

  test('worldBoundsFor area is 0 for zero-size rect', () => {
    const c = { clientWidth: 600, width: 600 } as HTMLCanvasElement
    const rect = _internals.worldBoundsFor(
      { x: 100, y: 100 }, { x: 100, y: 100 }, c,
    )
    expect(rect.area_m2).toBe(0)
    expect(rect.area_sqft).toBe(0)
  })
})
