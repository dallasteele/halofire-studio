/**
 * SprinklerHeadNode — first-class Pascal node for fire-protection sprinkler
 * heads. This is a fork addition (HaloFire Studio), not a halofire-tagged
 * ItemNode.
 *
 * Modeled after NFPA 13 / FM Global sprinkler catalog data. Every field on
 * this schema maps directly to a parameter a fire-protection engineer
 * cares about: K-factor drives hydraulic flow, orientation drives deflector
 * pattern, response drives bulb/fuse type, temperature drives activation
 * point, coverage drives spacing calculations.
 *
 * Pascal systems (hydraulic-system, selection-system) dispatch on
 * `type === 'sprinkler_head'` — they do NOT have to poke at
 * `asset.tags` to infer intent.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/** NFPA 13 / FM Global catalog orientations. */
export const SprinklerOrientation = z.enum([
  'pendant',
  'upright',
  'sidewall_horizontal',
  'sidewall_vertical',
  'concealed_pendant',
  'dry_pendant',
  'dry_upright',
  'in_rack',
])
export type SprinklerOrientation = z.infer<typeof SprinklerOrientation>

/** NFPA 13 §3.3.191 response categories. */
export const SprinklerResponse = z.enum([
  'standard',   // 5-minute RTI
  'quick',      // ≤ 50 (metric) RTI — typical K=5.6 pendants
  'esfr',       // Early Suppression Fast Response — K=11.2, K=14.0, K=16.8
  'special',
])
export type SprinklerResponse = z.infer<typeof SprinklerResponse>

/** NFPA 13 A.6.2.5 temperature ratings — colour-coded frame arms. */
export const SprinklerTemperatureRating = z.enum([
  'ordinary_135F',    // uncolored
  'ordinary_155F',    // uncolored
  'intermediate_175F',// white
  'intermediate_200F',// white
  'high_250F',        // blue
  'extra_high_325F',  // red
  'very_extra_high_360F', // green
  'ultra_high_500F',  // orange
])
export type SprinklerTemperatureRating = z.infer<typeof SprinklerTemperatureRating>

/**
 * K-factor — orifice discharge coefficient in GPM / psi^0.5.
 * Common catalog values:
 *   K2.8  — residential concealed
 *   K4.2  — residential pendant
 *   K5.6  — light-hazard standard (most common)
 *   K8.0  — ordinary hazard
 *   K11.2 — ESFR (warehouse)
 *   K14.0 — ESFR
 *   K16.8 — ESFR / in-rack
 *   K22.4 — storage
 *   K25.2 — storage
 */
const kFactorSchema = z.number().positive().max(30)

/**
 * Coverage area — ft² that one head protects. NFPA 13 §8.6 spacing
 * tables determine this from hazard + head type. We store the resolved
 * coverage here so placement tools + hydraulic solver use the same
 * number.
 */
const coverageSchema = z
  .object({
    area_ft2: z.number().positive().max(400),   // NFPA max 225 LH, 400 EH
    max_spacing_ft: z.number().positive().max(20),
    max_distance_from_wall_ft: z.number().positive().max(15),
  })
  .partial()
  .optional()

export const SprinklerHeadNode = BaseNode.extend({
  id: objectId('sprinkler_head'),
  type: nodeType('sprinkler_head'),

  // Spatial — Pascal level-local coordinates.
  // position[1] is the height AT THE DEFLECTOR in the level frame. A
  // pendant at deflector-below-ceiling = 0.1m in a 3m level reads as
  // position[1] = 2.9.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // Fire-protection-specific fields. These are REQUIRED — a sprinkler
  // head without a K-factor is not a sprinkler head.
  k_factor: kFactorSchema,
  sku: z.string().min(1),  // manufacturer part # (e.g. "TY-B TY1234")
  manufacturer: z
    .enum(['tyco', 'viking', 'reliable', 'victaulic', 'senju', 'globe', 'other'])
    .default('other'),
  orientation: SprinklerOrientation,
  response: SprinklerResponse.default('standard'),
  temperature: SprinklerTemperatureRating.default('ordinary_155F'),

  // Spacing + hazard — computed by the placer, retained so tools don't
  // have to re-derive. When undefined, UI tools fall back to
  // defaults-for-orientation lookups in nfpa13-constants.ts.
  coverage: coverageSchema,

  // Cross-references into the rest of the scene tree.
  systemId: z.string().optional(),   // SystemNode this head belongs to
  branchId: z.string().optional(),   // PipeNode branch it drops off of
  dropPipeId: z.string().optional(), // dedicated drop leg, if any

  // Hydraulic state populated by HydraulicSystem. Read-only from UI
  // code; overwritten on every solve.
  hydraulic: z
    .object({
      flow_gpm: z.number(),
      pressure_psi: z.number(),
      elevation_ft: z.number(),
      is_flowing: z.boolean().default(false),  // inside remote area?
    })
    .partial()
    .optional(),

  // NFPA §8.15 — escutcheon / cover plate + trim ring, for BOM rollup.
  trim: z
    .object({
      escutcheon_sku: z.string().optional(),
      cover_plate_sku: z.string().optional(),
      finish: z.enum(['brass', 'chrome', 'white', 'black', 'unfinished']).default('brass'),
    })
    .optional(),
}).describe(dedent`
  SprinklerHeadNode — first-class fire-protection sprinkler head.

  Replaces the prior pattern of tagging generic ItemNodes with
  'halofire' / 'sprinkler_head_pendant'. Pascal systems dispatch on
  type === 'sprinkler_head' directly.

  Required: k_factor, sku, orientation.
  Hydraulic state is populated by HydraulicSystem after each solve.
`)

export type SprinklerHeadNode = z.infer<typeof SprinklerHeadNode>

/** Helper: compute effective deflector elevation above the level floor
 *  (m) given a head position. `position[1]` already IS the deflector
 *  height in level-local coords, so this is identity — exported for
 *  readability at call sites. */
export function deflectorHeightM(head: SprinklerHeadNode): number {
  return head.position[1]
}

/** Helper: flow at a reference pressure — Hazen-Williams / NFPA 13 uses
 *  Q = K√P. Returns GPM given psi. */
export function flowAtPressure(head: SprinklerHeadNode, pressurePsi: number): number {
  if (pressurePsi <= 0) return 0
  return head.k_factor * Math.sqrt(pressurePsi)
}
