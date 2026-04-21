/**
 * SheetNode — drawing sheet in the sheet set (FP-001, FP-002, …).
 *
 * Fork addition (HaloFire Studio). Drawing sheet management is
 * blueprint 07 §2. This is the minimal schema landing — viewports
 * and annotations are typed as `z.unknown()[]` for now; the full
 * Viewport / Annotation / RevisionCloud sub-schemas land with the
 * paper-space renderer in a later phase.
 *
 * Discriminator: type === 'sheet'. A SheetNode describes one piece
 * of paper in the submittal set: paper size, orientation, the
 * viewports that frame model space, the title block template, and
 * revision metadata.
 *
 * See blueprint 07 §2.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SheetNode = BaseNode.extend({
  id: objectId('sheet'),
  type: nodeType('sheet'),

  name: z.string(),                          // 'FP-003'
  title: z.string(),                         // 'Level 2 — Sprinkler Plan'
  paper_size: z.enum([
    'ARCH_A', 'ARCH_B', 'ARCH_C', 'ARCH_D', 'ARCH_E',
    'ANSI_A', 'ANSI_B', 'ANSI_C', 'ANSI_D', 'ANSI_E',
    'ISO_A4', 'ISO_A3', 'ISO_A2', 'ISO_A1', 'ISO_A0',
  ]).default('ARCH_D'),
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  title_block_id: z.string(),

  // Heavy sub-schemas (Viewport, Annotation, RevisionCloud) defer
  // until the paper-space renderer lands — they currently round-trip
  // as opaque records.
  viewports: z.array(z.unknown()).default([]),
  annotations: z.array(z.unknown()).default([]),
  revision_clouds: z.array(z.unknown()).default([]),

  sheet_index: z.number().int().nonnegative(),
  discipline: z.enum([
    'fire_protection', 'mechanical', 'plumbing',
    'electrical', 'structural', 'architectural',
  ]).default('fire_protection'),
  revision: z.string().default('V0'),
}).describe(dedent`
  SheetNode — one sheet in the drawing set (minimal landing; heavy
  viewport + annotation sub-schemas defer until the paper-space
  renderer).

  Discriminator: type === 'sheet'.
`)

export type SheetNode = z.infer<typeof SheetNode>
