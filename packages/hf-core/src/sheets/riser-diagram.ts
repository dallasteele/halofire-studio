/**
 * buildRiserDiagramLayout — schematic (not-to-scale) riser-diagram
 * layout for the FP-009 Riser Diagram sheet (blueprint 07 §4,
 * IMPLEMENTATION_PLAN Phase R7.2).
 *
 * A fire-protection riser diagram is schematic: it shows each
 * system's vertical riser stack (OS&Y gate → alarm/dry valve →
 * trim → control valve → test/drain), the branch lines peeling off
 * the riser with size + role + flow labels, and the head-count on
 * each branch. It is explicitly NOT scaled — it is a ladder graph.
 *
 * Layout (pure math, no three.js, no DOM):
 *   - Paper gets sliced into N equal columns, one per SystemNode.
 *   - Each column contains:
 *       • A column-centred vertical line = the riser.
 *       • A valve stack stacked bottom-up at the base of the riser.
 *       • Up to 8 horizontal "rungs" alternating left/right off
 *         the riser — each rung is one branch line. Rungs carry
 *         labels for size, schedule, role, flow, and head count.
 *       • A system header annotation at the top of the column.
 *   - Systems with `kind: 'combo_standpipe'` also get a
 *     CLASS I/III sentinel label.
 *
 * Contract:
 *   - Pure TypeScript. No viewport emitted — riser diagrams are
 *     SVG-only schematic; `viewport` is always `undefined`.
 *   - No hatches (reserved for future hazard-band fills).
 *   - No revision clouds on first emit.
 *   - Zero systems → empty annotations.
 */
import type { Annotation, Hatch, RevisionCloud, Viewport } from '@pascal-app/core/schema'

import type { Design, DesignPipe, DesignSystem } from '../scene/spawn-from-design.js'

// ------------------------------------------------------------------
// Public types
// ------------------------------------------------------------------

export interface RiserDiagramOpts {
  /** Paper width (mm). ARCH_D landscape = 914. */
  paper_w_mm: number
  /** Paper height (mm). ARCH_D landscape = 610. */
  paper_h_mm: number
  /** Margin (mm) around the plotable area. Default 25. */
  margin_mm?: number
}

export interface RiserDiagramLayout {
  /** Annotations emitted onto the SheetNode (svg text + lines). */
  annotations: Annotation[]
  /** Hatches for flow-direction fills. Empty for V1. */
  hatches: Hatch[]
  /** Revision-cloud-worthy issues, if any. Usually empty. */
  revision_clouds: RevisionCloud[]
  /**
   * A single viewport, or none. Riser diagrams are typically
   * schematic (no 3D) — this is always `undefined` in V1.
   */
  viewport?: Viewport
}

// ------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------

let __seq = 0
function nid(prefix: string): string {
  __seq++
  const rnd = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  return `${prefix}_${rnd}${__seq.toString(36)}`
}

/**
 * Optional hydraulic-demand payload we MAY see on a SystemNode-like
 * design input. `DesignSystem` does not declare `demand` directly
 * (the pipeline populates it on the spawned SystemNode during
 * translate-slice), so we read it loosely and fall back to
 * `supply.flow_gpm` / `supply.residual_psi` when absent.
 */
type DemandLike = {
  total_flow_gpm?: number
  sprinkler_flow_gpm?: number
  required_psi?: number
}

function readDemand(sys: DesignSystem): DemandLike | null {
  const raw = (sys as unknown as { demand?: DemandLike }).demand
  if (raw && (raw.total_flow_gpm || raw.sprinkler_flow_gpm || raw.required_psi)) {
    return raw
  }
  if (sys.supply) {
    return {
      total_flow_gpm: sys.supply.flow_gpm,
      required_psi: sys.supply.residual_psi,
    }
  }
  return null
}

function fmtHazard(h: DesignSystem['hazard']): string {
  switch (h) {
    case 'light': return 'Light Hazard'
    case 'ordinary_group_1': return 'OH-1'
    case 'ordinary_group_2': return 'OH-2'
    case 'extra_group_1': return 'EH-1'
    case 'extra_group_2': return 'EH-2'
    case 'storage': return 'Storage'
    default: return 'Light Hazard'
  }
}

