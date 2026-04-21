/**
 * SheetRenderer — R6.5 / blueprint 07 §9.
 *
 * Composite renderer that stacks, outer to inner:
 *   1. Paper canvas SVG sized by sheet.paper_size (viewBox in mm).
 *   2. Title block at the bottom-right corner.
 *   3. One viewport frame per sheet.viewports entry.
 *   4. Hatches (polygons with color + opacity).
 *   5. Dimensions (extension lines + dim line + ticks + text).
 *   6. Annotations (leader polylines + text).
 *   7. Revision clouds (scalloped path + numbered bubble).
 *
 * Rendering is pure / functional — no refs, no effects, no state.
 * The pure helper `composeSheetSvg` returns the same output as a
 * string so the pdf-sheet-set exporter (R6.6) can rasterize it
 * without a DOM.
 *
 * XSS posture: the SVG is built from vetted package-local templates
 * plus XML-escaped field values, never raw user HTML, matching the
 * existing TitleBlockRenderer pattern.
 */

import * as React from 'react'
import type {
  Annotation,
  AnyNode,
  Dimension,
  Hatch,
  RevisionCloud,
  SheetNode,
  Viewport,
} from '@pascal-app/core'
import {
  HALOFIRE_STANDARD_PAPER_MM,
  HALOFIRE_STANDARD_SVG,
  HALOFIRE_STANDARD_TEMPLATE_ID,
} from '../../../../halofire-catalog/title-blocks/halofire-standard-svg'
import { renderTitleBlockSvg } from './title-block-renderer'

export interface SheetRendererProps {
  sheet: SheetNode
  sceneSnapshot: Record<string, AnyNode>
  titleBlockFields: Record<string, string>
}

/**
 * ISO / ANSI / ARCH paper sizes in millimetres. First dimension is
 * the longer edge (landscape). Portrait swaps.
 */
export const PAPER_SIZES_MM: Record<SheetNode['paper_size'], [number, number]> = {
  ARCH_A: [305, 229], ARCH_B: [457, 305], ARCH_C: [610, 457],
  ARCH_D: [914, 610], ARCH_E: [1219, 914],
  ANSI_A: [279, 216], ANSI_B: [432, 279], ANSI_C: [559, 432],
  ANSI_D: [864, 559], ANSI_E: [1118, 864],
  ISO_A4: [297, 210], ISO_A3: [420, 297], ISO_A2: [594, 420],
  ISO_A1: [841, 594], ISO_A0: [1189, 841],
}

/** Resolve paper size in mm after applying orientation. */
export function paperSizeMm(sheet: SheetNode): [number, number] {
  const [w, h] = PAPER_SIZES_MM[sheet.paper_size]
  return sheet.orientation === 'portrait' ? [h, w] : [w, h]
}

/** XML-escape a string for inline SVG text. */
function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Meters → millimetres. Model space is stored in metres. */
const M_TO_MM = 1000

/**
 * Generate a tiny 1x1 PNG data URL — placeholder for viewport
 * raster output until R6.4 ships the real ViewportRenderer.
 */
function generatePlaceholderDataUrl(): string {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
}

function viewportSvg(v: Viewport): string {
  const [x, y, w, h] = v.paper_rect_mm
  const href = generatePlaceholderDataUrl()
  return (
    `<g class="viewport" data-viewport-id="${escapeXml(v.id)}" data-scale="${v.scale}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `fill="#ffffff" stroke="#000000" stroke-width="0.3"/>` +
    `<image x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `preserveAspectRatio="xMidYMid meet" ` +
    `xlink:href="${href}" href="${href}"/>` +
    `</g>`
  )
}

