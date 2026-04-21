/**
 * SheetNode — drawing sheet in the sheet set (FP-001, FP-002, …).
 *
 * Fork addition (HaloFire Studio). Drawing sheet management is
 * blueprint 07 §2. This landing brings the full Viewport, Dimension,
 * Annotation, Hatch, and RevisionCloud sub-schemas online so the
 * paper-space renderer can round-trip real documents.
 *
 * Discriminator: type === 'sheet'. A SheetNode describes one piece
 * of paper in the submittal set: paper size, orientation, the
 * viewports that frame model space, the title block template, and
 * revision metadata.
 *
 * See blueprint 07 §2 (SheetNode + Viewport), §5 (Dimension +
 * DimStyle), §6 (Annotation), §7 (Hatch), §8 (RevisionCloud).
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Viewport — a rectangular window on the sheet that frames a camera
 * view of model space. See blueprint 07 §2.
 */
export const Viewport = z.object({
  id: z.string(),
  // [x, y, w, h] in millimetres on the paper.
  paper_rect_mm: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  camera: z.object({
    kind: z.enum(['top', 'iso', 'front', 'side', 'custom']),
    level_id: z.string().optional(),
    target: z.tuple([z.number(), z.number(), z.number()]).optional(),
    up: z.tuple([z.number(), z.number(), z.number()]).optional(),
  }),
  // Engineering scale as "numerator_denominator" to keep JSON-safe and
  // enum-narrowable. '1_96' = 1/8" = 1'-0", '1_50' = 1:50, etc.
  scale: z.enum([
    '1_96', '1_48', '1_32', '1_24', '1_16', '1_8',
    '1_100', '1_50', '1_25', '1_10',
  ]),
  layer_visibility: z.record(z.string(), z.boolean()).optional(),
})
export type Viewport = z.infer<typeof Viewport>

/**
 * Dimension — a measured annotation on a sheet. See blueprint 07 §5.
 */
export const Dimension = z.object({
  id: z.string(),
  kind: z.enum([
    'linear', 'continuous', 'aligned', 'ordinate',
    'radial', 'diameter', 'angular',
  ]),
  points: z.array(z.tuple([z.number(), z.number()])),
  dim_line_offset_m: z.number(),
  text_override: z.string().optional(),
  precision: z.number().int().nonnegative().default(2),
  unit_display: z.enum(['ft_in', 'decimal_ft', 'm', 'mm']).default('ft_in'),
  style_id: z.string(),
  sheet_id: z.string().optional(),
})
export type Dimension = z.infer<typeof Dimension>

/**
 * Annotation — free-floating callouts, notes, zone names. See
 * blueprint 07 §6.
 */
export const Annotation = z.object({
  id: z.string(),
  kind: z.enum(['note', 'callout', 'label', 'tag', 'zone_name']),
  text: z.string(),
  anchor_model: z.tuple([z.number(), z.number(), z.number()]).optional(),
  anchor_node_id: z.string().optional(),
  text_position_paper_mm: z.tuple([z.number(), z.number()]),
  leader_polyline_mm: z.array(z.tuple([z.number(), z.number()])).default([]),
  style_id: z.string(),
})
export type Annotation = z.infer<typeof Annotation>

/**
 * Hatch — a filled polygon pattern (used for remote areas, zone
 * shading, material indication). See blueprint 07 §7.
 */
export const Hatch = z.object({
  id: z.string(),
  polygon_m: z.array(z.tuple([z.number(), z.number()])),
  pattern: z.enum(['solid', 'ansi31', 'ansi32', 'dots', 'cross']),
  color: z.string(),
  opacity: z.number().min(0).max(1).default(0.2),
  label: z.string().optional(),
})
export type Hatch = z.infer<typeof Hatch>

/**
 * RevisionCloud — a bubble calling out a revision on a sheet. See
 * blueprint 07 §8.
 */
export const RevisionCloud = z.object({
  id: z.string(),
  revision_id: z.string(),
  polyline_m: z.array(z.tuple([z.number(), z.number()])),
  bubble_number: z.number().int().nonnegative(),
  note: z.string(),
  status: z.enum(['open', 'resolved']).default('open'),
})
export type RevisionCloud = z.infer<typeof RevisionCloud>

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

  viewports: z.array(Viewport).default([]),
  dimensions: z.array(Dimension).default([]),
  annotations: z.array(Annotation).default([]),
  hatches: z.array(Hatch).default([]),
  revision_clouds: z.array(RevisionCloud).default([]),

  sheet_index: z.number().int().nonnegative(),
  discipline: z.enum([
    'fire_protection', 'mechanical', 'plumbing',
    'electrical', 'structural', 'architectural',
  ]).default('fire_protection'),
  revision: z.string().default('V0'),
}).describe(dedent`
  SheetNode — one sheet in the drawing set. Owns its viewports,
  dimensions, annotations, hatches, and revision clouds.

  Discriminator: type === 'sheet'.
`)

export type SheetNode = z.infer<typeof SheetNode>
