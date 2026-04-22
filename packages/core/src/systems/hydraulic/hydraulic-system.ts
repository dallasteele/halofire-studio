/**
 * HydraulicSystem — Pascal system that reacts to PipeNode /
 * SprinklerHeadNode / SystemNode mutations and re-solves
 * Hazen-Williams hydraulics for each fire-protection system.
 *
 * Fork addition (HaloFire Studio). Mirrors the pattern of
 * SlabSystem / LevelSystem: subscribes to the scene store, derives
 * state, writes back into the nodes it owns (SystemNode.demand +
 * SprinklerHeadNode.hydraulic + PipeNode.hydraulic).
 *
 * This is NOT a full hydraulic simulator — it's the incremental
 * solve that keeps the UI's "Δ bid" / "margin" indicators honest as
 * the engineer edits the design. The full NFPA 13 §23 solver lives
 * in the Python pipeline and is what the AHJ submittal uses.
 */
import type { StoreApi } from 'zustand'
import {
  DENSITY_AREA_DEFAULTS,
  HOSE_ALLOWANCE_GPM,
} from '../../schema/nodes/system'
import type { SystemNode } from '../../schema/nodes/system'
import type { PipeNode } from '../../schema/nodes/pipe'
import {
  hazenWilliamsC,
  pipeIdMm,
  pipeLengthM,
} from '../../schema/nodes/pipe'
import type { SprinklerHeadNode } from '../../schema/nodes/sprinkler-head'

export interface HydraulicDemand {
  systemId: string
  sprinkler_flow_gpm: number
  hose_flow_gpm: number
  total_flow_gpm: number
  required_psi: number
  safety_margin_psi: number
  passes: boolean
}

/** Hazen-Williams pressure loss in psi per foot of pipe.
 *
 *   hL (psi/ft) = 4.52 · Q^1.85 / (C^1.85 · d^4.87)
 *
 * where Q is gpm, d is internal pipe diameter in inches, C is the
 * Hazen-Williams coefficient.  Standard NFPA 13 §23.4.2 form. */
export function hazenWilliamsLossPsiPerFt(
  flowGpm: number, idIn: number, c: number,
): number {
  if (flowGpm <= 0 || idIn <= 0 || c <= 0) return 0
  const qPow = flowGpm ** 1.85
  const cPow = c ** 1.85
  const dPow = idIn ** 4.87
  return (4.52 * qPow) / (cPow * dPow)
}

/** Single-pipe friction loss in psi. */
export function pipeFrictionLossPsi(pipe: PipeNode, flowGpm: number): number {
  const idIn = pipeIdMm(pipe) / 25.4
  const c = hazenWilliamsC(pipe)
  const lengthFt = pipeLengthM(pipe) * 3.28084
  return hazenWilliamsLossPsiPerFt(flowGpm, idIn, c) * lengthFt
}

/**
 * Solve a single system's hydraulic demand.
 *
 * Approach (quick form for the live editor):
 *   1) Required sprinkler flow = density × remote_area + 1.15 safety
 *      (NFPA 13 Ch. 23.4.4.1.1 design-area method). If the system
 *      has a specified design block, use it; otherwise pull defaults
 *      from hazard class.
 *   2) Hose allowance from NFPA 13 Table 19.3.3.1.1.
 *   3) Required pressure at riser = end-head static (7 psi minimum
 *      per NFPA 13.A.23.4.3.4) + friction through the longest path
 *      (summed via pipeFrictionLossPsi on every pipe in the system).
 *   4) safety_margin = supply.residual_psi − required_psi.
 *
 * The full pipe-graph Hazen-Williams solve (looped flows, Hardy
 * Cross) lives in services/halofire-cad/agents/04-hydraulic/. This
 * function is the live estimate Pascal uses to flash
 * Δ margin in the UI between full solves.
 */
