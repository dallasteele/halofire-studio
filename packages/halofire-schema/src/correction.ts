/**
 * Correction — append-only user edits over intake, persisted one-per-line
 * in `corrections.jsonl`. See docs/blueprints/01_DATA_MODEL.md §2.3.
 *
 * Six variants, discriminated on `type`:
 *   - wall.delete / wall.move
 *   - head.move / head.add / head.remove
 *   - pipe.resize
 *   - hazard.set
 */
import { z } from 'zod'

export const WallDeleteCorrection = z.object({
  type: z.literal('wall.delete'),
  wall_id: z.string(),
  at: z.string(),
  by: z.string().optional(),
})

export const WallMoveCorrection = z.object({
  type: z.literal('wall.move'),
  wall_id: z.string(),
  from_start: z.tuple([z.number(), z.number()]),
  to_start: z.tuple([z.number(), z.number()]),
  from_end: z.tuple([z.number(), z.number()]),
  to_end: z.tuple([z.number(), z.number()]),
  at: z.string(),
  by: z.string().optional(),
})

export const HeadMoveCorrection = z.object({
  type: z.literal('head.move'),
  head_id: z.string(),
  from_pos: z.tuple([z.number(), z.number(), z.number()]),
  to_pos: z.tuple([z.number(), z.number(), z.number()]),
  at: z.string(),
  by: z.string().optional(),
})

export const HeadAddCorrection = z.object({
  type: z.literal('head.add'),
  sku: z.string(),
  pos: z.tuple([z.number(), z.number(), z.number()]),
  at: z.string(),
  by: z.string().optional(),
})

export const HeadRemoveCorrection = z.object({
  type: z.literal('head.remove'),
  head_id: z.string(),
  at: z.string(),
  by: z.string().optional(),
})

export const PipeResizeCorrection = z.object({
  type: z.literal('pipe.resize'),
  pipe_id: z.string(),
  from_size_in: z.number(),
  to_size_in: z.number(),
  at: z.string(),
  by: z.string().optional(),
})

export const HazardSetCorrection = z.object({
  type: z.literal('hazard.set'),
  level_id: z.string(),
  room_id: z.string().optional(),
  hazard: z.string(),
  at: z.string(),
  by: z.string().optional(),
})

export const Correction = z.discriminatedUnion('type', [
  WallDeleteCorrection,
  WallMoveCorrection,
  HeadMoveCorrection,
  HeadAddCorrection,
  HeadRemoveCorrection,
  PipeResizeCorrection,
  HazardSetCorrection,
])

export type Correction = z.infer<typeof Correction>