function fmtKind(k: DesignSystem['kind']): string {
  switch (k) {
    case 'wet': return 'Wet'
    case 'dry': return 'Dry'
    case 'preaction': return 'Preaction'
    case 'deluge': return 'Deluge'
    case 'combo_standpipe': return 'Combo Standpipe'
    case 'antifreeze': return 'Antifreeze'
    default: return 'Wet'
  }
}

/**
 * Group a system's pipes into branch rungs. We consider any pipe
 * whose role is `branch`, `cross_main`, or `drop` a candidate rung;
 * `feed_main` / `riser` / `riser_nipple` are vertical-stack lines
 * and don't become rungs. Heads per branch come from the head's
 * branchId matching the pipe id.
 */
function branchesOf(sys: DesignSystem): Array<{
  pipe: DesignPipe
  heads: number
}> {
  const rungRoles = new Set<DesignPipe['role']>(['branch', 'cross_main', 'drop'])
  const pipes = (sys.pipes ?? []).filter((p) => rungRoles.has(p.role ?? 'unknown'))
  const heads = sys.heads ?? []
  return pipes.map((pipe) => ({
    pipe,
    heads: heads.filter((h) => h.branchId === pipe.id).length,
  }))
}

/**
 * Valve stack for a standard wet-pipe riser, bottom-up. Blueprint
 * 07 §4 riser-diagram entry spells out: OS&Y gate, alarm/dry/preaction
 * valve, trim, control (butterfly) valve, test/drain. We emit labels
 * for each of these as annotations along the lower portion of the
 * riser line.
 */
function valveStackFor(sys: DesignSystem, riserSizeIn: number): string[] {
  const sizeStr = `${riserSizeIn}"`
  const alarm =
    sys.kind === 'dry' ? 'Dry Pipe Valve'
    : sys.kind === 'preaction' ? 'Preaction Valve'
    : sys.kind === 'deluge' ? 'Deluge Valve'
    : 'Alarm Check'
  return [
    `OS&Y Gate ${sizeStr}`,
    `${alarm} ${sizeStr}`,
    `Trim ${sizeStr}`,
    `Control Valve ${sizeStr}`,
    `Test & Drain ${sizeStr}`,
  ]
}

/** Pick the best "riser size" for labeling — largest pipe with role
 *  containing 'riser', else largest feed_main, else the largest
 *  pipe. Falls back to 4". */
function riserSizeOf(sys: DesignSystem): number {
  const pipes = sys.pipes ?? []
  const risers = pipes.filter((p) => p.role === 'riser' || p.role === 'riser_nipple')
  const feeds = pipes.filter((p) => p.role === 'feed_main' || p.role === 'feed')
  const pool = risers.length > 0 ? risers : feeds.length > 0 ? feeds : pipes
  if (pool.length === 0) return 4
  let best = 0
  for (const p of pool) if (p.size_in > best) best = p.size_in
  return best || 4
}

function makeLabel(
  id: string,
  text: string,
  position: [number, number],
  style_id = 'halofire.riser.label',
): Annotation {
  return {
    id,
    kind: 'label',
    text,
    text_position_paper_mm: position,
    leader_polyline_mm: [],
    style_id,
  }
}

function makeNote(
  id: string,
  text: string,
  position: [number, number],
): Annotation {
  return {
    id,
    kind: 'note',
    text,
    text_position_paper_mm: position,
    leader_polyline_mm: [],
    style_id: 'halofire.riser.note',
  }
}

// ------------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------------