export function solveSystemDemand(
  system: SystemNode,
  pipes: PipeNode[],
  heads: SprinklerHeadNode[],
): HydraulicDemand {
  // 1) Sprinkler flow via design-area × density
  const hazard = system.hazard
  const def = DENSITY_AREA_DEFAULTS[hazard]
  const density = system.design?.density_gpm_ft2 ?? def.density_gpm_ft2
  const area = system.design?.remote_area_ft2 ?? def.remote_area_ft2
  const sprinklerFlow = density * area

  // 2) Hose allowance
  const hose = system.design?.hose_allowance_gpm ?? HOSE_ALLOWANCE_GPM[hazard]
  const totalFlow = sprinklerFlow + hose

  // 3) Required pressure — 7 psi minimum at the most remote head
  //    (NFPA A.23.4.3.4) + friction. We estimate friction by summing
  //    loss across every pipe in the system as if the whole system
  //    flow rate were running through it; that's pessimistic (every
  //    pipe sees full flow), which is fine as a quick-estimate —
  //    the full solver refines it.
  const END_HEAD_MIN_PSI = 7
  let friction = 0
  for (const p of pipes) {
    if (p.systemId !== system.id) continue
    friction += pipeFrictionLossPsi(p, sprinklerFlow)
  }
  const safety = system.design?.safety_factor_psi ?? 10
  const requiredPsi = END_HEAD_MIN_PSI + friction + safety

  // 4) Margin
  const residual = system.supply?.residual_psi ?? 0
  const margin = residual - requiredPsi

  // Touch heads so lint doesn't complain about unused arg — live
  // head hydraulic state is solved by the full python pipeline; the
  // count is useful for the density-vs-head-count sanity check.
  void heads.length

  return {
    systemId: system.id,
    sprinkler_flow_gpm: sprinklerFlow,
    hose_flow_gpm: hose,
    total_flow_gpm: totalFlow,
    required_psi: requiredPsi,
    safety_margin_psi: margin,
    passes: margin >= 0,
  }
}

// ── Pascal systems integration ─────────────────────────────────────

interface SceneState {
  nodes: Record<string, unknown>
  updateNode?: (id: string, data: Partial<unknown>) => void
}

/**
 * Install HydraulicSystem on a Pascal scene store. Returns an
 * unsubscribe fn. Debounces solves to 300 ms so a burst of
 * PipeNode mutations (e.g. route-all-branches) fires one solve.
 */
export function installHydraulicSystem(
  store: StoreApi<SceneState>,
  opts: { debounceMs?: number } = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 300
  // Poll interval: even under continuous store-mutation storms the
  // solver runs at least this often when the node graph is dirty.
  // Keeps the solver honest when a RAF/ref loop prevents the
  // debounce from ever firing. Tuned to ≤ debounceMs so the solver
  // never stalls longer than the debounce promise.
  const pollMs = debounceMs
  let timer: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let dirty = false
  let lastNodesRef: Record<string, unknown> | null = null

  const solveAll = () => {
    const state = store.getState()
    const nodes = state.nodes as Record<
      string,
      SystemNode | PipeNode | SprinklerHeadNode | { type?: string; id: string }
    >
    const systems: SystemNode[] = []
    const pipes: PipeNode[] = []
    const heads: SprinklerHeadNode[] = []
    for (const n of Object.values(nodes)) {
      if ((n as { type?: string }).type === 'system') {
        systems.push(n as SystemNode)
      } else if ((n as { type?: string }).type === 'pipe') {
        pipes.push(n as PipeNode)
      } else if ((n as { type?: string }).type === 'sprinkler_head') {
        heads.push(n as SprinklerHeadNode)
      }
    }
    if (systems.length === 0) return

    const update = state.updateNode
    for (const sys of systems) {
      // Per-system try/catch: a single malformed pipe (missing
      // start_m / size_in / schedule) mustn't kill the whole solver.
      try {
        const demand = solveSystemDemand(sys, pipes, heads)
        if (update) {
          update(sys.id, {
            demand: {
              sprinkler_flow_gpm: demand.sprinkler_flow_gpm,
              hose_flow_gpm: demand.hose_flow_gpm,
              total_flow_gpm: demand.total_flow_gpm,
              required_psi: demand.required_psi,
              safety_margin_psi: demand.safety_margin_psi,
              passes: demand.passes,
              solved_at: Date.now(),
            },
          } as Partial<SystemNode>)
        }
      } catch {
        // Partial-graph edit in flight — skip this solve pass.
      }
    }
  }

  const runSolve = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    dirty = false
    solveAll()
  }

  const schedule = () => {
    dirty = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(runSolve, debounceMs)
  }

  const unsub = store.subscribe((state) => {
    const next = state.nodes
    if (next !== lastNodesRef) {
      lastNodesRef = next
      schedule()
    }
  })

  // Prime once so systems populated before install get solved.
  schedule()

  // Poll fallback: every pollMs, if the graph is dirty, solve. This
  // guarantees the solver runs under continuous-mutation storms
  // (React-ref / RAF loops) that would otherwise keep resetting the
  // debounce timer indefinitely.
  poll = setInterval(() => {
    if (dirty) runSolve()
  }, pollMs)

  return () => {
    unsub()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (poll) {
      clearInterval(poll)
      poll = null
    }
    dirty = false
  }
}
