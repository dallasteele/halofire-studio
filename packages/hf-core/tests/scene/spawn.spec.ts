/**
 * @halofire/core — translateDesignToScene tests.
 *
 * Pure translator. Runs under Playwright test runner (via the hf-core
 * project in apps/editor/playwright.config.ts). Exercises the eight
 * contract points from docs/IMPLEMENTATION_PLAN.md Phase R2.1:
 *
 *   1. Empty Design (no systems) → only Site + Building + Levels.
 *   2. Design with 1 system / 2 heads / 3 pipes → correct counts.
 *   3. Ordering: building before level, level before slab, system
 *      before pipe, pipe before head.
 *   4. max_heads cap: 500 heads → default 150 emitted.
 *   5. max_pipes cap: analogous.
 *   6. Heads emit as type='sprinkler_head' (NOT type='item').
 *   7. Pipes emit as type='pipe' with start_m/end_m intact.
 *   8. RemoteArea emits if present.
 */
import { expect, test } from '@playwright/test'

import {
  type Design,
  type NodeCreateOp,
  translateDesignToScene,
} from '@halofire/core/scene/spawn-from-design'

// ---- Helpers ------------------------------------------------------

function makeLevel(id: string, idx: number): Design['building'] extends
  | infer B
  | undefined
  ? never
  : never
// helper overload: just return shape
// Simpler: regular function typed loosely — we assert with explicit
// types at call sites.
function makeLevelSimple(id: string, idx: number) {
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
    ] as [number, number][],
  }
}

/** Tiny golden Design — 6 levels, 2 systems, 10 heads, 20 pipes,
 *  5 fittings, 3 remote areas. Mirrors the blueprint's §3 slice
 *  emission contract. */
function goldenDesign(): Design {
  const levels = Array.from({ length: 6 }, (_, i) => makeLevelSimple(`arch_l${i}`, i))
  const heads = Array.from({ length: 10 }, (_, i) => ({
    id: `head_${i}`,
    position_m: [1 + i, 2.9, 1 + i] as [number, number, number],
    sku: 'TY-B TY3251',
    k_factor: 5.6,
    orientation: 'pendant' as const,
  }))
  const pipesSys1 = Array.from({ length: 10 }, (_, i) => ({
    id: `pipe1_${i}`,
    size_in: 2,
    start_m: [i, 2.8, 0] as [number, number, number],
    end_m: [i + 1, 2.8, 0] as [number, number, number],
    role: 'branch' as const,
  }))
  const pipesSys2 = Array.from({ length: 10 }, (_, i) => ({
    id: `pipe2_${i}`,
    size_in: 2.5,
    start_m: [i, 2.8, 5] as [number, number, number],
    end_m: [i + 1, 2.8, 5] as [number, number, number],
    role: 'cross_main' as const,
  }))
  const fittings = Array.from({ length: 5 }, (_, i) => ({
    id: `fit_${i}`,
    kind: 'tee' as const,
    size_in: 2,
    position_m: [i, 2.8, 0] as [number, number, number],
  }))

  return {
    building: {
      id: 'bld_1',
      name: '1881 Cooperative',
      levels,
    },
    systems: [
      {
        id: 'sys_1',
        name: 'Wet system 1',
        kind: 'wet',
        hazard: 'light',
        heads: heads.slice(0, 5),
        pipes: pipesSys1,
        fittings,
        hangers: [],
        riser_assembly: {
          id: 'riser_1',
          location_description: 'Riser room A',
        },
      },
      {
        id: 'sys_2',
        name: 'Wet system 2',
        kind: 'wet',
        hazard: 'ordinary_group_1',
        heads: heads.slice(5),
        pipes: pipesSys2,
        fittings: [],
        hangers: [],
      },
    ],
    remote_areas: [
      {
        id: 'ra_1',
        polygon_m: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
        hazard_class: 'light',
        is_most_remote: true,
      },
      {
        id: 'ra_2',
        polygon_m: [
          [5, 5],
          [10, 5],
          [10, 10],
          [5, 10],
        ],
        hazard_class: 'ordinary_group_1',
      },
      {
        id: 'ra_3',
        polygon_m: [
          [0, 5],
          [5, 5],
          [5, 10],
          [0, 10],
        ],
        hazard_class: 'light',
      },
    ],
  }
}

function count(ops: NodeCreateOp[], type: string): number {
  return ops.filter((o) => o.node.type === type).length
}

function firstIndex(ops: NodeCreateOp[], type: string): number {
  return ops.findIndex((o) => o.node.type === type)
}

// ---- Tests --------------------------------------------------------

