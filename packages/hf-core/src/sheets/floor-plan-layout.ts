/**
 * floor-plan-layout — R7.3.
 *
 * Turns a `LevelNode` + scene snapshot into a tight paper-space layout
 * for a per-level sprinkler plan sheet: a precisely framed top-view
 * viewport, a discipline-aware layer filter, and decorative annotations
 * (title, scale bar, north arrow). Also emits hazard-class hatches for
 * any `RemoteAreaNode`s tied to this level.
 *
 * Contract:
 *   - Pure TypeScript. No three.js, no React, no Pascal store.
 *   - `selectScale` picks the finest standard scale that fits the
 *     level bbox inside the paper area (bbox is metres, paper is mm).
 *   - `buildFloorPlanLayout` returns `{ viewport, annotations, hatches }`.
 *   - The viewport camera targets the bbox centre in world space;
 *     `paper_rect_mm` is sized to `bbox * scale_factor`, anchored at
 *     the top-left of the plotable area (after margins + title block).
 *   - Layer defaults are discipline-aware: fire-protection shows
 *     sprinkler/pipe/fitting/valve/hanger/device + architectural shell,
 *     hides HVAC/electrical/plumbing, hides ceiling + item clutter.
 *
 * See `packages/hf-core/tests/sheets/floor-plan-layout.spec.ts` for
 * the 7-test contract exercised by the Playwright harness.
 */
import type { AnyNode, LevelNode, Viewport, Annotation, Hatch } from '@pascal-app/core/schema'

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export interface FloorPlanLayoutOpts {
  /** Full paper width in mm (landscape). */
  paper_w_mm: number
  /** Full paper height in mm (landscape). */
  paper_h_mm: number
  /** Uniform outer margin (mm). Defaults to 25mm on all edges. */
  margin_mm?: number
  /** Preferred scale; when omitted the tightest fitting scale is
   *  auto-selected via `selectScale`. */
  preferred_scale?: Viewport['scale']
  /** Discipline for layer-filter defaults. Defaults to fire_protection. */
  discipline?: 'fire_protection' | 'mechanical' | 'plumbing' | 'electrical' | 'architectural'
}

