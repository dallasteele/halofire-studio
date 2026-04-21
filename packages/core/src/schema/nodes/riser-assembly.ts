/**
 * RiserAssemblyNode — first-class Pascal node that rolls up a riser
 * group (backflow + alarm check + main drain + gauges + test port
 * + pipe stubs) into a single logical assembly.
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'riser_assembly'`. `children_ids` references the
 * constituent pipe/valve/device/gauge nodes — the assembly is the
 * scheduling + BOM unit the installer sees on the fab drawings.
 *
 * See blueprint 04 §7.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const RiserAssemblyNode = BaseNode.extend({
  id: objectId('riser_assembly'),
  type: nodeType('riser_assembly'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  systemId: z.string(),
  children_ids: z.array(z.string()).default([]),
  installed_at: z.string().optional(),      // ISO date
  location_description: z.string().optional(),
}).describe(dedent`
  RiserAssemblyNode — logical rollup of a riser's constituent pipe,
  valve, device, and gauge nodes.

  Discriminator: type === 'riser_assembly'. This is the scheduling +
  BOM unit on fab drawings.
`)

export type RiserAssemblyNode = z.infer<typeof RiserAssemblyNode>
