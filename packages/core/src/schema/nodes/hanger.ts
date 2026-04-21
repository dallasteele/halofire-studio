/**
 * HangerNode — first-class Pascal node for pipe hangers and seismic
 * bracing (clevis, split-ring, trapeze, seismic sway braces,
 * c-clamps, straps).
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'hanger'` — they no longer need to inspect `asset.tags`
 * to infer intent.
 *
 * The `pipe_id` field wires the hanger to the pipe it supports; the
 * `structural` block records what the hanger attaches to (beam,
 * joist, deck, concrete, unistrut) and optional load. NFPA 13 §9
 * hanger-spacing validators walk PipeNodes and reference these.
 *
 * See blueprint 04 §5.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const HangerNode = BaseNode.extend({
  id: objectId('hanger'),
  type: nodeType('hanger'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'clevis', 'split_ring', 'trapeze', 'roller',
    'seismic_sway_lateral', 'seismic_sway_longitudinal',
    'c_clamp_beam', 'c_clamp_deck', 'strap',
  ]),
  pipe_id: z.string(),                      // what pipe it supports
  size_in: z.number().positive(),           // sized to pipe

  structural: z.object({
    attach_to_type: z.enum(['beam', 'joist', 'deck', 'concrete', 'unistrut']),
    attach_to_id: z.string().optional(),
    load_kg: z.number().optional(),
  }).optional(),
}).describe(dedent`
  HangerNode — first-class fire-protection pipe hanger / seismic brace.

  Discriminator: type === 'hanger'. The structural block records the
  attachment target so NFPA 13 §9 and seismic validators can check
  spacing and load paths.
`)

export type HangerNode = z.infer<typeof HangerNode>
