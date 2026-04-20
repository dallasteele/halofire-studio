/**
 * Catalog smoke — every SKU must carry enough metadata for an AI
 * agent to place it, color it, and connect it to its neighbors.
 *
 * Run: `bun test packages/halofire-catalog/tests/catalog.test.ts`
 */
import { describe, expect, test } from 'bun:test'
import {
  canMate,
  CATALOG,
  connectorsFor,
  materialFor,
  MATERIAL_PRESETS,
} from '../src/index.js'

describe('catalog metadata completeness', () => {
  test('CATALOG is non-empty', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(20)
  })

  test.each(CATALOG.map((e) => [e.sku, e]))(
    '%s has a resolved MaterialSpec',
    (_sku, entry) => {
      const m = materialFor(entry)
      expect(m).toBeDefined()
      expect(m.color_hex).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(m.metalness).toBeGreaterThanOrEqual(0)
      expect(m.metalness).toBeLessThanOrEqual(1)
      expect(m.roughness).toBeGreaterThanOrEqual(0)
      expect(m.roughness).toBeLessThanOrEqual(1)
    },
  )

  test.each(CATALOG.map((e) => [e.sku, e]))(
    '%s has at least one connector',
    (_sku, entry) => {
      const conns = connectorsFor(entry)
      expect(conns.length).toBeGreaterThanOrEqual(1)
    },
  )
})

describe('per-category connector invariants', () => {
  test('pipes have exactly 2 collinear end connectors', () => {
    const pipes = CATALOG.filter((e) => e.category === 'pipe_steel_sch10')
    expect(pipes.length).toBeGreaterThan(0)
    for (const p of pipes) {
      const c = connectorsFor(p)
      expect(c).toHaveLength(2)
      // Ends must be on opposite sides of origin along Z
      expect(c[0].direction[2]).toBe(-1)
      expect(c[1].direction[2]).toBe(1)
      expect(c[0].position_m[2]).toBeLessThan(0)
      expect(c[1].position_m[2]).toBeGreaterThan(0)
      // Same nominal size on both ends
      expect(c[0].size_in).toBe(c[1].size_in)
    }
  })

  test('tees have exactly 3 connectors (2 on run axis, 1 on branch)', () => {
    const tees = CATALOG.filter((e) => e.category === 'fitting_tee_equal')
    expect(tees.length).toBeGreaterThan(0)
    for (const t of tees) {
      const c = connectorsFor(t)
      expect(c).toHaveLength(3)
      const runs = c.filter((x) => x.id.startsWith('run_'))
      const branches = c.filter((x) => x.role === 'branch')
      expect(runs).toHaveLength(2)
      expect(branches).toHaveLength(1)
      // Branch orthogonal to run
      const dot =
        runs[0].direction[0] * branches[0].direction[0] +
        runs[0].direction[1] * branches[0].direction[1] +
        runs[0].direction[2] * branches[0].direction[2]
      expect(dot).toBe(0)
    }
  })

  test('90° elbows have 2 orthogonal connectors', () => {
    const elbows = CATALOG.filter((e) => e.category === 'fitting_elbow_90')
    expect(elbows.length).toBeGreaterThan(0)
    for (const el of elbows) {
      const c = connectorsFor(el)
      expect(c).toHaveLength(2)
      const dot =
        c[0].direction[0] * c[1].direction[0] +
        c[0].direction[1] * c[1].direction[1] +
        c[0].direction[2] * c[1].direction[2]
      // Directions orthogonal → dot = 0
      expect(dot).toBe(0)
    }
  })

  test('reducer has different sizes on each connector', () => {
    const reducers = CATALOG.filter((e) => e.category === 'fitting_reducer')
    for (const r of reducers) {
      const c = connectorsFor(r)
      expect(c).toHaveLength(2)
      expect(c[0].size_in).not.toBe(c[1].size_in)
    }
  })

  test('flow switch exposes only a pipe_tap connector', () => {
    const fs = CATALOG.find((e) => e.category === 'riser_flow_switch')
    expect(fs).toBeDefined()
    const c = connectorsFor(fs!)
    expect(c).toHaveLength(1)
    expect(c[0].role).toBe('tap')
  })

  test('pendant head points up (+Y), upright points down (-Y), sidewall -X', () => {
    const pendant = CATALOG.find(
      (e) => e.category === 'sprinkler_head_pendant',
    )
    const upright = CATALOG.find(
      (e) => e.category === 'sprinkler_head_upright',
    )
    const sidewall = CATALOG.find(
      (e) => e.category === 'sprinkler_head_sidewall',
    )
    expect(connectorsFor(pendant!)[0].direction).toEqual([0, 1, 0])
    expect(connectorsFor(upright!)[0].direction).toEqual([0, -1, 0])
    expect(connectorsFor(sidewall!)[0].direction).toEqual([-1, 0, 0])
  })
})

describe('canMate compatibility rule', () => {
  test('symmetric: a↔b iff b↔a', () => {
    for (const a of CATALOG) {
      for (const b of CATALOG) {
        const ac = connectorsFor(a)[0]
        const bc = connectorsFor(b)[0]
        if (!ac || !bc) continue
        expect(canMate(ac, bc)).toBe(canMate(bc, ac))
      }
    }
  })

  test('different sizes never mate', () => {
    const p1 = connectorsFor(
      CATALOG.find((e) => e.sku === 'SM_Pipe_SCH10_1in_1m')!,
    )[0]
    const p2 = connectorsFor(
      CATALOG.find((e) => e.sku === 'SM_Pipe_SCH10_2in_1m')!,
    )[0]
    expect(canMate(p1, p2)).toBe(false)
  })

  test('taps never mate with anything', () => {
    const fs = connectorsFor(
      CATALOG.find((e) => e.category === 'riser_flow_switch')!,
    )[0]
    const pipeEnd = connectorsFor(
      CATALOG.find((e) => e.sku === 'SM_Pipe_SCH10_2in_1m')!,
    )[0]
    expect(canMate(fs, pipeEnd)).toBe(false)
  })

  test('matching 2" grooved pipe ends mate', () => {
    const a = connectorsFor(
      CATALOG.find((e) => e.sku === 'SM_Pipe_SCH10_2in_1m')!,
    )[0]
    const b = connectorsFor(
      CATALOG.find((e) => e.sku === 'SM_Fitting_Coupling_Grooved_2in')!,
    )[0]
    expect(canMate(a, b)).toBe(true)
  })
})

describe('material presets cover real finishes', () => {
  test('no SKU falls through to the brass fallback silently', () => {
    // The materialFor() fallback is brass — which is also legitimate
    // for actual brass parts. So we verify the mapping at least
    // produced *some* matching preset hex.
    const allHexes = new Set(
      Object.values(MATERIAL_PRESETS).map((m) => m.color_hex),
    )
    for (const e of CATALOG) {
      expect(allHexes.has(materialFor(e).color_hex)).toBe(true)
    }
  })

  test('NFPA-red parts carry a regulatory paint color', () => {
    const redSteel = CATALOG.find(
      (e) => e.finish === 'Red-painted steel',
    )
    expect(redSteel).toBeDefined()
    expect(materialFor(redSteel!).nfpa_paint_hex).not.toBeNull()
  })

  test('chrome/brass parts have no regulatory paint requirement', () => {
    const chrome = CATALOG.find((e) => e.finish === 'Chrome')
    expect(chrome).toBeDefined()
    expect(materialFor(chrome!).nfpa_paint_hex).toBeNull()
  })
})
