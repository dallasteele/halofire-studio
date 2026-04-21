/**
 * DimStyle — paper-space style for Dimension primitives.
 *
 * Fork addition (HaloFire Studio). Blueprint 07 §5 names DimStyle as
 * the companion primitive to Dimension: one controls WHAT is measured
 * (Dimension — points, offset, kind), the other controls HOW it
 * renders (DimStyle — text height, arrow kind, extension lines,
 * colour).
 *
 * This lives in `schema/nodes/` beside the Dimension schema so that
 * dimension primitives and their styles are easy to find together,
 * but DimStyle is NOT a scene node — there is no BaseNode, no id
 * prefix, and no entry in AnyNode. It is a standalone primitive that
 * Sheets reference by `style_id`.
 */
import dedent from 'dedent'
import { z } from 'zod'

/** Arrowhead style drawn at each end of a dimension line. */
export const DimArrowKind = z.enum([
  'tick',          // NFPA / arch drawings — 45° tick
  'open_arrow',    // open chevron
  'closed_arrow',  // filled triangular arrowhead
  'dot',           // filled dot (ordinate / minimal dims)
])
export type DimArrowKind = z.infer<typeof DimArrowKind>

export const DimStyle = z.object({
  id: z.string(),
  name: z.string(),
  text_height_mm: z.number().positive().default(2.5),
  arrow_kind: DimArrowKind.default('tick'),
  arrow_size_mm: z.number().positive().default(2.0),
  extension_line_offset_mm: z.number().nonnegative().default(1.5),
  extension_line_extend_mm: z.number().nonnegative().default(1.5),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
}).describe(dedent`
  DimStyle — paper-space style for Dimension primitives (blueprint 07 §5).

  Controls HOW a Dimension renders: text height, arrow kind, extension
  line offsets, and colour. Referenced by Dimension.style_id. Not a
  scene node — stored in the firm's style library or inline on a
  sheet-set document.
`)
export type DimStyle = z.infer<typeof DimStyle>

/** HaloFire default style — a clean tick-based 1:1 AHJ look. */
export const DEFAULT_DIM_STYLE: DimStyle = DimStyle.parse({
  id: 'halofire.default',
  name: 'HaloFire Default',
})
