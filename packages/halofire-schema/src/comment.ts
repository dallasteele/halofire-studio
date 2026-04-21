/**
 * Comment — pinned note per node (or world-point). One per line in
 * `comments.jsonl`. See docs/blueprints/01_DATA_MODEL.md §2.4.
 */
import { z } from 'zod'

export const CommentReply = z.object({
  author: z.string(),
  at: z.string(),
  text: z.string(),
})
export type CommentReply = z.infer<typeof CommentReply>

export const Comment = z.object({
  id: z.string(),
  node_id: z.string().optional(),
  anchor: z.tuple([z.number(), z.number(), z.number()]).optional(),
  author: z.string(),
  created_at: z.string(),
  text: z.string(),
  resolved: z.boolean().default(false),
  resolved_by: z.string().optional(),
  resolved_at: z.string().optional(),
  replies: z.array(CommentReply).default([]),
})

export type Comment = z.infer<typeof Comment>
