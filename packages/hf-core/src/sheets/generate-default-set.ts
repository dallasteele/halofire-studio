/**
 * generateDefaultSheetSet — emit the canonical AHJ sheet set for a
 * HaloFire design as a pure `SheetNode[]`.
 *
 * Blueprint 07 §4 defines the default sheet order a fire-protection
 * submittal needs before it can go to the AHJ for review:
 *
 *   FP-001  Cover + legend + symbols + abbreviations
 *   FP-002  Site plan (FDC + hydrant locations)
 *   FP-003..FP-(N+2)  One floor plan per level
 *   FP-(N+3)  Riser diagram (schematic)
 *   FP-(N+4)  Hydraulic calculation summary
 *   FP-(N+5)  BOM / stocklist
 *   FP-(N+6)  Detail sheet (typical head drop, hanger, FDC detail)
 *
 * This module is the V1 SKELETON emitter. It produces the right
 * number of sheets, correct paper sizes, viewport rects + title-block
 * pointers, and placeholder annotations ("Full content in R7.4"). The
 * content refinement — actual legend tables, dense BOM rows, hydraulic
 * node tables, real dimension annotations — ships in R7.4 and later.
 *
 * Contract:
 *   - Pure TypeScript. No `three.js`, no React, no Pascal store.
 *   - Returns `SheetNode[]` ordered by `sheet_index` (1-based).
 *   - Sheet names zero-pad the index to 3 digits (`FP-001`, not
 *     `FP-1`) so Explorer-style sort matches draw-order.
 *   - Paper size, title block id, and cut-sheet inclusion are opts;
 *     defaults are ARCH_D + `halofire.standard` + cut-sheets OFF
 *     (R7.4 ships the cut-sheet generator).
 */
import type { AnyNode, LevelNode, SheetNode, Viewport, Annotation } from '@pascal-app/core/schema'

import type { Design, DesignLevel, Vec2 } from '../scene/spawn-from-design.js'
import { buildFloorPlanLayout } from './floor-plan-layout.js'
import { buildRiserDiagramLayout } from './riser-diagram.js'

// ------------------------------------------------------------------
// Public options
// ------------------------------------------------------------------

export interface GenerateDefaultSetOptions {
  /** Paper size for every sheet in the set. Blueprint 07 §4 defaults
   *  to ARCH_D (24"×36" landscape) — big enough for 1/4" floor plans
   *  of mid-size commercial buildings and still foldable to 11×17. */
  paper_size?: SheetNode['paper_size']
  /** Title-block template id referenced by every sheet. Default is
   *  `halofire.standard`; the paper-space renderer (R7.3) resolves
   *  this against the title-block library. */
  title_block_id?: string
  /** Include per-device catalog cut-sheets at the end of the set.
   *  Default false — cut-sheet generation lands in R7.4. */
  include_cut_sheets?: boolean
}

// ------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------

let __seq = 0
function nid(prefix: string): string {
  __seq++
  const rnd = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  return `${prefix}_${rnd}${__seq.toString(36)}`
}

function padIndex(i: number): string {
  return i.toString().padStart(3, '0')
}

function sheetName(index: number): string {
  return `FP-${padIndex(index)}`
}

/** Paper dimensions (mm) for each supported paper size. Landscape. */
const PAPER_MM: Record<SheetNode['paper_size'], [number, number]> = {
  ARCH_A: [305, 229],
  ARCH_B: [457, 305],
  ARCH_C: [610, 457],
  ARCH_D: [914, 610],
  ARCH_E: [1219, 914],
  ANSI_A: [279, 216],
  ANSI_B: [432, 279],
  ANSI_C: [559, 432],
  ANSI_D: [864, 559],
  ANSI_E: [1118, 864],
  ISO_A4: [297, 210],
  ISO_A3: [420, 297],
  ISO_A2: [594, 420],
  ISO_A1: [841, 594],
  ISO_A0: [1189, 841],
}

/**
 * Default title-block margin (mm). The standard HaloFire title block
 * eats ~150mm on the right edge and ~25mm on the other three; the
 * viewport rect below carves the plotable area out of that.
 */
const MARGIN = { left: 25, bottom: 25, top: 25, right: 150 }

function plotableRect(paper: SheetNode['paper_size']): [number, number, number, number] {
  const dims = (PAPER_MM[paper] ?? PAPER_MM.ARCH_D) as [number, number]
  const [w, h] = dims
  const x = MARGIN.left
  const y = MARGIN.bottom
  const pw = w - MARGIN.left - MARGIN.right
  const ph = h - MARGIN.top - MARGIN.bottom
  return [x, y, pw, ph]
}

