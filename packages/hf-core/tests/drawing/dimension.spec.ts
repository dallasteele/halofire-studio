/**
 * @halofire/core — dimension helpers + auto-dim-pipe-runs tests.
 *
 * Runs under Playwright test runner in a Node context (blueprint 07 §5,
 * implementation plan Phase R8.1 / R8.3).
 *
 * Coverage:
 *   1. formatDimensionText 3.810m as 'ft_in' → `12'-6"`
 *   2. formatDimensionText 3.810m as 'm'     → `3.81 m`
 *   3. formatDimensionText 3.810m as 'mm'    → `3810 mm`
 *   4. dimensionToSvgPrimitives linear dim → ≥2 extension lines, ≥1
 *      dim line, ≥1 text primitive.
 *   5. autoDimensionPipeRun with 3 heads on a branch → 1 continuous
 *      dim with 5 points (branch_start + 3 heads + branch_end).
 *   6. autoDimensionPipeRun with 0 heads on a branch → empty array.
 */
import { expect, test } from '@playwright/test'
import {
  autoDimensionPipeRun,
  dimensionToSvgPrimitives,
  formatDimensionText,
} from '@halofire/core'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import { DEFAULT_DIM_STYLE } from '@pascal-app/core/schema/nodes/dim-style'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { Dimension } from '@pascal-app/core/schema/nodes/sheet'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { PipeNode } from '@pascal-app/core/schema/nodes/pipe'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { SprinklerHeadNode } from '@pascal-app/core/schema/nodes/sprinkler-head'

test.describe('@halofire/core — formatDimensionText', () => {
  test("formats 3.810m as ft_in → 12'-6\"", () => {
    expect(formatDimensionText(3.81, 'ft_in', 2)).toBe(`12'-6"`)
  })

  test('formats 3.810m as m → 3.81 m', () => {
    expect(formatDimensionText(3.81, 'm', 2)).toBe('3.81 m')
  })

  test('formats 3.810m as mm → 3810 mm', () => {
    expect(formatDimensionText(3.81, 'mm', 2)).toBe('3810 mm')
  })
})

test.describe('@halofire/core — dimensionToSvgPrimitives', () => {
  test('linear dim emits 2 extension lines + 1 dim line + 1 text primitive', () => {
    const dim: Dimension = {
      id: 'd1',
      kind: 'linear',
      points: [
        [0, 0],
        [3810, 0],  // 3810 mm = 3.81 m paper-space
      ],
      dim_line_offset_m: 0.02,
      precision: 2,
      unit_display: 'mm',
      style_id: DEFAULT_DIM_STYLE.id,
    }
    const prims = dimensionToSvgPrimitives(dim, DEFAULT_DIM_STYLE)
    const lines = prims.filter((p) => p.type === 'line')
    const texts = prims.filter((p) => p.type === 'text')
    // 2 extension (one per point) + 1 dim line across the single span.
    expect(lines.length).toBe(3)
    expect(texts.length).toBe(1)
  })
})

test.describe('@halofire/core — autoDimensionPipeRun', () => {
  const system = { id: 'sys_1' }
  const baseHead = (
    id: string,
    x: number,
    branchId: string,
  ): SprinklerHeadNode =>
    ({
      id: `sprinkler_head_${id}`,
      type: 'sprinkler_head',
      position: [x, 2.7, 0],
      rotation: [0, 0, 0],
      k_factor: 5.6,
      sku: 'TY-B',
      manufacturer: 'tyco',
      orientation: 'pendant',
      response: 'standard',
      temperature: 'ordinary_155F',
      systemId: system.id,
      branchId,
    }) as unknown as SprinklerHeadNode

  const branch: PipeNode = {
    id: 'pipe_br1',
    type: 'pipe',
    start_m: [0, 3.0, 0],
    end_m: [10, 3.0, 0],
    size_in: 1,
    schedule: 'SCH10',
    role: 'branch',
    systemId: system.id,
    downstreamPipeIds: [],
  } as unknown as PipeNode

  test('branch with 3 heads → 1 continuous dim with 5 points', () => {
    const heads = [
      baseHead('h1', 2.5, branch.id),
      baseHead('h2', 5.0, branch.id),
      baseHead('h3', 7.5, branch.id),
    ]
    const dims = autoDimensionPipeRun(system, [branch], heads, {
      style_id: DEFAULT_DIM_STYLE.id,
      sheet_id: 'sheet_FP003',
      unit_display: 'ft_in',
    })
    expect(dims.length).toBe(1)
    expect(dims[0]?.kind).toBe('continuous')
    expect(dims[0]?.points.length).toBe(5)
    expect(dims[0]?.points[0]).toEqual([0, 0])
    expect(dims[0]?.points[4]).toEqual([10, 0])
  })

  test('branch with 0 heads → empty array', () => {
    const dims = autoDimensionPipeRun(system, [branch], [], {
      style_id: DEFAULT_DIM_STYLE.id,
      sheet_id: 'sheet_FP003',
      unit_display: 'ft_in',
    })
    expect(dims.length).toBe(0)
  })
})
