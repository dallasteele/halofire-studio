/**
 * @halofire/core — translate-slice tests (R4.2).
 *
 * Exercise translateDesignSliceToNodes across every streaming stage
 * the halofire-cad orchestrator emits. The fixtures match the
 * Pydantic model_dump shapes from services/halofire-cad/cad/schema.py.
 */
import type { AnyNode } from '@pascal-app/core/schema'
import { expect, test } from '@playwright/test'

import {
  translateDesignSliceToNodes,
  type SliceTranslation,
  type StageEvent,
} from '@halofire/core/scene/translate-slice'

/** Build an existing-node map from a fresh translation's creates. */
function ingest(tr: SliceTranslation): Record<string, AnyNode> {
  const map: Record<string, AnyNode> = {}
  for (const op of tr.creates) {
    map[op.node.id] = op.node
  }
  return map
}

function makeIntakeEvent(levelCount: number, wallsPerLevel: number): StageEvent {
  const levels = []
  for (let i = 0; i < levelCount; i++) {
    const walls = []
    for (let w = 0; w < wallsPerLevel; w++) {
      walls.push({
        id: `w_${i}_${w}`,
        start_m: [w, 0],
        end_m: [w + 1, 0],
        thickness_m: 0.2,
        height_m: 3,
        is_exterior: false,
        openings: [],
      })
    }
    levels.push({
      id: `lvl_${i}`,
      name: `Floor ${i + 1}`,
      elevation_m: i * 3,
      height_m: 3,
      use: 'office',
      polygon_m: [[0, 0], [10, 0], [10, 10], [0, 10]],
      rooms: [],
      walls,
      openings: [],
      obstructions: [],
      ceiling: { height_m: 3, kind: 'flat', slope_deg: 0 },
      stair_shafts: [],
      elevator_shafts: [],
      mech_rooms: [],
      metadata: {},
    })
  }
  return {
    step: 'intake',
    done: true,
    levels: levelCount,
    walls: levelCount * wallsPerLevel,
    rooms: 0,
    slice: {
      building: {
        project_id: 'p1',
        levels,
        construction_type: 'V-B',
        total_sqft: 10_000,
        metadata: {},
      },
    },
  }
}

