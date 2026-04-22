import { describe, expect, test } from 'bun:test'

import { _internals } from '../NodeTags'

describe('NodeTags projection', () => {
  const rect = { left: 0, top: 0, width: 600, height: 600 }

  test('origin (0,0,0) projects to the center of the canvas', () => {
    const p = _internals.projectNode([0, 0, 0], rect, 30)
    expect(p.x).toBeCloseTo(300, 1)
    expect(p.y).toBeCloseTo(300, 1)
  })

  test('positive X translates right, positive Z translates down', () => {
    // 15m in X at 30m-span → half the canvas = +300 px from center = 600.
    const px = _internals.projectNode([15, 0, 0], rect, 30)
    expect(px.x).toBeCloseTo(600, 1)
    expect(px.y).toBeCloseTo(300, 1)

    const py = _internals.projectNode([0, 0, 15], rect, 30)
    expect(py.x).toBeCloseTo(300, 1)
    expect(py.y).toBeCloseTo(600, 1)
  })

  test('negative coords project to the upper-left quadrant', () => {
    const p = _internals.projectNode([-10, 0, -10], rect, 30)
    expect(p.x).toBeLessThan(300)
    expect(p.y).toBeLessThan(300)
  })

  test('severityColor maps severities to the Phase C palette', () => {
    expect(_internals.severityColor('ok')).toBe('#4af626')
    expect(_internals.severityColor('warn')).toBe('#ffb800')
    expect(_internals.severityColor('critical')).toBe('#ff3333')
  })
})