function hatchSvg(h: Hatch): string {
  if (h.polygon_m.length === 0) return ''
  const pts = h.polygon_m
    .map(([x, y]) => `${x * M_TO_MM},${y * M_TO_MM}`)
    .join(' ')
  const label = h.label ? `<title>${escapeXml(h.label)}</title>` : ''
  return (
    `<polygon class="hatch" data-hatch-id="${escapeXml(h.id)}" ` +
    `data-pattern="${h.pattern}" points="${pts}" ` +
    `fill="${escapeXml(h.color)}" fill-opacity="${h.opacity}" ` +
    `stroke="${escapeXml(h.color)}" stroke-width="0.2">${label}</polygon>`
  )
}

function dimensionSvg(d: Dimension): string {
  if (d.points.length < 2) return ''
  const p1 = d.points[0]!
  const p2 = d.points[1]!
  const [x1, y1] = [p1[0] * M_TO_MM, p1[1] * M_TO_MM]
  const [x2, y2] = [p2[0] * M_TO_MM, p2[1] * M_TO_MM]
  const offMm = d.dim_line_offset_m * M_TO_MM

  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const ox = nx * offMm
  const oy = ny * offMm

  const dx1 = x1 + ox
  const dy1 = y1 + oy
  const dx2 = x2 + ox
  const dy2 = y2 + oy

  const rawM = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  const label = d.text_override ?? formatDim(rawM, d)

  const mx = (dx1 + dx2) / 2
  const my = (dy1 + dy2) / 2

  return (
    `<g class="dim" data-dim-id="${escapeXml(d.id)}" data-kind="${d.kind}" ` +
    `stroke="#000" stroke-width="0.2" fill="#000">` +
    `<line x1="${x1}" y1="${y1}" x2="${dx1}" y2="${dy1}"/>` +
    `<line x1="${x2}" y1="${y2}" x2="${dx2}" y2="${dy2}"/>` +
    `<line x1="${dx1}" y1="${dy1}" x2="${dx2}" y2="${dy2}"/>` +
    tickSvg(dx1, dy1, nx, ny) +
    tickSvg(dx2, dy2, nx, ny) +
    `<text x="${mx}" y="${my - 1}" font-size="3" text-anchor="middle" ` +
    `stroke="none">${escapeXml(label)}</text>` +
    `</g>`
  )
}

function tickSvg(cx: number, cy: number, nx: number, ny: number): string {
  const t = 1.5
  return (
    `<line x1="${cx - nx * t}" y1="${cy - ny * t}" ` +
    `x2="${cx + nx * t}" y2="${cy + ny * t}"/>`
  )
}

function formatDim(rawM: number, d: Dimension): string {
  const p = d.precision
  switch (d.unit_display) {
    case 'm':
      return `${rawM.toFixed(p)} m`
    case 'mm':
      return `${(rawM * 1000).toFixed(Math.max(0, p - 1))} mm`
    case 'decimal_ft':
      return `${(rawM * 3.28084).toFixed(p)} ft`
    default: {
      const totalFt = rawM * 3.28084
      const ft = Math.floor(totalFt)
      const inches = (totalFt - ft) * 12
      return `${ft}'-${inches.toFixed(p)}"`
    }
  }
}

function annotationSvg(a: Annotation): string {
  const [tx, ty] = a.text_position_paper_mm
  const leaderPts = a.leader_polyline_mm
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
  const leader = leaderPts
    ? `<polyline points="${leaderPts}" fill="none" stroke="#000" stroke-width="0.2"/>`
    : ''
  return (
    `<g class="annotation" data-annotation-id="${escapeXml(a.id)}" ` +
    `data-kind="${a.kind}">` +
    leader +
    `<text x="${tx}" y="${ty}" font-size="3" fill="#000">` +
    `${escapeXml(a.text)}</text>` +
    `</g>`
  )
}

/**
 * Revision cloud — scalloped polyline approximated as a sequence of
 * quadratic arcs between polyline vertices. Bubble rendered as a
 * circle with the revision number at the first vertex.
 */
