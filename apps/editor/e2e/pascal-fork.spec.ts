/**
 * Pascal fork — schema tests.
 *
 * These tests prove SprinklerHeadNode is a REAL Pascal node type, not a
 * halofire-tagged ItemNode. They run the zod schema directly (Node
 * context, no browser) and assert:
 *
 *   - valid fire-protection heads parse cleanly
 *   - required fields (k_factor, sku, orientation) reject when missing
 *   - Hazen-Williams helper flowAtPressure() matches NFPA 13 Q = K√P
 *   - AnyNode discriminated union routes type='sprinkler_head' correctly
 */
import { expect, test } from '@playwright/test'
// Import the schema module directly (bypass the core barrel which
// transitively pulls three.js systems that can't load in a pure Node
// test environment).
// biome-ignore lint/style/noRelativeImport: direct module path is intentional
import {
  flowAtPressure,
  SprinklerHeadNode,
} from '@pascal-app/core/schema/nodes/sprinkler-head'
// biome-ignore lint/style/noRelativeImport: direct module path is intentional
import {
  hazenWilliamsC,
  pipeIdMm,
  pipeLengthM,
  pipeOdMm,
  PipeNode,
} from '@pascal-app/core/schema/nodes/pipe'
// biome-ignore lint/style/noRelativeImport: subpath import bypasses three-pulling barrel
import { AnyNode } from '@pascal-app/core/schema/types'
// biome-ignore lint/style/noRelativeImport: subpath import bypasses three-pulling barrel
import { generateId } from '@pascal-app/core/schema/base'

test.describe('Pascal fork — SprinklerHeadNode schema', () => {
  test('parses a valid K5.6 pendant', () => {
    const parsed = SprinklerHeadNode.parse({
      id: generateId('sprinkler_head'),
      type: 'sprinkler_head',
      name: 'TY-B K5.6 pendant',
      position: [1.5, 2.9, 3.0],
      k_factor: 5.6,
      sku: 'TY-B TY1234',
      manufacturer: 'tyco',
      orientation: 'pendant',
      response: 'quick',
      temperature: 'ordinary_155F',
    })
    expect(parsed.type).toBe('sprinkler_head')
    expect(parsed.k_factor).toBe(5.6)
    expect(parsed.orientation).toBe('pendant')
    expect(parsed.id).toMatch(/^sprinkler_head_/)
  })

  test('rejects heads without required k_factor', () => {
    expect(() =>
      SprinklerHeadNode.parse({
        id: generateId('sprinkler_head'),
        type: 'sprinkler_head',
        sku: 'X',
        orientation: 'pendant',
      }),
    ).toThrow()
  })

  test('rejects heads without a SKU (required catalog link)', () => {
    expect(() =>
      SprinklerHeadNode.parse({
        id: generateId('sprinkler_head'),
        type: 'sprinkler_head',
        k_factor: 5.6,
        sku: '',  // empty string is rejected by min(1)
        orientation: 'pendant',
      }),
    ).toThrow()
  })

  test('rejects invalid orientations', () => {
    expect(() =>
      SprinklerHeadNode.parse({
        id: generateId('sprinkler_head'),
        type: 'sprinkler_head',
        k_factor: 5.6,
        sku: 'X',
        orientation: 'ceiling',  // not in enum
      }),
    ).toThrow()
  })

  test('flowAtPressure implements Q = K√P (NFPA 13 §23)', () => {
    const head = SprinklerHeadNode.parse({
      id: generateId('sprinkler_head'),
      type: 'sprinkler_head',
      k_factor: 5.6,
      sku: 'TY-B',
      orientation: 'pendant',
    })
    // Q = 5.6 √7 = 5.6 * 2.6457… = 14.81 gpm
    expect(flowAtPressure(head, 7)).toBeCloseTo(14.81, 1)
    // K=11.2 ESFR @ 25 psi design = 11.2 × 5 = 56 gpm
    expect(flowAtPressure({ ...head, k_factor: 11.2 }, 25)).toBe(56)
    // Zero / negative pressure clamps to zero.
    expect(flowAtPressure(head, 0)).toBe(0)
    expect(flowAtPressure(head, -5)).toBe(0)
  })

  test('AnyNode discriminated union recognises sprinkler_head', () => {
    const head = AnyNode.parse({
      id: generateId('sprinkler_head'),
      type: 'sprinkler_head',
      k_factor: 8.0,
      sku: 'VK100',
      manufacturer: 'viking',
      orientation: 'upright',
    })
    expect(head.type).toBe('sprinkler_head')
    // The rest of Pascal can now narrow on discriminator.
    if (head.type === 'sprinkler_head') {
      expect(head.k_factor).toBe(8.0)
    }
  })

  test('hydraulic state is optional + partial-writable', () => {
    const head = SprinklerHeadNode.parse({
      id: generateId('sprinkler_head'),
      type: 'sprinkler_head',
      k_factor: 5.6,
      sku: 'X',
      orientation: 'pendant',
      hydraulic: { flow_gpm: 14.81, pressure_psi: 7, is_flowing: true },
    })
    expect(head.hydraulic?.is_flowing).toBe(true)
    expect(head.hydraulic?.flow_gpm).toBeCloseTo(14.81, 2)
  })

  test('coverage area + spacing retained when placer sets them', () => {
    const head = SprinklerHeadNode.parse({
      id: generateId('sprinkler_head'),
      type: 'sprinkler_head',
      k_factor: 5.6,
      sku: 'X',
      orientation: 'pendant',
      coverage: {
        area_ft2: 225,
        max_spacing_ft: 15,
        max_distance_from_wall_ft: 7.5,
      },
    })
    expect(head.coverage?.max_spacing_ft).toBe(15)
  })
})

