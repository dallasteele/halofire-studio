/**
 * SystemNode — first-class Pascal node representing one fire-protection
 * system. A "system" in NFPA 13 parlance is everything fed from one
 * riser: the riser itself, cross-mains, branches, heads, FDC,
 * tampers / flow switches. A building can have many systems (one per
 * level for 4-story+ residential per §8.2.4, plus any combo
 * standpipe, plus any dry / pre-action zones).
 *
 * Fork addition (HaloFire Studio). This replaces the prior pattern
 * of shoving system data into free-form design.json dicts.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/** NFPA 13 system kinds. */
export const SystemKind = z.enum([
  'wet',            // wet-pipe (most common)
  'dry',            // dry-pipe (freezer / attic)
  'preaction',      // pre-action (data centre, archive)
  'deluge',         // deluge (hazardous materials)
  'combo_standpipe', // combination sprinkler + Class I/III hose
  'antifreeze',     // antifreeze loop off wet
])
export type SystemKind = z.infer<typeof SystemKind>

/** NFPA 13 §5 occupancy hazard classifications. */
export const HazardClass = z.enum([
  'light',            // LH — offices, residences, schools
  'ordinary_group_1', // OH1 — parking garages, laundries
  'ordinary_group_2', // OH2 — chemical plants, machine shops
  'extra_group_1',    // EH1 — aircraft hangars, fuel spray
  'extra_group_2',    // EH2 — plastics, flammable liquids
  'storage',          // ESFR / rack storage (§20-25)
])
export type HazardClass = z.infer<typeof HazardClass>

/** Design density / area lookup from NFPA 13 Fig. 19.2.3.1.1 */
export const DENSITY_AREA_DEFAULTS: Record<
  HazardClass,
  { density_gpm_ft2: number; remote_area_ft2: number }
> = {
  light: { density_gpm_ft2: 0.10, remote_area_ft2: 1500 },
  ordinary_group_1: { density_gpm_ft2: 0.15, remote_area_ft2: 1500 },
  ordinary_group_2: { density_gpm_ft2: 0.20, remote_area_ft2: 1500 },
  extra_group_1: { density_gpm_ft2: 0.30, remote_area_ft2: 2500 },
  extra_group_2: { density_gpm_ft2: 0.40, remote_area_ft2: 2500 },
  storage: { density_gpm_ft2: 0.60, remote_area_ft2: 2000 },
}

/** Hose stream allowance (GPM) for a given hazard class.
 *  NFPA 13 Table 19.3.3.1.1 — inside + outside combined. */
export const HOSE_ALLOWANCE_GPM: Record<HazardClass, number> = {
  light: 100,
  ordinary_group_1: 250,
  ordinary_group_2: 250,
  extra_group_1: 500,
  extra_group_2: 500,
  storage: 500,
}

export const SystemNode = BaseNode.extend({
  id: objectId('system'),
  type: nodeType('system'),

  kind: SystemKind.default('wet'),
  hazard: HazardClass.default('light'),

  // Supply side — from flow test.
  supply: z
    .object({
      static_psi: z.number().nonnegative(),
      residual_psi: z.number().nonnegative(),
      flow_gpm: z.number().nonnegative(),
      elevation_ft: z.number().default(0),
    })
    .optional(),

  // Design criteria — seeded from hazard defaults, overridable.
  design: z
    .object({
      density_gpm_ft2: z.number().positive(),
      remote_area_ft2: z.number().positive(),
      hose_allowance_gpm: z.number().nonnegative(),
      safety_factor_psi: z.number().nonnegative().default(10),
    })
    .optional(),

  // Hydraulic demand — written by HydraulicSystem on every solve.
  demand: z
    .object({
      sprinkler_flow_gpm: z.number().nonnegative(),
      hose_flow_gpm: z.number().nonnegative(),
      total_flow_gpm: z.number().nonnegative(),
      required_psi: z.number().nonnegative(),
      safety_margin_psi: z.number(),
      passes: z.boolean(),
      solved_at: z.number().optional(), // epoch ms
    })
    .partial()
    .optional(),

  // Graph cross-refs.
  riserPipeId: z.string().optional(),
  pipeIds: z.array(z.string()).default([]),
  headIds: z.array(z.string()).default([]),

  // Installer metadata.
  installer: z
    .object({
      contractor: z.string().optional(),
      installed_at: z.string().optional(), // ISO date
      shutoff_valve_location: z.string().optional(),
    })
    .optional(),
}).describe(dedent`
  SystemNode — one fire-protection system (one riser's worth of
  pipework + heads).

  Pascal's HydraulicSystem reacts to any PipeNode / SprinklerHeadNode
  mutation inside a SystemNode's graph and re-solves Hazen-Williams,
  writing the result back onto this node's demand block.
`)

export type SystemNode = z.infer<typeof SystemNode>

/** Seed design criteria from hazard defaults. Non-destructive —
 *  existing fields take precedence. */
export function withHazardDefaults(sys: SystemNode): SystemNode {
  const def = DENSITY_AREA_DEFAULTS[sys.hazard]
  const hose = HOSE_ALLOWANCE_GPM[sys.hazard]
  return {
    ...sys,
    design: {
      density_gpm_ft2: sys.design?.density_gpm_ft2 ?? def.density_gpm_ft2,
      remote_area_ft2: sys.design?.remote_area_ft2 ?? def.remote_area_ft2,
      hose_allowance_gpm: sys.design?.hose_allowance_gpm ?? hose,
      safety_factor_psi: sys.design?.safety_factor_psi ?? 10,
    },
  }
}