test.describe('@halofire/core — translateDesignToScene', () => {
  test('1. Empty Design → only Site + Building (no levels, systems, heads, pipes)', () => {
    const ops = translateDesignToScene({})
    expect(count(ops, 'site')).toBe(1)
    expect(count(ops, 'building')).toBe(1)
    expect(count(ops, 'level')).toBe(0)
    expect(count(ops, 'system')).toBe(0)
    expect(count(ops, 'sprinkler_head')).toBe(0)
    expect(count(ops, 'pipe')).toBe(0)
    expect(count(ops, 'remote_area')).toBe(0)
  })

  test('2. 1 system / 2 heads / 3 pipes → correct counts + one level', () => {
    const design: Design = {
      building: {
        levels: [makeLevelSimple('arch_l0', 0)],
      },
      systems: [
        {
          id: 'sys_1',
          heads: [
            { id: 'h1', position_m: [0, 2.9, 0], k_factor: 5.6, orientation: 'pendant' },
            { id: 'h2', position_m: [1, 2.9, 0], k_factor: 5.6, orientation: 'pendant' },
          ],
          pipes: [
            { id: 'p1', size_in: 2, start_m: [0, 2.8, 0], end_m: [1, 2.8, 0] },
            { id: 'p2', size_in: 2, start_m: [1, 2.8, 0], end_m: [2, 2.8, 0] },
            { id: 'p3', size_in: 2, start_m: [2, 2.8, 0], end_m: [3, 2.8, 0] },
          ],
        },
      ],
    }
    const ops = translateDesignToScene(design)
    expect(count(ops, 'system')).toBe(1)
    expect(count(ops, 'sprinkler_head')).toBe(2)
    expect(count(ops, 'pipe')).toBe(3)
    expect(count(ops, 'level')).toBe(1)
    expect(count(ops, 'slab')).toBe(1)
    expect(count(ops, 'ceiling')).toBe(1)
    expect(count(ops, 'building')).toBe(1)
  })

  test('3. Ordering: building < level < slab, system < pipe < head', () => {
    const ops = translateDesignToScene(goldenDesign())
    const iBuilding = firstIndex(ops, 'building')
    const iLevel = firstIndex(ops, 'level')
    const iSlab = firstIndex(ops, 'slab')
    const iSystem = firstIndex(ops, 'system')
    const iPipe = firstIndex(ops, 'pipe')
    const iHead = firstIndex(ops, 'sprinkler_head')
    expect(iBuilding).toBeLessThan(iLevel)
    expect(iLevel).toBeLessThan(iSlab)
    expect(iSystem).toBeLessThan(iPipe)
    expect(iPipe).toBeLessThan(iHead)
  })

  test('4. max_heads cap: 500 heads → default 150 emitted', () => {
    const heads = Array.from({ length: 500 }, (_, i) => ({
      id: `h_${i}`,
      position_m: [i, 2.9, 0] as [number, number, number],
      k_factor: 5.6,
      orientation: 'pendant' as const,
    }))
    const design: Design = {
      building: { levels: [makeLevelSimple('arch_l0', 0)] },
      systems: [{ id: 'sys_1', heads, pipes: [] }],
    }
    const ops = translateDesignToScene(design)
    expect(count(ops, 'sprinkler_head')).toBe(150)
  })

  test('5. max_pipes cap: 500 pipes → default 150 emitted', () => {
    const pipes = Array.from({ length: 500 }, (_, i) => ({
      id: `p_${i}`,
      size_in: 2,
      start_m: [i, 2.8, 0] as [number, number, number],
      end_m: [i + 1, 2.8, 0] as [number, number, number],
    }))
    const design: Design = {
      building: { levels: [makeLevelSimple('arch_l0', 0)] },
      systems: [{ id: 'sys_1', heads: [], pipes }],
    }
    const ops = translateDesignToScene(design)
    expect(count(ops, 'pipe')).toBe(150)
  })

  test('6. Heads emit as type=sprinkler_head (NOT type=item)', () => {
    const ops = translateDesignToScene(goldenDesign())
    const headOps = ops.filter((o) => o.node.type === 'sprinkler_head')
    expect(headOps.length).toBeGreaterThan(0)
    // NO head should masquerade as an ItemNode.
    const itemHeads = ops.filter(
      (o) => o.node.type === 'item' && (o.node.asset?.category as string | undefined)?.includes('sprinkler'),
    )
    expect(itemHeads).toEqual([])
    // Required first-class fields populated.
    for (const h of headOps) {
      expect(typeof h.node.k_factor).toBe('number')
      expect(typeof h.node.sku).toBe('string')
      expect(h.node.orientation).toBeDefined()
    }
  })

  test('7. Pipes emit as type=pipe with start_m/end_m intact', () => {
    const design: Design = {
      building: { levels: [makeLevelSimple('arch_l0', 0)] },
      systems: [
        {
          id: 'sys_1',
          heads: [],
          pipes: [
            {
              id: 'p_known',
              size_in: 4,
              start_m: [1.5, 2.8, 7.25],
              end_m: [9.125, 2.8, 7.25],
              role: 'cross_main',
            },
          ],
        },
      ],
    }
    const ops = translateDesignToScene(design)
    const pipes = ops.filter((o) => o.node.type === 'pipe')
    expect(pipes).toHaveLength(1)
    const p = pipes[0]!.node
    expect(p.start_m).toEqual([1.5, 2.8, 7.25])
    expect(p.end_m).toEqual([9.125, 2.8, 7.25])
    expect(p.size_in).toBe(4)
    expect(p.role).toBe('cross_main')
    expect(p.schedule).toBe('SCH10')
  })

  test('8. RemoteArea emits if present', () => {
    const ops = translateDesignToScene(goldenDesign())
    expect(count(ops, 'remote_area')).toBe(3)
    const mostRemote = ops.filter(
      (o) => o.node.type === 'remote_area' && o.node.is_most_remote === true,
    )
    expect(mostRemote).toHaveLength(1)

    // And: a Design with no remote_areas emits zero.
    const none = translateDesignToScene({
      building: { levels: [makeLevelSimple('arch_l0', 0)] },
      systems: [],
    })
    expect(count(none, 'remote_area')).toBe(0)
  })
})