test.describe('Pascal fork — PipeNode schema', () => {
  test('parses a valid 2" SCH10 branch run', () => {
    const pipe = PipeNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 2.8, 0],
      end_m: [3.0, 2.8, 0],
      size_in: 2,
      schedule: 'SCH10',
      role: 'branch',
    })
    expect(pipe.type).toBe('pipe')
    expect(pipe.size_in).toBe(2)
    expect(pipe.role).toBe('branch')
  })

  test('rejects non-catalog pipe sizes', () => {
    expect(() =>
      PipeNode.parse({
        id: generateId('pipe'),
        type: 'pipe',
        start_m: [0, 0, 0],
        end_m: [1, 0, 0],
        size_in: 1.75, // not in NFPA catalog
      }),
    ).toThrow()
  })

  test('rejects invalid roles', () => {
    expect(() =>
      PipeNode.parse({
        id: generateId('pipe'),
        type: 'pipe',
        start_m: [0, 0, 0],
        end_m: [1, 0, 0],
        size_in: 2,
        role: 'decorative',
      }),
    ).toThrow()
  })

  test('pipeLengthM computes segment length', () => {
    const pipe = PipeNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 0, 0],
      end_m: [3, 4, 0], // 3-4-5 triangle
      size_in: 2,
    })
    expect(pipeLengthM(pipe)).toBeCloseTo(5, 6)
  })

  test('pipeOdMm returns NFPA Sch-10 OD for common sizes', () => {
    const mk = (nps: number) =>
      PipeNode.parse({
        id: generateId('pipe'),
        type: 'pipe',
        start_m: [0, 0, 0],
        end_m: [1, 0, 0],
        size_in: nps,
        schedule: 'SCH10',
      })
    expect(pipeOdMm(mk(1))).toBe(33.4)
    expect(pipeOdMm(mk(2))).toBe(60.3)
    expect(pipeOdMm(mk(4))).toBe(114.3)
    expect(pipeOdMm(mk(8))).toBe(219.1)
  })

  test('pipeIdMm is OD minus 2× wall', () => {
    const pipe = PipeNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 0, 0],
      end_m: [1, 0, 0],
      size_in: 2,
      schedule: 'SCH10',
    })
    // 60.3 - 2*2.77 = 54.76
    expect(pipeIdMm(pipe)).toBeCloseTo(54.76, 2)
  })

  test('hazenWilliamsC returns 120 steel, 150 CPVC', () => {
    const steel = PipeNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 0, 0],
      end_m: [1, 0, 0],
      size_in: 2,
      schedule: 'SCH10',
    })
    const cpvc = PipeNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 0, 0],
      end_m: [1, 0, 0],
      size_in: 1,
      schedule: 'CPVC_BlazeMaster',
    })
    expect(hazenWilliamsC(steel)).toBe(120)
    expect(hazenWilliamsC(cpvc)).toBe(150)
  })

  test('AnyNode discriminated union recognises pipe', () => {
    const pipe = AnyNode.parse({
      id: generateId('pipe'),
      type: 'pipe',
      start_m: [0, 0, 0],
      end_m: [5, 0, 0],
      size_in: 4,
      schedule: 'SCH10',
      role: 'cross_main',
    })
    expect(pipe.type).toBe('pipe')
    if (pipe.type === 'pipe') {
      expect(pipe.role).toBe('cross_main')
    }
  })
})
