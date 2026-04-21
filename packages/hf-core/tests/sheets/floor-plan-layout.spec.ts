/**
 * @halofire/core — floor-plan-layout tests.
 *
 * Covers the 7 contract points from docs/IMPLEMENTATION_PLAN.md Phase
 * R7.3:
 *
 *   1. selectScale on ~40×25m residential-ish bbox in 864×490mm paper
 *      area returns '1_96' or tighter.
 *   2. selectScale on ~200×100m warehouse bbox returns '1_48' or coarser.
 *   3. buildFloorPlanLayout on 1881 Level 2 — viewport.camera.level_id
 *      matches.
 *   4. layer_visibility has sprinkler_head: true, ceiling: false.
 *   5. Title annotation contains "Level 2" (or the level's name).
 *   6. Scale-bar annotation present (contains 'ft' or 'm').
 *   7. Two mocked rooms with hazard_class → 2 hatches emitted.
 */
import { expect, test } from '@playwright/test'

import {
  buildFloorPlanLayout,
  selectScale,
  type FloorPlanLayoutOpts,
} from '@halofire/core/sheets/floor-plan-layout'
import type { AnyNode, LevelNode } from '@pascal-app/core/schema'

// ---- Helpers ------------------------------------------------------

const SCALE_FACTORS: Record<string, number> = {
  '1_8': 8, '1_10': 10, '1_16': 16, '1_24': 24, '1_25': 25,
  '1_32': 32, '1_48': 48, '1_50': 50, '1_96': 96, '1_100': 100,
}

function makeLevel(
  id: string,
  name: string,
  levelNumber: number,
  slabChildren: string[],
): LevelNode {
  return {
    id,
    type: 'level',
    name,
    level: levelNumber,
    children: slabChildren,
  } as unknown as LevelNode
}

function makeSlab(id: string, polygon: [number, number][]): AnyNode {
  return {
    id,
    type: 'slab',
    polygon,
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    autoFromWalls: false,
  } as unknown as AnyNode
}

function makeRemoteArea(
  id: string,
  polygon: [number, number][],
  hazard: 'light' | 'ordinary_group_1' | 'ordinary_group_2' | 'extra_group_1' | 'extra_group_2',
): AnyNode {
  return {
    id,
    type: 'remote_area',
    polygon_m: polygon,
    hazard_class: hazard,
    is_most_remote: false,
  } as unknown as AnyNode
}

const DEFAULT_OPTS: FloorPlanLayoutOpts = {
  // ARCH_D landscape (914 x 610 mm) is the canonical HaloFire sheet.
  paper_w_mm: 914,
  paper_h_mm: 610,
  margin_mm: 25,
}

// ---- Tests --------------------------------------------------------

test('selectScale on 40×25m bbox in 864×490mm paper area returns 1_96 or tighter', () => {
  const scale = selectScale({ w: 40, h: 25 }, { w: 864, h: 490 })
  // Tighter = smaller factor. '1_96' has factor 96; the result must
  // have factor <= 96 to qualify as "1_96 or tighter".
  expect(SCALE_FACTORS[scale]!).toBeLessThanOrEqual(96)
})

test('selectScale on 200×100m warehouse bbox returns 1_48 or coarser', () => {
  const scale = selectScale({ w: 200, h: 100 }, { w: 864, h: 490 })
  // Coarser = larger factor. '1_48' has factor 48; result >= 48.
  expect(SCALE_FACTORS[scale]!).toBeGreaterThanOrEqual(48)
})

test('buildFloorPlanLayout on 1881 Level 2 — viewport.camera.level_id matches the level', () => {
  const slab = makeSlab('slab_l2', [
    [0, 0], [40, 0], [40, 25], [0, 25],
  ])
  const level = makeLevel('lvl_2', 'Level 2', 2, [slab.id])
  const snapshot: Record<string, AnyNode> = { [slab.id]: slab }

  const layout = buildFloorPlanLayout(level, snapshot, DEFAULT_OPTS)

  expect(layout.viewport.camera.kind).toBe('top')
  expect(layout.viewport.camera.level_id).toBe('lvl_2')
})

test('layer_visibility has sprinkler_head: true and ceiling: false', () => {
  const slab = makeSlab('slab_a', [[0, 0], [10, 0], [10, 10], [0, 10]])
  const level = makeLevel('lvl_x', 'Level 1', 1, [slab.id])
  const snapshot: Record<string, AnyNode> = { [slab.id]: slab }

  const layout = buildFloorPlanLayout(level, snapshot, DEFAULT_OPTS)
  const lv = layout.viewport.layer_visibility!
  expect(lv.sprinkler_head).toBe(true)
  expect(lv.ceiling).toBe(false)
})

test('emits a title annotation containing the level name ("Level 2")', () => {
  const slab = makeSlab('slab_l2b', [[0, 0], [40, 0], [40, 25], [0, 25]])
  const level = makeLevel('lvl_2b', 'Level 2', 2, [slab.id])
  const snapshot: Record<string, AnyNode> = { [slab.id]: slab }

  const layout = buildFloorPlanLayout(level, snapshot, DEFAULT_OPTS)
  const titles = layout.annotations.filter((a) => a.text.includes('Level 2'))
  expect(titles.length).toBeGreaterThanOrEqual(1)
})

test('scale-bar annotation present (text contains "ft" or "m")', () => {
  const slab = makeSlab('slab_sb', [[0, 0], [12, 0], [12, 8], [0, 8]])
  const level = makeLevel('lvl_sb', 'L1', 1, [slab.id])
  const snapshot: Record<string, AnyNode> = { [slab.id]: slab }

  const layout = buildFloorPlanLayout(level, snapshot, DEFAULT_OPTS)
  const hasScaleBar = layout.annotations.some(
    (a) => /\bft\b|\bm\b/i.test(a.text) && /scale/i.test(a.text),
  )
  expect(hasScaleBar).toBe(true)
})

test('two rooms with hazard_class → two hatches emitted', () => {
  const slab = makeSlab('slab_h', [[0, 0], [40, 0], [40, 25], [0, 25]])
  const ra1 = makeRemoteArea('ra_1', [[2, 2], [10, 2], [10, 8], [2, 8]], 'light')
  const ra2 = makeRemoteArea('ra_2', [[15, 5], [25, 5], [25, 15], [15, 15]], 'ordinary_group_2')
  const level = makeLevel('lvl_h', 'Level 1', 1, [slab.id])
  const snapshot: Record<string, AnyNode> = {
    [slab.id]: slab,
    [ra1.id]: ra1,
    [ra2.id]: ra2,
  }

  const layout = buildFloorPlanLayout(level, snapshot, DEFAULT_OPTS)
  expect(layout.hatches).toHaveLength(2)
  // Hazard colors differ by class — sanity check both came through.
  const colors = new Set(layout.hatches.map((h) => h.color))
  expect(colors.size).toBe(2)
})
