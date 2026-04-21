/**
 * ObstructionNode — first-class Pascal node for overhead
 * obstructions (ducts, beams, columns, joists, equipment, lights,
 * diffusers) that interfere with sprinkler coverage and head
 * placement.
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'obstruction'`. NFPA 13 §10 obstruction rules consume
 * the bbox and `kind` to check head clearances, the 3×-width /
 * 18"-below-deflector rules, and the ADD (area of density
 * determination) interaction.
 *
 * `source` records where the obstruction came from — hand drawn,
 * pulled from an imported IFC, or inferred from a site-intake scan.
 *
 * See blueprint 04 §7.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ObstructionNode = BaseNode.extend({
  id: objectId('obstruction'),
  type: nodeType('obstruction'),

  kind: z.enum([
    'duct', 'beam', 'column', 'joist',
    'equipment', 'light', 'diffuser',
  ]),
  bbox_min: z.tuple([z.number(), z.number(), z.number()]),
  bbox_max: z.tuple([z.number(), z.number(), z.number()]),
  source: z.enum(['manual', 'ifc', 'intake']).default('manual'),
}).describe(dedent`
  ObstructionNode — overhead obstruction for NFPA 13 §10 clearance
  checks.

  Discriminator: type === 'obstruction'. bbox_min/bbox_max define an
  axis-aligned box in model space; source records provenance.
`)

export type ObstructionNode = z.infer<typeof ObstructionNode>
