/**
 * ProjectManifest — top-level `manifest.json` for every `.hfproj`
 * bundle. See docs/blueprints/01_DATA_MODEL.md §2.1.
 *
 * Dates are ISO-8601 strings (not `z.date()`) so the manifest
 * round-trips through `JSON.stringify` / `JSON.parse` without a
 * custom reviver. Python Pydantic mirror is in
 * `services/halofire-cad/cad/schema.py`; parity is enforced via a
 * golden fixture per blueprint 14 §3.
 */
import { z } from 'zod'

export const ProjectManifest = z.object({
  schema_version: z.literal(1),
  project_id: z.string(),
  name: z.string(),
  address: z.string(),
  firm: z.string(),
  designer: z.string(),
  reviewer: z.string().optional(),
  stamped_by: z.string().optional(),
  units: z.enum(['imperial', 'metric']).default('imperial'),
  code_edition: z.string().default('NFPA 13 2022'),
  ahj: z.string().optional(),
  created_at: z.string(),
  modified_at: z.string(),
  app_version: z.string(),
  capabilities: z.array(z.string()),
})

export type ProjectManifest = z.infer<typeof ProjectManifest>
