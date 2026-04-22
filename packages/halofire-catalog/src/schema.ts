/**
 * Runtime validator for `catalog.json` (Phase D.1 reconcile — 2026-04-21).
 *
 * The canonical schema is defined in `types.ts`. This file mirrors it as
 * a Zod schema so the build can fail loudly the moment the SCAD author
 * vocabulary + generator + on-disk JSON + consumer TS types drift apart.
 *
 * Usage:
 *
 *   import { CatalogManifestSchema, parseCatalog } from '@halofire/catalog'
 *   const catalog = parseCatalog(rawJson)   // throws with a readable path
 *
 * Consumers (`@halofire/core/catalog/load`) call `parseCatalog` on the
 * freshly-loaded JSON so drift is caught at load, not at first use.
 */

import { z } from 'zod'
import type {
  CatalogEntry,
  CatalogManifest,
  CatalogParam,
  CatalogPort,
  PartKind,
} from './types.js'

// ── PartKind ────────────────────────────────────────────────────────────
export const PartKindSchema = z.enum([
  'sprinkler_head',
  'pipe_segment',
  'fitting',
  'valve',
  'hanger',
  'device',
  'fdc',
  'riser_assy',
  'compound',
  'structural',
  'unknown',
]) satisfies z.ZodType<PartKind>

// ── CatalogParam ────────────────────────────────────────────────────────
const ParamNumberSchema = z.object({
  kind: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
})
const ParamEnumSchema = z.object({
  kind: z.literal('enum'),
  values: z.array(z.union([z.number(), z.string()])),
})
const ParamStringSchema = z.object({ kind: z.literal('string') })
const ParamBoolSchema = z.object({ kind: z.literal('bool') })

export const CatalogParamTypeSchema = z.union([
  ParamNumberSchema,
  ParamEnumSchema,
  ParamStringSchema,
  ParamBoolSchema,
])

export const CatalogParamSchema: z.ZodType<CatalogParam> = z.object({
  name: z.string().min(1),
  type: CatalogParamTypeSchema,
  default: z
    .union([z.number(), z.string(), z.boolean()])
    .optional(),
  label: z.string().optional(),
  unit: z.string().optional(),
})

// ── CatalogPort ─────────────────────────────────────────────────────────
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const CatalogPortStyleSchema = z.enum([
  'NPT_threaded',
  'grooved',
  'flanged.150',
  'flanged.300',
  'solvent_welded',
  'soldered',
  'stortz',
  'none',
])

export const CatalogPortRoleSchema = z.enum([
  'run_a',
  'run_b',
  'branch',
  'drop',
])

export const CatalogPortSchema: z.ZodType<CatalogPort> = z.object({
  name: z.string().min(1),
  position_m: Vec3Schema,
  direction: Vec3Schema,
  style: CatalogPortStyleSchema,
  size_in: z.number().positive(),
  role: CatalogPortRoleSchema,
})

// ── CatalogEntry ────────────────────────────────────────────────────────
export const CatalogEntrySchema: z.ZodType<CatalogEntry> = z.object({
  sku: z.string().min(1),
  kind: PartKindSchema,
  category: z.string(), // dotted category — not enum-restricted on purpose
  display_name: z.string().min(1),

  manufacturer: z.string().optional(),
  mfg_part_number: z.string().optional(),
  listing: z.string().optional(),
  hazard_classes: z.array(z.string()).optional(),

  price_usd: z.number().nonnegative().optional(),
  install_minutes: z.number().nonnegative().optional(),
  crew: z.string().optional(),

  weight_kg: z.number().nonnegative().optional(),

  k_factor: z.number().positive().optional(),
  orientation: z.string().optional(),
  response: z.string().optional(),
  temperature: z.string().optional(),

  params: z.record(z.string(), CatalogParamSchema),
  ports: z.array(CatalogPortSchema),

  scad_source: z.string().min(1),
  warnings: z.array(z.string()),
})

// ── CatalogManifest (top-level envelope of catalog.json) ────────────────
export const CatalogManifestSchema: z.ZodType<CatalogManifest> = z.object({
  schema_version: z.literal(1),
  catalog_version: z.string().min(1),
  generated_at: z.string().min(1),
  parts: z.array(CatalogEntrySchema),
})

/**
 * Strict parse — throws `z.ZodError` with the offending path if the
 * JSON does not match the canonical schema. Use at catalog load time.
 */
export function parseCatalog(raw: unknown): CatalogManifest {
  return CatalogManifestSchema.parse(raw)
}

/**
 * Non-throwing variant — returns either `{ ok: true, data }` or
 * `{ ok: false, error }`. Use when you want to degrade gracefully
 * (e.g. show an on-screen error instead of crashing a viewport).
 */
export function safeParseCatalog(
  raw: unknown,
): { ok: true; data: CatalogManifest } | { ok: false; error: z.ZodError } {
  const result = CatalogManifestSchema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, error: result.error }
}

