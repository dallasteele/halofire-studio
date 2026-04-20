/**
 * Material spec per catalog entry — PBR parameters an item renderer
 * can apply to a GLB mesh, plus the NFPA regulatory paint color an
 * agent needs to answer "what color is this supposed to be on the
 * real building?"
 *
 * Materials are DERIVED from the existing catalog entry (category +
 * mounting + pipe_size_in) rather than stamped into every manifest
 * row. One source of truth = the category + finish fields.
 */
import type { CatalogEntry } from './types.js'

export interface MaterialSpec {
  /** Display name for palettes / reports */
  name: string
  /** PBR base color, hex */
  color_hex: string
  /** 0 = dielectric, 1 = pure metal */
  metalness: number
  /** 0 = mirror, 1 = fully diffuse */
  roughness: number
  /** NFPA 13 regulatory color if this part must be painted a
   *  specific hue in the field (e.g. sprinkler supply mains = red).
   *  Null = no regulatory requirement. */
  nfpa_paint_hex: string | null
  /** Short note for AI agents */
  description: string
}

// ── canonical presets ───────────────────────────────────────────────
export const MATERIAL_PRESETS = {
  chrome: {
    name: 'Chrome',
    color_hex: '#c8ccd0',
    metalness: 1.0,
    roughness: 0.08,
    nfpa_paint_hex: null,
    description:
      'Polished chrome finish — standard for pendant/sidewall heads',
  },
  brass: {
    name: 'Brass',
    color_hex: '#c89b3c',
    metalness: 1.0,
    roughness: 0.22,
    nfpa_paint_hex: null,
    description: 'Polished brass — upright heads and gauges',
  },
  white_cover: {
    name: 'White cover plate',
    color_hex: '#f4f4f4',
    metalness: 0.0,
    roughness: 0.55,
    nfpa_paint_hex: null,
    description: 'Painted white steel cover — concealed heads',
  },
  // Sprinkler mains, per NFPA 13 §A.6.2.6 painted red for identification
  red_steel: {
    name: 'Red-painted steel',
    color_hex: '#c8322a',
    metalness: 0.35,
    roughness: 0.55,
    nfpa_paint_hex: '#c8322a',
    description:
      'NFPA-13 red-painted steel pipe; identifies fire-suppression mains',
  },
  red_iron: {
    name: 'Red-painted iron',
    color_hex: '#b02820',
    metalness: 0.25,
    roughness: 0.65,
    nfpa_paint_hex: '#b02820',
    description: 'Cast-iron valve body painted NFPA red',
  },
  black_iron: {
    name: 'Black iron',
    color_hex: '#2a2a2c',
    metalness: 0.55,
    roughness: 0.45,
    nfpa_paint_hex: null,
    description: 'Malleable iron fittings — elbows, tees, couplings',
  },
  red_enclosure: {
    name: 'Red-painted enclosure',
    color_hex: '#c8322a',
    metalness: 0.15,
    roughness: 0.70,
    nfpa_paint_hex: '#c8322a',
    description: 'Sheet-metal supervised device enclosure',
  },
} as const satisfies Record<string, MaterialSpec>

export type MaterialKey = keyof typeof MATERIAL_PRESETS

/**
 * Resolve the MaterialSpec for a catalog entry. Pure fn — derives
 * the material from the entry's `finish` and `category` fields.
 *
 * AI agents MUST use this instead of parsing `finish` strings.
 */
export function materialFor(entry: CatalogEntry): MaterialSpec {
  const f = (entry.finish || '').toLowerCase()
  if (f.includes('chrome')) return MATERIAL_PRESETS.chrome
  if (f.includes('brass')) return MATERIAL_PRESETS.brass
  if (f.includes('white')) return MATERIAL_PRESETS.white_cover
  if (f.includes('red-painted steel')) return MATERIAL_PRESETS.red_steel
  if (f.includes('red-painted cast iron'))
    return MATERIAL_PRESETS.red_iron
  if (f.includes('red-painted iron')) return MATERIAL_PRESETS.red_iron
  if (f.includes('red-painted enclosure'))
    return MATERIAL_PRESETS.red_enclosure
  if (f.includes('black iron')) return MATERIAL_PRESETS.black_iron
  // Safe fallback: unspecified metal parts default to brass-ish so
  // they still shade correctly under the standard HDRI.
  return MATERIAL_PRESETS.brass
}
