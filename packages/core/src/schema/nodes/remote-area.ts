/**
 * RemoteAreaNode — first-class Pascal node representing a
 * hydraulically remote design area per NFPA 13.
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'remote_area'`. The hydraulic calc engine picks the
 * `is_most_remote` area and walks its heads as the demand set;
 * `polygon_m` defines the floor-plan footprint used for
 * `computed_area_ft2` and head selection; `design_density_gpm_ft2`
 * overrides the hazard default when the engineer sets it.
 *
 * See blueprint 04 §7.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const RemoteAreaNode = BaseNode.extend({
  id: objectId('remote_area'),
  type: nodeType('remote_area'),

  polygon_m: z.array(z.tuple([z.number(), z.number()])).min(3),
  hazard_class: z.enum([
    'light', 'ordinary_group_1', 'ordinary_group_2',
    'extra_group_1', 'extra_group_2',
  ]),
  computed_area_ft2: z.number().nonnegative().optional(),
  is_most_remote: z.boolean().default(false),
  design_density_gpm_ft2: z.number().positive().optional(),
}).describe(dedent`
  RemoteAreaNode — hydraulically remote design area (NFPA 13).

  Discriminator: type === 'remote_area'. polygon_m is a floor-plan
  footprint (>= 3 vertices). is_most_remote picks which area the
  hydraulic solver treats as the demand set.
`)

export type RemoteAreaNode = z.infer<typeof RemoteAreaNode>