/**
 * Build a placeholder annotation centered in the plotable area. R7.4
 * replaces these with real tables / legend rows.
 */
function placeholderNote(
  paper: SheetNode['paper_size'],
  text: string,
  style_id = 'halofire.note',
): Annotation {
  const [x, y, w, h] = plotableRect(paper)
  return {
    id: nid('ann'),
    kind: 'note',
    text,
    text_position_paper_mm: [x + w / 2, y + h / 2],
    leader_polyline_mm: [],
    style_id,
  }
}

function titleAnnotation(
  paper: SheetNode['paper_size'],
  title: string,
): Annotation {
  const [x, y, w, h] = plotableRect(paper)
  return {
    id: nid('ann'),
    kind: 'label',
    text: title,
    // Top-left of the plotable area, offset a hair inside.
    text_position_paper_mm: [x + 10, y + h - 10],
    leader_polyline_mm: [],
    style_id: 'halofire.title',
  }
}

// ------------------------------------------------------------------
// Bridge: DesignLevel → LevelNode + scene snapshot
// ------------------------------------------------------------------

/**
 * Build a minimal `LevelNode` + slab-only scene snapshot from a
 * DesignLevel. The floor-plan-layout helper needs SlabNodes to compute
 * the world-space bbox; we synthesize one from the level polygon so
 * generate-default-set can run without a live Pascal store.
 */
function synthesizeLevelSnapshot(
  lvl: DesignLevel,
  levelIdx: number,
): { levelNode: LevelNode; snapshot: Record<string, AnyNode> } {
  const slabId = `slab_${lvl.id}`
  const polygon: [number, number][] = (lvl.polygon_m ?? [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]) as [number, number][]
  const slab = {
    id: slabId,
    type: 'slab',
    polygon,
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    autoFromWalls: false,
  } as unknown as AnyNode
  const levelNode = {
    id: lvl.id,
    type: 'level',
    name: lvl.name ?? `Level ${levelIdx + 1}`,
    level: levelIdx,
    children: [slabId],
  } as unknown as LevelNode
  return { levelNode, snapshot: { [slabId]: slab } }
}

// ------------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------------

