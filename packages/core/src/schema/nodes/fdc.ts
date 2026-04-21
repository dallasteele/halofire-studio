/**
 * FDCNode — first-class Pascal node for a Fire Department Connection
 * (Stortz 5", Stortz 2½" single/twin, threaded 2½").
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'fdc'` — they no longer need to inspect `asset.tags` to
 * infer intent.
 *
 * `distance_to_hydrant_ft` and `height_above_grade_m` drive NFPA 14
 * compliance checks (AHJ typically requires an FDC within 100 ft of
 * a hydrant and mounted 18"–48" above grade). `class_kind` maps to
 * the supply connection the fire department expects on arrival.
 *
 * Note: the blueprint uses the field name `class` but `class` is a
 * reserved word in TypeScript — we expose it as `class_kind` to
 * avoid IDE friction while keeping the same enum values.
 *
 * See blueprint 04 §7.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const FDCNode = BaseNode.extend({
  id: objectId('fdc'),
  type: nodeType('fdc'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  class_kind: z.enum([
    'stortz_5in',
    'stortz_2_5in_single',
    'stortz_2_5in_twin',
    'threaded_2_5in',
  ]),
  sign_id: z.string().optional(),
  distance_to_hydrant_ft: z.number().nonnegative(),
  height_above_grade_m: z.number().nonnegative().optional(),
}).describe(dedent`
  FDCNode — Fire Department Connection.

  Discriminator: type === 'fdc'. Required supply handoff for the
  responding engine company; governed by NFPA 14 clearances.
`)

export type FDCNode = z.infer<typeof FDCNode>
