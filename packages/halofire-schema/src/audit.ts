/**
 * AuditEntry — append-only who-did-what-when log for licensed-PE
 * workflows. One per line in `audit.jsonl`.
 * See docs/blueprints/01_DATA_MODEL.md §2.5.
 */
import { z } from 'zod'

export const AuditEntry = z.object({
  ts: z.string(),
  actor: z.string(),
  action: z.string(),
  target: z.string().optional(),
  delta: z.json().optional(),
  reason: z.string().optional(),
})

export type AuditEntry = z.infer<typeof AuditEntry>