function revisionCloudSvg(r: RevisionCloud): string {
  if (r.polyline_m.length < 2) return ''
  const pts = r.polyline_m.map(
    ([x, y]) => [x * M_TO_MM, y * M_TO_MM] as [number, number],
  )
  const first = pts[0]!
  let d = `M ${first[0]} ${first[1]}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const bump = 3
    const cx = mx + (-dy / len) * bump
    const cy = my + (dx / len) * bump
    d += ` Q ${cx} ${cy} ${b[0]} ${b[1]}`
  }

  const [bx, by] = first
  return (
    `<g class="revision-cloud" data-rev-id="${escapeXml(r.id)}" ` +
    `data-status="${r.status}">` +
    `<path d="${d}" fill="none" stroke="#c00" stroke-width="0.3"/>` +
    `<circle cx="${bx}" cy="${by}" r="4" fill="#fff" ` +
    `stroke="#c00" stroke-width="0.3"/>` +
    `<text x="${bx}" y="${by + 1.5}" font-size="3" text-anchor="middle" ` +
    `fill="#c00" stroke="none">${r.bubble_number}</text>` +
    `</g>`
  )
}

/**
 * Extract the inner content of the title-block SVG (everything
 * between the outermost <svg …> and </svg>) so it can be inlined
 * inside the sheet SVG without nesting <svg> elements. The block
 * is scaled to match the sheet paper size; it is authored for
 * 914×610 and anchored to the bottom-right corner.
 */
function inlineTitleBlock(svg: string, paperMm: [number, number]): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>\s*$/)
  const inner = m ? m[1]! : svg
  const [w, h] = paperMm
  const [tw, th] = HALOFIRE_STANDARD_PAPER_MM
  const sx = w / tw
  const sy = h / th
  return `<g class="title-block" transform="scale(${sx} ${sy})">${inner}</g>`
}

/**
 * Pure helper — returns the full SVG document string for a sheet.
 * Imported by the pdf-sheet-set exporter (R6.6).
 */
export function composeSheetSvg(
  sheet: SheetNode,
  _sceneSnapshot: Record<string, AnyNode>,
  titleBlockFields: Record<string, string>,
): string {
  const [w, h] = paperSizeMm(sheet)

  const titleBlockSvgStr = renderTitleBlockSvg(
    HALOFIRE_STANDARD_SVG,
    titleBlockFields,
    [w, h],
  )
  const titleBlock = inlineTitleBlock(titleBlockSvgStr, [w, h])

  const viewports = sheet.viewports.map(viewportSvg).join('')
  const hatches = sheet.hatches.map(hatchSvg).join('')
  const dimensions = sheet.dimensions.map(dimensionSvg).join('')
  const annotations = sheet.annotations.map(annotationSvg).join('')
  const revisionClouds = sheet.revision_clouds.map(revisionCloudSvg).join('')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm" ` +
    `data-sheet-id="${escapeXml(sheet.id)}" ` +
    `data-sheet-index="${sheet.sheet_index}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>` +
    viewports +
    hatches +
    dimensions +
    annotations +
    revisionClouds +
    titleBlock +
    `</svg>`
  )
}

export function SheetRenderer(props: SheetRendererProps): JSX.Element {
  const { sheet, sceneSnapshot, titleBlockFields } = props
  const svg = React.useMemo(
    () => composeSheetSvg(sheet, sceneSnapshot, titleBlockFields),
    [sheet, sceneSnapshot, titleBlockFields],
  )
  const [w, h] = paperSizeMm(sheet)
  // Same XSS posture as TitleBlockRenderer: inline vetted template
  // output where all dynamic content has already been XML-escaped.
  const markup = { __html: svg }
  return (
    <div
      role="img"
      aria-label={`Sheet ${sheet.name} - ${sheet.title}`}
      data-testid="halofire-sheet"
      data-sheet-id={sheet.id}
      data-paper-width-mm={w}
      data-paper-height-mm={h}
      data-title-block-template={HALOFIRE_STANDARD_TEMPLATE_ID}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: vetted SVG template with XML-escaped fields
      dangerouslySetInnerHTML={markup}
    />
  )
}

export default SheetRenderer