export interface FloorPlanLayout {
  viewport: Viewport
  /** Title, scale bar, and north arrow. */
  annotations: Annotation[]
  /** Hazard-class fills for rooms/remote-areas on this level. */
  hatches: Hatch[]
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

/**
 * Millimetres of model-space represented by one millimetre of paper at
 * a given scale enum. For an architectural scale like 1/8"=1'-0":
 *   1 ft ≡ 12 in ≡ 304.8 mm, and 1/8" ≡ 3.175 mm on paper, so the
 *   drawing factor is 304.8 / 3.175 ≈ 96. One paper-mm represents
 *   96 model-mm. We store that factor directly.
 */
const SCALE_FACTOR: Record<Viewport['scale'], number> = {
  '1_8':   8,
  '1_10':  10,
  '1_16':  16,
  '1_24':  24,
  '1_25':  25,
  '1_32':  32,
  '1_48':  48,
  '1_50':  50,
  '1_96':  96,
  '1_100': 100,
}

/**
 * Scales ordered finest → coarsest for auto-selection. Architectural
 * scales are preferred; engineering / metric scales are kept as
 * fallbacks so warehouse-size bboxes still fit on a D-sheet.
 */
const SCALE_ORDER: Viewport['scale'][] = [
  '1_8',   // 1/8" per foot, factor 8  (rarely fits a whole floor, but try)
  '1_10',
  '1_16',
  '1_24',
  '1_25',
  '1_32',
  '1_48',  // 1/4"=1'-0", residential floor plans
  '1_50',
  '1_96',  // 1/8"=1'-0", commercial floor plans
  '1_100',
]

/** Title block reservation (bottom-right). Blueprint 07 §2. */
const TITLE_BLOCK_W_MM = 180
const TITLE_BLOCK_H_MM = 120

/** Margin default — matches generate-default-set.ts. */
const DEFAULT_MARGIN_MM = 25

/** Hazard-class fill colours. Tuned so extra-hazard reads as "hot"
 *  (orange/red) and light-hazard as "cool" (green) at low opacity
 *  against a white sheet. */
const HAZARD_COLORS: Record<string, string> = {
  light:            '#4ade80', // green-400  — residential / offices
  ordinary_group_1: '#facc15', // yellow-400 — light commercial
  ordinary_group_2: '#fb923c', // orange-400 — mercantile, mfg
  extra_group_1:    '#f87171', // red-400    — high-hazard storage
  extra_group_2:    '#dc2626', // red-600    — flammable liquids
}
const HAZARD_DEFAULT_COLOR = '#94a3b8' // slate-400

// ------------------------------------------------------------------
// ID helpers (kept local to avoid leaking a second nid counter).
// ------------------------------------------------------------------

let __fplSeq = 0
function nid(prefix: string): string {
  __fplSeq++
  const rnd = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  return `${prefix}_${rnd}${__fplSeq.toString(36)}`
}

// ------------------------------------------------------------------
// Scale selection
// ------------------------------------------------------------------

/**
 * Pick the tightest standard scale that fits `bboxMetres` inside
 * `paperAreaMm`. Walks SCALE_ORDER from finest to coarsest and returns
 * the first scale where the bbox projected onto paper still fits.
 *
 * Projection: `paper_mm = model_mm / factor = (model_m * 1000) / factor`.
 */
export function selectScale(
  bboxMetres: { w: number; h: number },
  paperAreaMm: { w: number; h: number },
): Viewport['scale'] {
  for (const scale of SCALE_ORDER) {
    const factor = SCALE_FACTOR[scale]!
    const wPaper = (bboxMetres.w * 1000) / factor
    const hPaper = (bboxMetres.h * 1000) / factor
    if (wPaper <= paperAreaMm.w && hPaper <= paperAreaMm.h) {
      return scale
    }
  }
  // Nothing fits — fall back to the coarsest available scale. The
  // viewport will clip, but that's a better failure mode than a
  // runtime throw during sheet generation.
  return '1_100'
}

// ------------------------------------------------------------------
// Layer-visibility defaults
// ------------------------------------------------------------------

function layerDefaultsFor(
  discipline: NonNullable<FloorPlanLayoutOpts['discipline']>,
): Record<string, boolean> {
  // Architectural shell is ON for every discipline — field crews need
  // walls + slabs for orientation. Ceiling is OFF so it doesn't hide
  // the plan; `item` (furniture, generic clutter) is OFF too.
  const base: Record<string, boolean> = {
    wall: true,
    slab: true,
    door: true,
    window: true,
    ceiling: false,
    roof: false,
    item: false,
    architectural: true,
  }

  switch (discipline) {
    case 'fire_protection':
      return {
        ...base,
        sprinkler_head: true,
        pipe: true,
        fitting: true,
        valve: true,
        hanger: true,
        device: true,
        fdc: true,
        riser_assembly: true,
        remote_area: true,
        fire_protection: true,
        hvac: false,
        electrical: false,
        plumbing: false,
        mechanical: false,
      }
    case 'mechanical':
      return { ...base, hvac: true, mechanical: true, fire_protection: false, electrical: false, plumbing: false }
    case 'plumbing':
      return { ...base, plumbing: true, fire_protection: false, electrical: false, hvac: false }
    case 'electrical':
      return { ...base, electrical: true, device: true, fire_protection: false, hvac: false, plumbing: false }
    case 'architectural':
      return { ...base, ceiling: true, item: true }
    default:
      return base
  }
}

// ------------------------------------------------------------------
// Bbox computation
// ------------------------------------------------------------------

interface Bbox2D {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function emptyBbox(): Bbox2D {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

function expandBbox(b: Bbox2D, p: readonly [number, number]): void {
  if (p[0] < b.minX) b.minX = p[0]
  if (p[0] > b.maxX) b.maxX = p[0]
  if (p[1] < b.minY) b.minY = p[1]
  if (p[1] > b.maxY) b.maxY = p[1]
}

function bboxIsEmpty(b: Bbox2D): boolean {
  return !Number.isFinite(b.minX) || !Number.isFinite(b.maxX) || !Number.isFinite(b.minY) || !Number.isFinite(b.maxY)
}

/**
 * Compute the level's world-space bbox by unioning all slab polygons
 * attached to the level. `+margin` pads half a metre on each side so
 * walls at the perimeter don't get clipped by the viewport frame.
 */
function computeLevelBbox(
  level: LevelNode,
  sceneSnapshot: Record<string, AnyNode>,
): Bbox2D {
  const bbox = emptyBbox()
  const children = level.children ?? []
  for (const childId of children) {
    const child = sceneSnapshot[childId]
    if (!child) continue
    if (child.type === 'slab') {
      for (const p of child.polygon) expandBbox(bbox, p as [number, number])
    }
  }
  if (bboxIsEmpty(bbox)) {
    // Fallback: scan every slab in the snapshot (unattached slabs are
    // still useful for framing an otherwise-empty level).
    for (const n of Object.values(sceneSnapshot)) {
      if (n && (n as AnyNode).type === 'slab') {
        for (const p of (n as { polygon: [number, number][] }).polygon) {
          expandBbox(bbox, p)
        }
      }
    }
  }
  if (bboxIsEmpty(bbox)) {
    // Last-ditch: 10m square centred on origin. Keeps the viewport
    // rendering rather than throwing during an empty-level render.
    return { minX: -5, minY: -5, maxX: 5, maxY: 5 }
  }
  // Pad half a metre for perimeter walls.
  const pad = 0.5
  return {
    minX: bbox.minX - pad,
    minY: bbox.minY - pad,
    maxX: bbox.maxX + pad,
    maxY: bbox.maxY + pad,
  }
}

// ------------------------------------------------------------------
// Annotations
// ------------------------------------------------------------------

/** Human-readable scale string. */
function scaleLabel(scale: Viewport['scale']): string {
  switch (scale) {
    case '1_8':   return '1"=8"'
    case '1_16':  return '3/4"=1\'-0"'
    case '1_24':  return '1/2"=1\'-0"'
    case '1_32':  return '3/8"=1\'-0"'
    case '1_48':  return '1/4"=1\'-0"'
    case '1_96':  return '1/8"=1\'-0"'
    case '1_10':  return '1:10'
    case '1_25':  return '1:25'
    case '1_50':  return '1:50'
    case '1_100': return '1:100'
    default:      return String(scale)
  }
}

function titleFor(level: LevelNode, discipline: string, scale: Viewport['scale']): string {
  const levelName = level.name ?? `Level ${level.level ?? 0}`
  const disc = discipline === 'fire_protection' ? 'Sprinkler Plan'
    : discipline === 'mechanical' ? 'Mechanical Plan'
    : discipline === 'plumbing' ? 'Plumbing Plan'
    : discipline === 'electrical' ? 'Electrical Plan'
    : 'Floor Plan'
  return `${levelName} — ${disc}, Scale ${scaleLabel(scale)}`
}

interface PaperRect {
  x: number
  y: number
  w: number
  h: number
}

function buildAnnotations(
  level: LevelNode,
  discipline: NonNullable<FloorPlanLayoutOpts['discipline']>,
  scale: Viewport['scale'],
  paper: { w: number; h: number; margin: number },
  viewportRect: PaperRect,
): Annotation[] {
  const out: Annotation[] = []

  // Title — anchored at the top-left of the plotable area, just inside
  // the viewport frame. "Level N" substring keeps downstream regex
  // assertions happy.
  out.push({
    id: nid('ann'),
    kind: 'label',
    text: titleFor(level, discipline, scale),
    text_position_paper_mm: [paper.margin + 10, paper.h - paper.margin - 10],
    leader_polyline_mm: [],
    style_id: 'halofire.title',
  })

  // Scale bar — 20 ft with tick marks at 5 ft intervals. The renderer
  // resolves 'halofire.scale-bar' to a real tick-mark primitive; the
  // annotation payload itself only needs to communicate units + ticks.
  // We encode both in the text so headless consumers (PDF export,
  // tests) can verify the feature without loading the style library.
  out.push({
    id: nid('ann'),
    kind: 'label',
    text: 'Scale bar: 0 5 10 15 20 ft',
    text_position_paper_mm: [paper.margin + 10, paper.margin + 10],
    leader_polyline_mm: [
      // A 20ft span at this scale. At 1/8"=1'-0", 20ft ≈ 63.5 mm.
      [paper.margin + 10, paper.margin + 18],
      [paper.margin + 10 + scaleBarMm(scale), paper.margin + 18],
    ],
    style_id: 'halofire.scale-bar',
  })

  // North arrow — top-right of the viewport rect. Triangle + 'N' label.
  const naX = viewportRect.x + viewportRect.w - 15
  const naY = viewportRect.y + viewportRect.h - 15
  out.push({
    id: nid('ann'),
    kind: 'label',
    text: 'N',
    text_position_paper_mm: [naX, naY + 8],
    leader_polyline_mm: [
      [naX, naY],
      [naX - 4, naY - 8],
      [naX + 4, naY - 8],
      [naX, naY],
    ],
    style_id: 'halofire.north-arrow',
  })

  return out
}

/** Paper-mm length of a 20-foot scale bar at the selected scale. */
function scaleBarMm(scale: Viewport['scale']): number {
  const factor = SCALE_FACTOR[scale]!
  // 20 ft = 6.096 m = 6096 mm model space.
  return 6096 / factor
}

// ------------------------------------------------------------------
// Hazard hatches
// ------------------------------------------------------------------

function hazardColor(cls: string): string {
  return HAZARD_COLORS[cls] ?? HAZARD_DEFAULT_COLOR
}

/**
 * Emit a Hatch per RemoteAreaNode whose polygon sits inside the level
 * bbox (close-enough proxy for "rooms on this level" until the schema
 * grows explicit level-attachment for remote areas).
 */
function buildHazardHatches(
  bbox: Bbox2D,
  sceneSnapshot: Record<string, AnyNode>,
): Hatch[] {
  const out: Hatch[] = []
  for (const n of Object.values(sceneSnapshot)) {
    if (!n || (n as AnyNode).type !== 'remote_area') continue
    const ra = n as { polygon_m: [number, number][]; hazard_class: string; id: string; name?: string }
    const anyInside = ra.polygon_m.some(
      ([x, y]) => x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY,
    )
    if (!anyInside) continue
    out.push({
      id: nid('hatch'),
      polygon_m: ra.polygon_m,
      pattern: 'solid',
      color: hazardColor(ra.hazard_class),
      opacity: 0.2,
      label: `Hazard: ${ra.hazard_class}`,
    })
  }
  return out
}

// ------------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------------

export function buildFloorPlanLayout(
  level: LevelNode,
  sceneSnapshot: Record<string, AnyNode>,
  opts: FloorPlanLayoutOpts,
): FloorPlanLayout {
  const margin = opts.margin_mm ?? DEFAULT_MARGIN_MM
  const discipline = opts.discipline ?? 'fire_protection'

  // 1. Level bbox (world, metres).
  const bbox = computeLevelBbox(level, sceneSnapshot)
  const bboxW = bbox.maxX - bbox.minX
  const bboxH = bbox.maxY - bbox.minY
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2

  // 2. Plotable paper area = paper − margins − title block reservation.
  // Title block sits bottom-right; we subtract its width from the
  // usable width and its height from the usable height to keep the
  // layout conservative (simpler than an L-shaped clip region).
  const plotW = opts.paper_w_mm - 2 * margin - TITLE_BLOCK_W_MM
  const plotH = opts.paper_h_mm - 2 * margin
  const areaForScale = { w: plotW, h: plotH - TITLE_BLOCK_H_MM /* ~title block height */ }

  // 3. Pick a scale.
  const scale = opts.preferred_scale
    ?? selectScale({ w: bboxW, h: bboxH }, areaForScale)

  // 4. Viewport paper rect. Sized to bbox * scale; anchored top-left
  // of the plotable area.
  const factor = SCALE_FACTOR[scale]!
  const vpW = Math.min(plotW, (bboxW * 1000) / factor)
  const vpH = Math.min(plotH, (bboxH * 1000) / factor)
  const vpX = margin
  const vpY = opts.paper_h_mm - margin - vpH

  const viewport: Viewport = {
    id: nid('vp'),
    paper_rect_mm: [vpX, vpY, vpW, vpH],
    camera: {
      kind: 'top',
      level_id: level.id,
      target: [cx, cy, 0],
      up: [0, 0, 1],
    },
    scale,
    layer_visibility: layerDefaultsFor(discipline),
  }

  // 5. Annotations (title, scale bar, north arrow).
  const annotations = buildAnnotations(
    level,
    discipline,
    scale,
    { w: opts.paper_w_mm, h: opts.paper_h_mm, margin },
    { x: vpX, y: vpY, w: vpW, h: vpH },
  )

  // 6. Hazard hatches.
  const hatches = buildHazardHatches(bbox, sceneSnapshot)

  return { viewport, annotations, hatches }
}
