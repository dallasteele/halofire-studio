/**
 * @halofire/core — generateDefaultSheetSet tests.
 *
 * Covers the 8 contract points from docs/IMPLEMENTATION_PLAN.md Phase
 * R7.1 (cover + site + N floor plans + riser + hydraulic + BOM +
 * detail):
 *
 *   1. 1881 fixture Design (6 levels, 7 systems) → exactly 12 sheets.
 *   2. Sheet indexes are 1..12 contiguous, in order.
 *   3. First sheet is FP-001 Cover.
 *   4. Levels produce FP-003..FP-008.
 *   5. Each floor plan has 1 viewport with camera.kind='top' and
 *      camera.level_id set to an actual level id.
 *   6. Paper_size honors opts.paper_size (ARCH_E test).
 *   7. Sheet names pad sheet_index to 3 digits.
 *   8. Design with 0 levels → 6 sheets.
 */
import { expect, test } from '@playwright/test'

import {
  generateDefaultSheetSet,
  type GenerateDefaultSetOptions,
} from '@halofire/core/sheets/generate-default-set'
import type { Design, DesignLevel, DesignSystem } from '@halofire/core/scene/spawn-from-design'

// ---- Fixture builder ----------------------------------------------

function makeLevel(id: string, idx: number): DesignLevel {
  return {
    id,
    name: `L${idx}`,
    elevation_m: idx * 3.0,
    height_m: 3.0,
    polygon_m: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  }
}

function makeSystem(id: string): DesignSystem {
  return {
    id,
    name: id,
    kind: 'wet',
    hazard: 'light',
    heads: [],
    pipes: [],
  }
}

function fixture1881(): Design {
  return {
    building: {
      id: 'b_1881',
      name: '1881 Tower',
      levels: [
        makeLevel('lvl_1', 0),
        makeLevel('lvl_2', 1),
        makeLevel('lvl_3', 2),
        makeLevel('lvl_4', 3),
        makeLevel('lvl_5', 4),
        makeLevel('lvl_6', 5),
      ],
    },
    systems: [
      makeSystem('sys_1'),
      makeSystem('sys_2'),
      makeSystem('sys_3'),
      makeSystem('sys_4'),
      makeSystem('sys_5'),
      makeSystem('sys_6'),
      makeSystem('sys_7'),
    ],
  }
}

// ---- Tests --------------------------------------------------------

test('1881 fixture → exactly 12 sheets (cover + site + 6 floor + riser + calc + BOM + detail)', () => {
  const sheets = generateDefaultSheetSet(fixture1881())
  expect(sheets).toHaveLength(12)
})

test('sheet indexes are 1..12 contiguous, in order', () => {
  const sheets = generateDefaultSheetSet(fixture1881())
  const indexes = sheets.map((s) => s.sheet_index)
  expect(indexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('first sheet is FP-001 Cover Sheet', () => {
  const sheets = generateDefaultSheetSet(fixture1881())
  const first = sheets[0]!
  expect(first.name).toBe('FP-001')
  expect(first.title).toBe('Cover Sheet')
  expect(first.sheet_index).toBe(1)
})

test('levels produce FP-003..FP-008 for 1881 (6 levels)', () => {
  const sheets = generateDefaultSheetSet(fixture1881())
  const floorNames = sheets
    .filter((s) => s.title.startsWith('Level '))
    .map((s) => s.name)
  expect(floorNames).toEqual([
    'FP-003',
    'FP-004',
    'FP-005',
    'FP-006',
    'FP-007',
    'FP-008',
  ])
})

test('each floor plan has 1 top viewport with camera.level_id set to a real level id', () => {
  const design = fixture1881()
  const levelIds = new Set((design.building?.levels ?? []).map((l) => l.id))
  const sheets = generateDefaultSheetSet(design)
  const floorSheets = sheets.filter((s) => s.title.startsWith('Level '))
  expect(floorSheets).toHaveLength(6)
  for (const fp of floorSheets) {
    expect(fp.viewports).toHaveLength(1)
    const vp = fp.viewports[0]!
    expect(vp.camera.kind).toBe('top')
    expect(vp.camera.level_id).toBeDefined()
    expect(levelIds.has(vp.camera.level_id!)).toBe(true)
  }
})

test('paper_size honors opts.paper_size (ARCH_E)', () => {
  const opts: GenerateDefaultSetOptions = { paper_size: 'ARCH_E' }
  const sheets = generateDefaultSheetSet(fixture1881(), opts)
  expect(sheets.length).toBeGreaterThan(0)
  for (const s of sheets) {
    expect(s.paper_size).toBe('ARCH_E')
  }
})

test('sheet names zero-pad sheet_index to 3 digits (FP-001 not FP-1)', () => {
  const sheets = generateDefaultSheetSet(fixture1881())
  for (const s of sheets) {
    expect(s.name).toMatch(/^FP-\d{3}$/)
    expect(s.name).toBe(`FP-${s.sheet_index.toString().padStart(3, '0')}`)
  }
  // And the very first one is explicitly FP-001, not FP-1.
  expect(sheets[0]!.name).toBe('FP-001')
})

test('design with 0 levels → cover + site + riser + hydraulic + BOM + detail = 6 sheets', () => {
  const emptyDesign: Design = {
    building: { id: 'b_empty', name: 'Empty', levels: [] },
    systems: [],
  }
  const sheets = generateDefaultSheetSet(emptyDesign)
  expect(sheets).toHaveLength(6)
  expect(sheets.map((s) => s.title)).toEqual([
    'Cover Sheet',
    'Site Plan',
    'Riser Diagram',
    'Hydraulic Calculation Summary',
    'Bill of Materials',
    'Typical Details',
  ])
})