export function buildRiserDiagramLayout(
  design: Design,
  opts: RiserDiagramOpts,
): RiserDiagramLayout {
  const margin = opts.margin_mm ?? 25
  const systems = design.systems ?? []

  const layout: RiserDiagramLayout = {
    annotations: [],
    hatches: [],
    revision_clouds: [],
    viewport: undefined,
  }

  if (systems.length === 0) {
    return layout
  }

  const plotW = Math.max(10, opts.paper_w_mm - 2 * margin)
  const plotH = Math.max(10, opts.paper_h_mm - 2 * margin)
  const colW = plotW / systems.length
  const maxRungs = 8

  systems.forEach((sys, sysIdx) => {
    // Column x-extents. Riser line sits at column x-center.
    const colX0 = margin + sysIdx * colW
    const riserX = colX0 + colW / 2
    const colTopY = margin + plotH - 10
    const colBotY = margin + 10

    // ---- System header -----------------------------------------
    const headCount = (sys.heads ?? []).length
    const demand = readDemand(sys)
    const demandStr = demand?.total_flow_gpm
      ? `, ${Math.round(demand.total_flow_gpm)} gpm demand`
      : ''
    const headerText =
      `System #${sysIdx + 1} — ${fmtKind(sys.kind)}, ${fmtHazard(sys.hazard)}, ` +
      `${headCount} heads${demandStr}`
    layout.annotations.push(
      makeLabel(nid('ann'), headerText, [colX0 + 5, colTopY], 'halofire.riser.header'),
    )

    // Combo standpipe class marker
    if (sys.kind === 'combo_standpipe') {
      layout.annotations.push(
        makeLabel(
          nid('ann'),
          'CLASS I/III',
          [colX0 + 5, colTopY - 8],
          'halofire.riser.class',
        ),
      )
    }

    // ---- Demand callout (flow + pressure) ----------------------
    if (demand && (demand.total_flow_gpm || demand.required_psi)) {
      const gpm = demand.total_flow_gpm ? `${Math.round(demand.total_flow_gpm)} gpm` : '—'
      const psi = demand.required_psi ? `${Math.round(demand.required_psi)} psi` : '—'
      layout.annotations.push(
        makeNote(
          nid('ann'),
          `Demand: ${gpm} @ ${psi}`,
          [colX0 + 5, colTopY - 16],
        ),
      )
    }

    // ---- Riser / valve stack ------------------------------------
    const riserSize = riserSizeOf(sys)
    const valves = valveStackFor(sys, riserSize)
    // Stack valve labels bottom-up along the lower third of the column.
    const valveBandH = Math.min(plotH * 0.35, valves.length * 10 + 10)
    const valveStep = valveBandH / valves.length
    valves.forEach((label, vi) => {
      const y = colBotY + 5 + vi * valveStep
      layout.annotations.push(
        makeLabel(
          nid('ann'),
          label,
          [riserX + 3, y],
          'halofire.riser.valve',
        ),
      )
    })

    // Riser identification label (column center, above valve stack)
    layout.annotations.push(
      makeLabel(
        nid('ann'),
        `Riser ${riserSize}" ${sys.name ?? `R${sysIdx + 1}`}`,
        [riserX + 3, colBotY + 5 + valveBandH + 6],
        'halofire.riser.name',
      ),
    )

    // Flow-direction arrow annotation (textual sentinel — the
    // renderer turns this into a real arrow glyph).
    layout.annotations.push(
      makeLabel(
        nid('ann'),
        '↑ flow',
        [riserX - 12, (colBotY + colTopY) / 2],
        'halofire.riser.flow',
      ),
    )

    // ---- Branches as rungs --------------------------------------
    const branches = branchesOf(sys).slice(0, maxRungs)
    // Rung band lives above the valve stack, below the header.
    const rungBandTop = colTopY - 22
    const rungBandBot = colBotY + valveBandH + 18
    const bandH = Math.max(20, rungBandTop - rungBandBot)
    const step = branches.length > 0 ? bandH / Math.max(1, branches.length) : 0

    branches.forEach((b, bi) => {
      const y = rungBandBot + bi * step
      const left = bi % 2 === 0 // alternate left/right
      const textX = left ? colX0 + 5 : riserX + 10
      const sizeLabel = `${b.pipe.size_in}" ${b.pipe.schedule ?? 'SCH10'}`
      const roleLabel = b.pipe.role ?? 'branch'
      layout.annotations.push(
        makeLabel(nid('ann'), sizeLabel, [textX, y + 2], 'halofire.riser.pipe-size'),
      )
      layout.annotations.push(
        makeNote(
          nid('ann'),
          `${roleLabel} — ${b.heads} heads`,
          [textX, y - 4],
        ),
      )
    })

    // Summary rung count — always emitted so consumers can verify
    // branch accounting without walking every pipe.
    layout.annotations.push(
      makeLabel(
        nid('ann'),
        `${branches.length} branches`,
        [colX0 + 5, rungBandBot - 6],
        'halofire.riser.summary',
      ),
    )
  })

  return layout
}