test.describe('translateDesignSliceToNodes — per-stage shapes', () => {
  test('intake slice with 3 levels emits site + building + levels + slabs + ceilings + walls', () => {
    const ev = makeIntakeEvent(3, 4)
    const tr = translateDesignSliceToNodes(ev, {})

    const byType: Record<string, number> = {}
    for (const op of tr.creates) {
      byType[op.node.type] = (byType[op.node.type] ?? 0) + 1
    }

    expect(byType.site).toBe(1)
    expect(byType.building).toBe(1)
    expect(byType.level).toBe(3)
    expect(byType.slab).toBe(3)
    expect(byType.ceiling).toBe(3)
    expect(byType.wall).toBe(12) // 3 * 4
    expect(tr.updates).toEqual([])
    expect(tr.deletes).toEqual([])
  })

  test('place slice with 5 heads emits 5 sprinkler_head creates', () => {
    const ev: StageEvent = {
      step: 'place',
      head_count: 5,
      slice: {
        sprinkler_heads: Array.from({ length: 5 }, (_, i) => ({
          id: `h_${i}`,
          sku: 'SM_Head_Pendant_Standard_K56',
          k_factor: 5.6,
          temp_rating_f: 155,
          position_m: [i, 2.5, 0],
          orientation: 'pendent',
          room_id: null,
        })),
      },
    }
    const tr = translateDesignSliceToNodes(ev, {})
    expect(tr.creates).toHaveLength(5)
    for (const op of tr.creates) {
      expect(op.node.type).toBe('sprinkler_head')
    }
  })

  test('route slice with 2 systems + 10 pipes + 4 fittings emits correct counts', () => {
    const ev: StageEvent = {
      step: 'route',
      system_count: 2,
      pipe_count: 10,
      hanger_count: 0,
      slice: {
        systems: [0, 1].map((s) => ({
          id: `sys_${s}`,
          type: 'wet',
          supplies: [],
          riser: { id: `r_${s}`, position_m: [0, 0, 0], size_in: 4 },
          branches: [],
          heads: [],
          pipes: Array.from({ length: 5 }, (_, p) => ({
            id: `sys${s}_p${p}`,
            from_node: 'a',
            to_node: 'b',
            size_in: 2,
            schedule: 'sch10',
            start_m: [p, 0, 2.5],
            end_m: [p + 1, 0, 2.5],
            length_m: 1,
            role: 'branch',
            downstream_heads: 1,
          })),
          fittings: Array.from({ length: 2 }, (_, f) => ({
            id: `sys${s}_f${f}`,
            kind: 'elbow_90',
            size_in: 2,
            position_m: [f, 0, 2.5],
            equiv_length_ft: 2,
          })),
          hangers: [],
        })),
      },
    }
    const tr = translateDesignSliceToNodes(ev, {})
    const byType: Record<string, number> = {}
    for (const op of tr.creates) {
      byType[op.node.type] = (byType[op.node.type] ?? 0) + 1
    }
    expect(byType.system).toBe(2)
    expect(byType.pipe).toBe(10)
    expect(byType.fitting).toBe(4)
  })

  test('hydraulic slice emits updates on existing systems, no creates', () => {
    const routeEv: StageEvent = {
      step: 'route',
      slice: {
        systems: [{
          id: 'sys_1',
          type: 'wet',
          supplies: [],
          riser: { id: 'r_1', position_m: [0, 0, 0], size_in: 4 },
          branches: [],
          heads: [],
          pipes: [],
          fittings: [],
          hangers: [],
        }],
      },
    }
    const existing = ingest(translateDesignSliceToNodes(routeEv, {}))

    const hydEv: StageEvent = {
      step: 'hydraulic',
      slice: {
        systems: [{
          id: 'sys_1',
          type: 'wet',
          supplies: [],
          riser: { id: 'r_1', position_m: [0, 0, 0], size_in: 4 },
          branches: [],
          heads: [],
          pipes: [],
          fittings: [],
          hangers: [],
          hydraulic: {
            design_area_sqft: 1500,
            density_gpm_per_sqft: 0.1,
            required_flow_gpm: 160,
            required_pressure_psi: 50,
            supply_static_psi: 75,
            supply_residual_psi: 60,
            supply_flow_gpm: 500,
            demand_at_base_of_riser_psi: 50,
            safety_margin_psi: 10,
          },
        }],
      },
    }
    const tr = translateDesignSliceToNodes(hydEv, existing)
    expect(tr.creates).toEqual([])
    expect(tr.updates).toHaveLength(1)
    expect(tr.updates[0]?.id).toBe('system_sys_1')
    const patch = tr.updates[0]?.patch as { demand?: { required_psi?: number } }
    expect(patch.demand?.required_psi).toBe(50)
  })

  test('rulecheck slice with issues produces zero creates', () => {
    const ev: StageEvent = {
      step: 'rulecheck',
      error_count: 1,
      warning_count: 1,
      slice: {
        issues: [
          { code: 'X', severity: 'error', message: 'bad', refs: ['nothing'], source: 'x' },
        ],
      },
    }
    const tr = translateDesignSliceToNodes(ev, {})
    expect(tr.creates).toEqual([])
  })

  test('bom / labor / proposal slices emit empty translation', () => {
    for (const step of ['bom', 'labor', 'proposal', 'submittal', 'done'] as const) {
      const ev: StageEvent = { step, slice: {} }
      const tr = translateDesignSliceToNodes(ev, {})
      expect(tr.creates).toEqual([])
      expect(tr.updates).toEqual([])
      expect(tr.deletes).toEqual([])
    }
  })

  test('re-applying the place slice twice emits zero new creates', () => {
    const ev: StageEvent = {
      step: 'place',
      slice: {
        sprinkler_heads: Array.from({ length: 5 }, (_, i) => ({
          id: `h_${i}`,
          sku: 'SM_Head_Pendant_Standard_K56',
          k_factor: 5.6,
          position_m: [i, 2.5, 0],
          orientation: 'pendent',
        })),
      },
    }
    const first = translateDesignSliceToNodes(ev, {})
    expect(first.creates).toHaveLength(5)
    const existing = ingest(first)
    const second = translateDesignSliceToNodes(ev, existing)
    expect(second.creates).toHaveLength(0)
    // Updates may fire for `visible` default mismatch, but never exceed the create count.
    expect(second.updates.length).toBeLessThanOrEqual(5)
  })

  test('slice with missing required field emits empty translation (no throw)', () => {
    // No slice at all.
    const noSlice: StageEvent = { step: 'place' }
    const tr1 = translateDesignSliceToNodes(noSlice, {})
    expect(tr1.creates).toEqual([])
    // Slice present but empty.
    const emptySlice: StageEvent = { step: 'place', slice: {} }
    const tr2 = translateDesignSliceToNodes(emptySlice, {})
    expect(tr2.creates).toEqual([])
    // Head with missing id / position — we still emit with defaults.
    const partial: StageEvent = {
      step: 'place',
      slice: {
        sprinkler_heads: [{ sku: 'X', k_factor: 5.6, orientation: 'pendent' }],
      },
    }
    const tr3 = translateDesignSliceToNodes(partial, {})
    expect(tr3.creates).toHaveLength(1)
  })

  test('PipeNode preserves start_m / end_m from slice data', () => {
    const ev: StageEvent = {
      step: 'route',
      slice: {
        systems: [{
          id: 'sys_1',
          type: 'wet',
          supplies: [], branches: [], heads: [], fittings: [], hangers: [],
          riser: { id: 'r', position_m: [0, 0, 0], size_in: 4 },
          pipes: [{
            id: 'p_a',
            from_node: 'a', to_node: 'b',
            size_in: 2,
            schedule: 'sch10',
            start_m: [1.5, 2.25, 2.7],
            end_m: [4.5, 2.25, 2.7],
            length_m: 3,
            role: 'branch',
            downstream_heads: 2,
          }],
        }],
      },
    }
    const tr = translateDesignSliceToNodes(ev, {})
    const pipe = tr.creates.find((c) => c.node.type === 'pipe')?.node as
      | { start_m: [number, number, number]; end_m: [number, number, number] }
      | undefined
    expect(pipe?.start_m).toEqual([1.5, 2.25, 2.7])
    expect(pipe?.end_m).toEqual([4.5, 2.25, 2.7])
  })

  test('SprinklerHead preserves k_factor, sku, orientation from slice data', () => {
    const ev: StageEvent = {
      step: 'place',
      slice: {
        sprinkler_heads: [{
          id: 'h_esfr',
          sku: 'TY-B TY1234',
          k_factor: 14.0,
          position_m: [3, 3, 3],
          orientation: 'upright',
        }],
      },
    }
    const tr = translateDesignSliceToNodes(ev, {})
    const head = tr.creates[0]?.node as
      | { k_factor: number; sku: string; orientation: string }
      | undefined
    expect(head?.k_factor).toBe(14.0)
    expect(head?.sku).toBe('TY-B TY1234')
    expect(head?.orientation).toBe('upright')
  })
})
