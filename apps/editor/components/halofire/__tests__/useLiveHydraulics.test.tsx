import { describe, expect, test } from 'bun:test'

import { _internals, normalizeSnapshot } from '@/lib/hooks/useLiveHydraulics'
import type { RunHydraulicResponse } from '@/lib/ipc.types'

describe('useLiveHydraulics pure helpers', () => {
  test('classifyVelocity: under 20 ft/s is ok', () => {
    expect(_internals.classifyVelocity(0)).toBe('ok')
    expect(_internals.classifyVelocity(12)).toBe('ok')
    expect(_internals.classifyVelocity(19.99)).toBe('ok')
  })

  test('classifyVelocity: 20-32 ft/s warns, ≥ 32 critical', () => {
    expect(_internals.classifyVelocity(20)).toBe('warn')
    expect(_internals.classifyVelocity(25.5)).toBe('warn')
    expect(_internals.classifyVelocity(31.99)).toBe('warn')
    expect(_internals.classifyVelocity(32)).toBe('critical')
    expect(_internals.classifyVelocity(45)).toBe('critical')
  })

  test('classifyVelocity: null/NaN → ok (no data, no alarm)', () => {
    expect(_internals.classifyVelocity(null)).toBe('ok')
    expect(_internals.classifyVelocity(Number.NaN)).toBe('ok')
  })

  test('HYDRAULIC_OPS set contains the mutation ops that matter', () => {
    for (const op of ['insert_head', 'insert_pipe', 'undo', 'redo']) {
      expect(_internals.HYDRAULIC_OPS.has(op)).toBe(true)
    }
    // Ops we never trigger recalc for:
    expect(_internals.HYDRAULIC_OPS.has('layer-visibility')).toBe(false)
    expect(_internals.HYDRAULIC_OPS.has('rules_run')).toBe(false)
  })
})

describe('normalizeSnapshot', () => {
  test('builds headline + per-node map from node_trace', () => {
    const response: RunHydraulicResponse = {
      systems: [
        {
          id: 'sys-1',
          hydraulic: {
            required_flow_gpm: 200,
            required_pressure_psi: 42,
            safety_margin_psi: 18,
            supply_residual_psi: 65,
            demand_at_base_of_riser_psi: 60,
            critical_path: ['pipe_1', 'head_a'],
            node_trace: [
              {
                segment_id: 'pipe_1',
                pressure_start_psi: 65,
                pressure_end_psi: 58,
                flow_gpm: 100,
                velocity_fps: 22,
                size_in: 1.0,
              },
              {
                segment_id: 'head_a',
                pressure_psi: 55,
                flow_gpm: 25,
                velocity_fps: 8,
                size_in: 0.5,
              },
              {
                segment_id: 'pipe_2',
                pressure_end_psi: 50,
                velocity_fps: 35,
                flow_gpm: 30,
                size_in: 0.75,
              },
            ],
            issues: ['TEST_ISSUE'],
          },
        },
      ],
    }
    const snap = normalizeSnapshot(response)
    expect(snap.headline.required_flow_gpm).toBe(200)
    expect(snap.headline.safety_margin_psi).toBe(18)
    // pipe_1 (22 ft/s) = warn, pipe_2 (35 ft/s) = critical → 2 warnings
    expect(snap.headline.velocity_warnings).toBe(2)
    expect(snap.nodes['pipe_1']?.severity).toBe('warn')
    expect(snap.nodes['pipe_1']?.on_critical_path).toBe(true)
    expect(snap.nodes['head_a']?.severity).toBe('ok')
    expect(snap.nodes['head_a']?.on_critical_path).toBe(true)
    expect(snap.nodes['pipe_2']?.severity).toBe('critical')
    expect(snap.nodes['pipe_2']?.on_critical_path).toBe(false)
    // pressure comes from end_psi when available; head_a uses pressure_psi.
    expect(snap.nodes['pipe_1']?.pressure_psi).toBe(58)
    expect(snap.nodes['head_a']?.pressure_psi).toBe(55)
  })

  test('empty systems produce a safe nullable headline', () => {
    const snap = normalizeSnapshot({ systems: [] })
    expect(snap.headline.required_flow_gpm).toBeNull()
    expect(snap.headline.safety_margin_psi).toBeNull()
    expect(snap.headline.velocity_warnings).toBe(0)
    expect(Object.keys(snap.nodes).length).toBe(0)
  })

  test('non-array systems field does not throw', () => {
    const snap = normalizeSnapshot({ systems: null as unknown as never[] })
    expect(snap.headline.required_flow_gpm).toBeNull()
  })
})
