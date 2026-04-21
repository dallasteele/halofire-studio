/**
 * FittingNode — first-class Pascal node for fire-protection pipe
 * fittings (tees, elbows, reducers, caps, flanges, unions,
 * couplings).
 *
 * Fork addition (HaloFire Studio). Replaces the prior pattern of
 * tagging generic ItemNodes with 'halofire' / 'fitting_tee_*'. Pascal
 * systems (hydraulic-system, selection-system) dispatch on
 * `type === 'fitting'` — they no longer need to inspect `asset.tags`
 * to infer intent.
 *
 * The `port_connections` array wires each port role (run_a, run_b,
 * branch, drop) to a specific PipeNode. The traversal system walks
 * the pipe graph via these connections to answer "what's downstream
 * of this pipe?" — see blueprint 04 §9.
 *
 * Every field maps to a parameter the estimator + hydraulic solver
 * care about: `kind` drives the geometry and equivalent-length
 * lookup; `size_in` + `size_branch_in` disambiguate reducers; the
 * `hydraulic` block stores solver output (K-equivalent length, loss)
 * for downstream BOM + calc sheet rendering.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const FittingNode = BaseNode.extend({
  id: objectId('fitting'),
  type: nodeType('fitting'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),                          // Catalog part
  kind: z.enum([
    'tee', 'elbow_90', 'elbow_45', 'cross',
    'reducer_concentric', 'reducer_eccentric',
    'cap', 'flange', 'union', 'nipple', 'coupling',
  ]),
  size_in: z.number().positive(),           // primary run size
  size_branch_in: z.number().positive().optional(), // reducing fittings
  connection_style: z.enum([
    'NPT_threaded', 'grooved', 'flanged_150', 'flanged_300',
    'solvent_welded', 'soldered',
  ]),

  port_connections: z.array(z.object({
    port_role: z.enum(['run_a', 'run_b', 'branch', 'drop']),
    pipe_id: z.string().optional(),
  })).default([]),

  systemId: z.string().optional(),

  hydraulic: z.object({
    equivalent_length_ft: z.number(),
    pressure_loss_psi: z.number(),
  }).partial().optional(),
}).describe(dedent`
  FittingNode — first-class fire-protection pipe fitting.

  Discriminator: type === 'fitting'. Ports wire into PipeNodes via
  port_connections. Hydraulic state (equivalent length, loss) is
  populated by HydraulicSystem on each solve.
`)

export type FittingNode = z.infer<typeof FittingNode>
