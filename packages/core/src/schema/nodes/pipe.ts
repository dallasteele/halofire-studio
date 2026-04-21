/**
 * PipeNode — first-class Pascal node for fire-protection pipe runs.
 *
 * Fork addition (HaloFire Studio). Replaces the prior pattern of
 * tagging ItemNodes with 'pipe_steel_sch10'. Each PipeNode represents
 * one straight pipe segment; fittings live on their own (future Tee
 * / Elbow nodes) with refs to the pipes they connect.
 *
 * All dimensions in SI (metres + millimetres). NPS (nominal pipe
 * size, inches) is the identity the estimator uses at the BOM line,
 * so it's the stored unit; helpers convert to OD/ID mm when the
 * hydraulic solver needs them.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/** Role in the fire protection system — drives routing + sizing. */
export const PipeRole = z.enum([
  'feed_main',     // from riser to cross-main
  'cross_main',    // horizontal trunk feeding branches
  'branch',        // horizontal run feeding heads
  'drop',          // vertical drop from branch to head
  'sprig',         // short vertical up from branch to upright head
  'riser_nipple',  // short nipple at riser
  'riser',         // vertical riser
  'standpipe',     // Class I/II/III vertical hose standpipe
  'feed',          // misc feed line
  'unknown',
])
export type PipeRole = z.infer<typeof PipeRole>

/** Material / schedule combinations common in NFPA 13 jobs. */
export const PipeSchedule = z.enum([
  'SCH10',          // Steel Sch-10 (most common ≥2")
  'SCH40',          // Steel Sch-40 (threaded ≤2")
  'CPVC_BlazeMaster', // light-hazard, residential
  'copper_M',       // light-hazard specials
  'dyna_flow',      // Allied Tube Dyna-Flow
  'dyna_thread',    // Allied Tube Dyna-Thread (threaded Sch-10)
])
export type PipeSchedule = z.infer<typeof PipeSchedule>

/** Valid NFPA 13 nominal pipe sizes (inches) for fire sprinklers.
 *  Constrained to catalog sizes so bogus 1.75" bids can't be built. */
const NPS_VALUES = [
  0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12,
] as const
const npsSchema = z
  .number()
  .refine((v) => (NPS_VALUES as readonly number[]).includes(v), {
    message: 'pipe size must be an NFPA catalog NPS',
  })

/** NFPA 13 Table 6.2.1 — steel Sch-10 OD (mm) for common fire-sprinkler sizes. */
const SCH10_OD_MM: Record<number, number> = {
  1: 33.4,
  1.25: 42.2,
  1.5: 48.3,
  2: 60.3,
  2.5: 73.0,
  3: 88.9,
  4: 114.3,
  5: 141.3,
  6: 168.3,
  8: 219.1,
  10: 273.0,
  12: 323.9,
}

/** NFPA 13 Table 6.2.1 — steel Sch-10 wall thickness (mm). */
const SCH10_WALL_MM: Record<number, number> = {
  1: 2.77,
  1.25: 2.77,
  1.5: 2.77,
  2: 2.77,
  2.5: 3.05,
  3: 3.05,
  4: 3.05,
  5: 3.40,
  6: 3.40,
  8: 3.76,
  10: 4.19,
  12: 4.57,
}

/** Hazen-Williams roughness coefficient per schedule. */
const HW_C: Record<string, number> = {
  SCH10: 120,
  SCH40: 120,
  CPVC_BlazeMaster: 150,
  copper_M: 150,
  dyna_flow: 120,
  dyna_thread: 120,
}

export const PipeNode = BaseNode.extend({
  id: objectId('pipe'),
  type: nodeType('pipe'),

  // Segment endpoints in LEVEL-LOCAL metres. Authoritative geometry.
  // start_m and end_m for level-local straight-segment pipes; the
  // SystemSolver can walk the graph by matching endpoints with
  // snap tolerance (0.05m default).
  start_m: z.tuple([z.number(), z.number(), z.number()]),
  end_m: z.tuple([z.number(), z.number(), z.number()]),

  // Catalog identity — what gets bid.
  size_in: npsSchema,
  schedule: PipeSchedule.default('SCH10'),
  role: PipeRole.default('unknown'),

  // System graph.
  systemId: z.string().optional(),
  upstreamPipeId: z.string().optional(),  // fed from this pipe
  downstreamPipeIds: z.array(z.string()).default([]),

  // Hydraulic solver output — written by HydraulicSystem.
  // `flow_direction` is a unit vector (start→end when positive); a
  // flipped sign means the solver decided flow runs end→start.
  hydraulic: z
    .object({
      flow_gpm: z.number(),
      pressure_drop_psi: z.number(),
      velocity_fps: z.number(),
      flow_direction: z.tuple([z.number(), z.number(), z.number()]).optional(),
    })
    .partial()
    .optional(),

  // Visual overrides. Most pipes render in NFPA 13 §6.7 red
  // (#e8432d); dry-pipe risers render black; air compressor feeds
  // render copper. This lets an installer colour-code if desired.
  appearance: z
    .object({
      color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      paint: z
        .enum(['red_nfpa', 'black', 'copper', 'galvanized', 'cpvc_orange'])
        .default('red_nfpa'),
    })
    .optional(),
}).describe(dedent`
  PipeNode — a single straight fire-protection pipe segment.

  Replaces halofire-tagged ItemNodes for pipes. Pascal's selection +
  hydraulic systems dispatch on type === 'pipe' so a ribbon command
  like "Select downstream" can walk the pipe graph directly.
`)

export type PipeNode = z.infer<typeof PipeNode>

/** Length of the pipe segment in metres. */
export function pipeLengthM(pipe: PipeNode): number {
  const dx = pipe.end_m[0] - pipe.start_m[0]
  const dy = pipe.end_m[1] - pipe.start_m[1]
  const dz = pipe.end_m[2] - pipe.start_m[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Nominal OD (mm) for this pipe. Returns 0 for unknown catalog sizes. */
export function pipeOdMm(pipe: PipeNode): number {
  // Only SCH10 OD table included above — extend as new schedules land.
  if (pipe.schedule === 'SCH10' || pipe.schedule === 'dyna_flow') {
    return SCH10_OD_MM[pipe.size_in] ?? 0
  }
  // SCH40 OD is identical to SCH10 (same NPS).
  if (pipe.schedule === 'SCH40' || pipe.schedule === 'dyna_thread') {
    return SCH10_OD_MM[pipe.size_in] ?? 0
  }
  // CPVC / copper ODs differ slightly; approximate with Sch-10
  // until dedicated tables land.
  return SCH10_OD_MM[pipe.size_in] ?? 0
}

/** Nominal ID (mm) — used by hydraulic solver. */
export function pipeIdMm(pipe: PipeNode): number {
  const od = pipeOdMm(pipe)
  const wall = SCH10_WALL_MM[pipe.size_in] ?? 0
  return Math.max(0, od - 2 * wall)
}

/** Hazen-Williams C for this pipe. */
export function hazenWilliamsC(pipe: PipeNode): number {
  return HW_C[pipe.schedule] ?? 120
}
