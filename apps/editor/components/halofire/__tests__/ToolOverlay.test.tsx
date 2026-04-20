import { describe, expect, test } from 'bun:test'
import { _internals } from '../ToolOverlay'

describe('ToolOverlay pure helpers', () => {
  test('distancePx: pythagorean', () => {
    const d = _internals.distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })
    expect(d).toBe(5)
  })

  test('pxToMeters scales against the 30m visible grid', () => {
    const fakeCanvas = { clientWidth: 600, width: 600 } as HTMLCanvasElement
    const m = _internals.pxToMeters(200, fakeCanvas)
    // 200 / 600 * 30 = 10m
    expect(m).toBeCloseTo(10, 5)
  })

  test('pxToMeters returns 0 on degenerate canvas', () => {
    const c = { clientWidth: 0, width: 0 } as HTMLCanvasElement
    expect(_internals.pxToMeters(100, c)).toBe(0)
  })
})
