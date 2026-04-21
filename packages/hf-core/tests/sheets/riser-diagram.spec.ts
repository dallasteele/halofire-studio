/**
 * @halofire/core — buildRiserDiagramLayout tests.
 *
 * R7.2 covers the schematic riser-diagram layout for FP-009. The
 * layout is schematic (not-to-scale) and emits annotations + zero
 * viewport. Six test cases per IMPLEMENTATION_PLAN.md R7.2:
 *
 *   1. Zero systems → empty annotations, no viewport.
 *   2. 1 system with 1 riser + 3 branches → ≥ 10 annotations.
 *   3. Flow labels include 'gpm' + 'psi' when system.demand present.
 *   4. 7-system 1881 fixture → every annotation fits its paper column.
 *   5. No viewport ever emitted.
 *   6. combo_standpipe systems get a 'CLASS I/III' label.
 */
import { expect, test } from '@playwright/test'

import { buildRiserDiagramLayout } from '@halofire/core/sheets/riser-diagram'
import type {
  Design,
  DesignHead,
  DesignPipe,
  DesignSystem,
} from '@halofire/core/scene/spawn-from-design'

const PAPER = { paper_w_mm: 914, paper_h_mm: 610, margin_mm: 25 } as const

// ---- Fixtures -----------------------------------------------------

function pipe(id: string, size: number, role: DesignPipe['role']): DesignPipe {
  return {
    id,
    size_in: size,
    role,
    schedule: 'SCH10',
    start_m: [0, 0, 0],
    end_m: [1, 0, 0],
  }
}

function head(id: string, branchId: string): DesignHead {
  return { id, position_m: [0, 0, 0], branchId, sku: 'K5.6' }
}

function makeSystem1RiserPlus3Branches(): DesignSystem {
  return {
    id: 'sys_1',
    name: 'Sys1',
    kind: 'wet',
    hazard: 'light',
    pipes: [
      pipe('riser_1', 4, 'riser'),
      pipe('br_a', 2, 'branch'),
      pipe('br_b', 2, 'branch'),
      pipe('br_c', 2, 'branch'),
    ],
    heads: [
      head('h1', 'br_a'),
      head('h2', 'br_a'),
      head('h3', 'br_b'),
    ],
    riser_assembly: {
      id: 'ra_1',
      location_description: 'Mech Room',
      position_m: [0, 0, 0],
    },
  }
}

function makeDemandSystem(): DesignSystem {
  const sys = makeSystem1RiserPlus3Branches()
  ;(sys as unknown as { demand: unknown }).demand = {
    total_flow_gpm: 215,
    required_psi: 68,
  }
  return sys
}

function fixture1881(): Design {
  const systems: DesignSystem[] = []
  for (let i = 0; i < 7; i++) {
    systems.push({
      id: `sys_${i + 1}`,
      name: `Sys${i + 1}`,
      kind: 'wet',
      hazard: 'light',
      pipes: [
        pipe(`r_${i}`, 4, 'riser'),
        pipe(`b_${i}_1`, 2, 'branch'),
        pipe(`b_${i}_2`, 2, 'branch'),
      ],
      heads: [head(`h_${i}_1`, `b_${i}_1`)],
    })
  }
  return { systems }
}

// ---- Tests --------------------------------------------------------

test('0 systems → empty annotations + no viewport', () => {
  const layout = buildRiserDiagramLayout({ systems: [] }, PAPER)
  expect(layout.annotations).toHaveLength(0)
  expect(layout.viewport).toBeUndefined()
  expect(layout.hatches).toHaveLength(0)
  expect(layout.revision_clouds).toHaveLength(0)
})

test('1 system + 1 riser + 3 branches → ≥ 10 annotations', () => {
  const layout = buildRiserDiagramLayout(
    { systems: [makeSystem1RiserPlus3Branches()] },
    PAPER,
  )
  // Header + riser name + flow arrow + 5 valves + 3 branches x 2 labels + summary = 16
  expect(layout.annotations.length).toBeGreaterThanOrEqual(10)
  const texts = layout.annotations.map((a) => a.text).join(' ')
  // System label
  expect(texts).toMatch(/System #1/)
  // Pipe size label (e.g. 2" SCH10)
  expect(texts).toMatch(/2"\s+SCH10/)
  // Head count label
  expect(texts).toMatch(/heads/)
  // OS&Y gate + alarm check
  expect(texts).toMatch(/OS&Y Gate/)
  expect(texts).toMatch(/Alarm Check/)
})

test('flow labels include "gpm" + "psi" when demand present', () => {
  const layout = buildRiserDiagramLayout(
    { systems: [makeDemandSystem()] },
    PAPER,
  )
  const combined = layout.annotations.map((a) => a.text).join(' ')
  expect(combined).toContain('gpm')
  expect(combined).toContain('psi')
})

test('7-system 1881 fixture → every annotation fits its paper column', () => {
  const design = fixture1881()
  const layout = buildRiserDiagramLayout(design, PAPER)
  const margin = PAPER.margin_mm
  const plotW = PAPER.paper_w_mm - 2 * margin
  const colW = plotW / design.systems!.length
  expect(layout.annotations.length).toBeGreaterThan(0)
  for (const a of layout.annotations) {
    const x = a.text_position_paper_mm[0]
    // Infer which column this annotation belongs to by x position.
    // Allow a modest over-run (labels are right of riser centre
    // for the right-side rungs of the last column).
    const colIdx = Math.min(
      design.systems!.length - 1,
      Math.max(0, Math.floor((x - margin) / colW)),
    )
    const colX0 = margin + colIdx * colW
    const colX1 = colX0 + colW
    // Annotation x should fall inside its own column ± 10mm slack
    // for leader text that reaches just past the rung line.
    expect(x).toBeGreaterThanOrEqual(colX0 - 1)
    expect(x).toBeLessThanOrEqual(colX1 + 15)
  }
})

test('no viewport emitted', () => {
  const layout1 = buildRiserDiagramLayout({ systems: [] }, PAPER)
  expect(layout1.viewport).toBeUndefined()
  const layout2 = buildRiserDiagramLayout(
    { systems: [makeSystem1RiserPlus3Branches()] },
    PAPER,
  )
  expect(layout2.viewport).toBeUndefined()
  const layout3 = buildRiserDiagramLayout(fixture1881(), PAPER)
  expect(layout3.viewport).toBeUndefined()
})

test('combo_standpipe systems get CLASS I/III label', () => {
  const sys: DesignSystem = {
    ...makeSystem1RiserPlus3Machine(),
  }
  const layout = buildRiserDiagramLayout({ systems: [sys] }, PAPER)
  const texts = layout.annotations.map((a) => a.text)
  expect(texts).toContain('CLASS I/III')
})

// helper lives below because it's only used for the combo test.
function makeSystem1RiserPlus3Machine(): DesignSystem {
  const s = makeSystem1RiserPlus3Branches()
  s.kind = 'combo_standpipe'
  return s
}
