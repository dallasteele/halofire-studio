import { z } from 'zod'

/** Shared, module-neutral records for HaloFire's operational spine. */
export const PlatformId = z.string().min(1).max(160)
export const IsoTimestamp = z.string().datetime()
export const SourceReceipt = z.object({
  source_system: z.literal('halofire_bids.db'),
  source_table: z.string().min(1),
  source_row_id: z.number().int().positive(),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

const RecordBase = z.object({ id: PlatformId, created_at: IsoTimestamp, updated_at: IsoTimestamp })
export const Customer = RecordBase.extend({ display_name: z.string().min(1), source: SourceReceipt.optional() })
export const Site = RecordBase.extend({ customer_id: PlatformId, display_name: z.string().min(1), address: z.string().nullable(), source: SourceReceipt.optional() })
export const Job = RecordBase.extend({ customer_id: PlatformId.nullable(), site_id: PlatformId.nullable(), display_name: z.string().min(1), status: z.enum(['intake', 'bidding', 'awarded', 'active', 'closed', 'unknown']), source: SourceReceipt.optional() })
export const Employee = RecordBase.extend({ display_name: z.string().min(1), email: z.string().email().nullable(), role: z.string().min(1), active: z.boolean(), source: SourceReceipt.optional() })
export const Document = RecordBase.extend({ job_id: PlatformId.nullable(), locator_path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), kind: z.string().min(1), source: SourceReceipt.optional() })
export const AuditEvent = RecordBase.extend({ actor_employee_id: PlatformId.nullable(), action: z.string().min(1), entity_kind: z.string().min(1), entity_id: PlatformId, payload_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() })
export const ReviewItem = RecordBase.extend({ job_id: PlatformId.nullable(), module_id: z.string().min(1), kind: z.string().min(1), severity: z.enum(['advisory', 'hard']), status: z.enum(['open', 'resolved', 'dismissed']), evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() })
export const ModuleRegistry = RecordBase.extend({ module_id: z.string().min(1), display_name: z.string().min(1), nav_path: z.string().min(1), enabled: z.boolean() })

export type Customer = z.infer<typeof Customer>
export type Site = z.infer<typeof Site>
export type Job = z.infer<typeof Job>
export type Employee = z.infer<typeof Employee>
export type Document = z.infer<typeof Document>
export type AuditEvent = z.infer<typeof AuditEvent>
export type ReviewItem = z.infer<typeof ReviewItem>
export type ModuleRegistry = z.infer<typeof ModuleRegistry>
