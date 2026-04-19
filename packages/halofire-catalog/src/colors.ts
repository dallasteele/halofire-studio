/**
 * Industry pipe-size color convention (AutoSprink / NFPA CAD standard).
 *
 * These colors are how every experienced sprinkler designer reads a
 * plan at a glance. We adopt them unchanged so that a veteran who has
 * used AutoSprink for 20 years opens HaloFire CAD and instantly
 * understands every line.
 */

export const PIPE_COLOR_BY_SIZE_IN: Record<string, string> = {
  '1': '#FFFF00', // yellow
  '1.25': '#FF00FF', // magenta
  '1.5': '#00FFFF', // cyan
  '2': '#0066FF', // blue
  '2.5': '#00C040', // green
  '3': '#E8432D', // red (Halo brand overlap — intentional)
  '4': '#FFFFFF', // white (rendered 2.5× weight for emphasis)
  '6': '#FFFFFF', // riser — same as 4"
}

export function pipeColorFor(sizeIn: number): string {
  const key = String(sizeIn)
  return PIPE_COLOR_BY_SIZE_IN[key] ?? '#888888'
}

export function pipeLineweightFor(sizeIn: number): number {
  // Plot-weight in millimeters (AutoCAD LWT convention)
  if (sizeIn >= 4) return 0.70
  if (sizeIn >= 3) return 0.50
  if (sizeIn >= 2) return 0.40
  if (sizeIn >= 1.5) return 0.35
  return 0.25
}

// AutoSprink-compatible DXF layer names
export function pipeLayerName(sizeIn: number): string {
  const s = String(sizeIn).replace('.', '-')
  return `FP-PIPE-${s}`
}

export const FP_LAYER_NAMES = {
  HEADS: 'FP-HEADS',
  HEADS_SIDEWALL: 'FP-HEADS-SIDEWALL',
  HEADS_CONCEALED: 'FP-HEADS-CONCEALED',
  RISER: 'FP-RISER',
  HANGERS: 'FP-HANGERS',
  FITTINGS: 'FP-FITTINGS',
  VALVES: 'FP-VALVES',
  SIGNAGE: 'FP-SIGNAGE',
  FDC: 'FP-FDC',
  CALC_CRITICAL: 'FP-CALC-CRITICAL',
} as const