export function generateDefaultSheetSet(
  design: Design,
  opts: GenerateDefaultSetOptions = {},
): SheetNode[] {
  const paper_size: SheetNode['paper_size'] = opts.paper_size ?? 'ARCH_D'
  const title_block_id = opts.title_block_id ?? 'halofire.standard'
  const includeCutSheets = opts.include_cut_sheets ?? false

  const levels = design.building?.levels ?? []

  const sheets: SheetNode[] = []
  let idx = 0

  const baseSheet = (
    title: string,
    viewports: Viewport[],
    annotations: Annotation[],
    hatches: SheetNode['hatches'] = [],
  ): SheetNode => {
    idx++
    return {
      id: nid('sheet'),
      type: 'sheet',
      name: sheetName(idx),
      title,
      paper_size,
      orientation: 'landscape',
      title_block_id,
      viewports,
      dimensions: [],
      annotations,
      hatches,
      revision_clouds: [],
      sheet_index: idx,
      discipline: 'fire_protection',
      revision: 'V0',
    } as SheetNode
  }

  // ---- FP-001 Cover ----------------------------------------------
  sheets.push(
    baseSheet(
      'Cover Sheet',
      /* no viewport — cover is all annotation */ [],
      [
        titleAnnotation(paper_size, 'Cover Sheet'),
        placeholderNote(
          paper_size,
          'Legend, symbols, abbreviations — full content in R7.4.',
        ),
      ],
    ),
  )

  // ---- FP-002 Site plan -------------------------------------------
  {
    const [px, py, pw, ph] = plotableRect(paper_size)
    const siteViewport: Viewport = {
      id: nid('vp'),
      paper_rect_mm: [px, py, pw, ph],
      camera: { kind: 'top' },
      scale: '1_96', // 1"=8'
      layer_visibility: {
        site: true,
        fdc: true,
        hydrant: true,
        architectural: true,
        hvac: false,
        electrical: false,
      },
    }
    sheets.push(
      baseSheet(
        'Site Plan',
        [siteViewport],
        [
          titleAnnotation(paper_size, 'Site Plan — FDC + Hydrants'),
          placeholderNote(
            paper_size,
            'Site plan — FDC + hydrant locations. Full content in R7.4.',
          ),
        ],
      ),
    )
  }

  // ---- FP-003..FP-(N+2) Floor plans -------------------------------
  //
  // R7.3 replaces the stubbed per-level viewport with
  // `buildFloorPlanLayout`: auto-scale, discipline-aware layer filter,
  // and hazard-class hatches. We synthesize a minimal `LevelNode` +
  // scene snapshot from the DesignLevel polygon so the layout helper
  // can compute a proper bbox without needing the live Pascal store.
  const [paperWFp, paperHFp] = (PAPER_MM[paper_size] ?? PAPER_MM.ARCH_D) as [number, number]
  levels.forEach((lvl, levelIdx) => {
    const { levelNode, snapshot } = synthesizeLevelSnapshot(lvl, levelIdx)
    const fp = buildFloorPlanLayout(levelNode, snapshot, {
      paper_w_mm: paperWFp,
      paper_h_mm: paperHFp,
      margin_mm: MARGIN.left,
      discipline: 'fire_protection',
    })
    sheets.push(
      baseSheet(
        `Level ${levelIdx + 1} — Sprinkler Plan`,
        [fp.viewport],
        [
          titleAnnotation(
            paper_size,
            `Level ${levelIdx + 1} — ${lvl.name} — Sprinkler Plan`,
          ),
          ...fp.annotations,
        ],
        fp.hatches,
      ),
    )
  })

  // ---- FP-(N+3) Riser diagram -------------------------------------
  //
  // R7.2 lands the real schematic ladder layout via
  // `buildRiserDiagramLayout`. No viewport — riser diagrams are
  // SVG-only schematic, not scaled model geometry.
  {
    const [paperW, paperH] = (PAPER_MM[paper_size] ?? PAPER_MM.ARCH_D) as [number, number]
    const riserLayout = buildRiserDiagramLayout(design, {
      paper_w_mm: paperW,
      paper_h_mm: paperH,
      margin_mm: MARGIN.left,
    })
    const riserAnnotations: Annotation[] = [
      titleAnnotation(paper_size, 'Riser Diagram (Schematic)'),
      ...riserLayout.annotations,
    ]
    const riserViewports = riserLayout.viewport ? [riserLayout.viewport] : []
    sheets.push(
      baseSheet('Riser Diagram', riserViewports, riserAnnotations),
    )
  }

  // ---- FP-(N+4) Hydraulic calc ------------------------------------
  sheets.push(
    baseSheet(
      'Hydraulic Calculation Summary',
      /* no viewport — tabular sheet */ [],
      [
        titleAnnotation(paper_size, 'Hydraulic Calculation Summary'),
        placeholderNote(
          paper_size,
          'Hydraulic calc summary — node/element tables. Full content in R7.4.',
        ),
      ],
    ),
  )

  // ---- FP-(N+5) BOM / stocklist -----------------------------------
  sheets.push(
    baseSheet(
      'Bill of Materials',
      /* no viewport — dense table */ [],
      [
        titleAnnotation(paper_size, 'Bill of Materials / Stocklist'),
        placeholderNote(
          paper_size,
          'BOM / stocklist — dense part table. Full content in R7.4.',
        ),
      ],
    ),
  )

  // ---- FP-(N+6) Detail sheet --------------------------------------
  {
    const [px, py, pw, ph] = plotableRect(paper_size)
    // 2x2 grid of small detail viewports inside the plotable area.
    const cellW = pw / 2
    const cellH = ph / 2
    const cell = (cx: number, cy: number): Viewport => ({
      id: nid('vp'),
      paper_rect_mm: [
        px + cx * cellW + 5,
        py + cy * cellH + 5,
        cellW - 10,
        cellH - 10,
      ],
      camera: { kind: 'iso' },
      scale: '1_10',
      layer_visibility: { detail: true },
    })
    sheets.push(
      baseSheet(
        'Typical Details',
        [cell(0, 1), cell(1, 1), cell(0, 0), cell(1, 0)],
        [
          titleAnnotation(paper_size, 'Typical Details'),
          placeholderNote(
            paper_size,
            'Typical head drop, hanger, FDC detail. Full content in R7.4.',
          ),
        ],
      ),
    )
  }

  // ---- Optional cut sheets (R7.4 ships the generator) -------------
  if (includeCutSheets) {
    // V1 skeleton: emit a single placeholder cut-sheet index so the
    // consumer sees the slot exists. R7.4 replaces this with per-SKU
    // sheets pulled from the catalog.
    sheets.push(
      baseSheet(
        'Cut Sheet Index',
        [],
        [
          titleAnnotation(paper_size, 'Cut Sheet Index'),
          placeholderNote(
            paper_size,
            'Per-SKU cut sheets — generator lands in R7.4.',
          ),
        ],
      ),
    )
  }

  return sheets
}

// Re-export helpers used internally that callers may find useful.
// Explicit exports only; keep the surface area small.
export { PAPER_MM, plotableRect }

// Silence unused-import lint when Vec2 isn't referenced (kept for
// future polygon-based cover thumbnails).
export type { Vec2 }
