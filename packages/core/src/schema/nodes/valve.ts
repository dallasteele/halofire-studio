/**
 * ValveNode — first-class Pascal node for fire-protection valves
 * (gate, butterfly, check, alarm check, deluge, preaction, RPZ
 * backflow, ball, globe, control).
 *
 * Fork addition (HaloFire Studio). Replaces the prior pattern of
 * tagging generic ItemNodes with 'halofire' / 'valve_*'. Pascal
 * systems dispatch on `type === 'valve'` — they no longer need to
 * inspect `asset.tags` to infer intent.
 *
 * Runtime state (`state`, `throttle_pct`, `supervised`) is part of
 * the schema because the HydraulicSystem and supervisory logic
 * both read it. A closed gate valve upstream of a system
 * short-circuits the solve; a supervised tamper switch drives the
 * alarm panel graph.
 *
 * Hydraulic fields (Cv, equivalent length, pressure loss) are
 * populated by the solver on each cycle so downstream BOM + calc
 * sheets can reference the same numbers.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ValveNode = BaseNode.extend({
  id: objectId('valve'),
  type: nodeType('valve'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'gate_osy', 'gate_pivy', 'butterfly', 'check_swing', 'check_wafer',
    'alarm_check_wet', 'deluge', 'preaction', 'rpz_backflow',
    'ball', 'globe', 'control_valve',
  ]),
  size_in: z.number().positive(),
  connection_style: z.enum([
    'NPT_threaded', 'grooved', 'flanged_150', 'flanged_300',
  ]),

  // Runtime state (where known)
  state: z.enum(['open', 'closed', 'throttled']).default('open'),
  throttle_pct: z.number().min(0).max(100).optional(),
  supervised: z.boolean().default(false),   // tamper switch attached?

  systemId: z.string().optional(),

  hydraulic: z.object({
    cv_flow_coefficient: z.number().optional(),
    equivalent_length_ft: z.number().optional(),
    pressure_loss_psi: z.number().optional(),
  }).partial().optional(),
}).describe(dedent`
  ValveNode — first-class fire-protection valve.

  Discriminator: type === 'valve'. Runtime state (open/closed/
  throttled + supervised flag) is part of the schema because
  HydraulicSystem and supervisory logic both consume it.
`)

export type ValveNode = z.infer<typeof ValveNode>
