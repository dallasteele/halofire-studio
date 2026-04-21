# Blueprint 07 — Drawing & Sheet Management

**Scope:** Sheet sets, title blocks, paper space vs model space,
scale + viewports, dimensioning, annotation, legends, revision
clouds. What lets the app produce a bound AHJ submittal.

## 1. Paper space vs model space

- **Model space** — the 3D + 2D scene at 1:1 real-world scale.
  User drafts here.
- **Paper space** — a sheet with title block, viewports (framed
  views into model space), dimensions, annotations, revision
  bubbles.

Both live in the same `.hfproj`. Sheets are first-class Pascal
nodes (SheetNode).

## 2. SheetNode schema

```typescript
export const SheetNode = BaseNode.extend({
  id: objectId('sheet'),
  type: nodeType('sheet'),
  name: z.string(),                       // 'FP-003'
  title: z.string(),                      // 'Level 2 — Sprinkler Plan'
  paper_size: z.enum([
    'ARCH_A', 'ARCH_B', 'ARCH_C', 'ARCH_D', 'ARCH_E',
    'ANSI_A', 'ANSI_B', 'ANSI_C', 'ANSI_D', 'ANSI_E',
    'ISO_A4', 'ISO_A3', 'ISO_A2', 'ISO_A1', 'ISO_A0',
  ]).default('ARCH_D'),                   // 24 × 36 typical commercial
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  title_block_id: z.string(),             // references a TitleBlock template
  viewports: z.array(Viewport).default([]),
  annotations: z.array(Annotation).default([]),
  revision_clouds: z.array(RevisionCloud).default([]),
  sheet_index: z.number(),                // sort order in the sheet set
  discipline: z.enum([
    'fire_protection', 'mechanical', 'plumbing',
    'electrical', 'structural', 'architectural',
  ]).default('fire_protection'),
  revision: z.string().default('V0'),
})

export const Viewport = z.object({
  id: z.string(),
  // Paper-space rectangle on the sheet, in mm.
  paper_rect_mm: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  // What it frames in model space.
  camera: z.object({
    kind: z.enum(['top', 'iso', 'front', 'side', 'custom']),
    level_id: z.string().optional(),
    target: z.tuple([z.number(), z.number(), z.number()]).optional(),
    up: z.tuple([z.number(), z.number(), z.number()]).optional(),
  }),
  scale: z.enum([
    '1_96', '1_48', '1_32', '1_24', '1_16', '1_8',  // imperial (1/N"=1')
    '1_100', '1_50', '1_25', '1_10',                 // metric (1:N)
  ]),                                     // paper/model ratio
  layer_visibility: z.record(z.string(), z.boolean()).optional(),
})
```

## 3. Title block template

`packages/halofire-catalog/title-blocks/<firm>.json` — JSON + SVG.

```json
{
  "id": "halofire.standard",
  "svg_template": "halofire-standard.svg",
  "fields": [
    { "key": "project_name", "x_mm": 500, "y_mm": 20, "font_size_pt": 14 },
    { "key": "sheet_number", "x_mm": 580, "y_mm": 20, "font_size_pt": 18 },
    { "key": "revision",     "x_mm": 560, "y_mm": 40, "font_size_pt": 10 },
    { "key": "pe_seal_slot", "x_mm":  80, "y_mm": 40, "w_mm": 60, "h_mm": 60 }
  ]
}
```

SVG is rendered over the paper-space canvas; fields substituted
from the project manifest.

## 4. Default sheet set

When a project is stamped, the app generates a default sheet set
if one doesn't exist:

| Sheet | Content |
|---|---|
| FP-001 | Cover + legend + symbols + abbreviations |
| FP-002 | Site plan with FDC + hydrant locations |
| FP-003 to FP-00N | One floor plan per level, top view |
| FP-00N+1 | Riser diagram (schematic, not to scale) |
| FP-00N+2 | Hydraulic calculation summary |
| FP-00N+3 | BOM / stocklist |
| FP-00N+4 | Detail sheet (typical head drop, typical hanger, FDC detail) |

User can add/remove/reorder. Each sheet is a SheetNode.

## 5. Dimensioning

### 5.1 DimensionEntity

```typescript
export const Dimension = z.object({
  id: z.string(),
  kind: z.enum(['linear', 'continuous', 'aligned', 'ordinate',
                'radial', 'diameter', 'angular']),
  points: z.array(z.tuple([z.number(), z.number()])),  // model-space
  dim_line_offset_m: z.number(),                       // perpendicular offset
  text_override: z.string().optional(),                // default: computed
  precision: z.number().default(2),                    // decimal places
  unit_display: z.enum(['ft_in', 'decimal_ft', 'm', 'mm']).default('ft_in'),
  style_id: z.string(),                                // references DimStyle
  sheet_id: z.string().optional(),                     // paper-space only
})
```

### 5.2 DimStyle

Stored per-firm:

```typescript
export const DimStyle = z.object({
  id: z.string(),
  name: z.string(),
  text_height_mm: z.number().default(2.5),
  arrow_kind: z.enum(['tick', 'open_arrow', 'closed_arrow', 'dot']),
  arrow_size_mm: z.number().default(2.0),
  extension_line_offset_mm: z.number().default(1.5),
  extension_line_extend_mm: z.number().default(1.5),
  color: z.string().default('#000000'),
})
```

### 5.3 Auto-dim pipe runs

Command "Auto-dimension pipe run": selects a system, places
continuous-dim strings on every branch with distances between
heads + fittings. Saves ~2 hrs per bid vs manual dim.

## 6. Annotation (text + leader)

```typescript
export const Annotation = z.object({
  id: z.string(),
  kind: z.enum(['note', 'callout', 'label', 'tag', 'zone_name']),
  text: z.string(),                        // may reference fields: {{pipe.size_in}}
  anchor_model: z.tuple([z.number(), z.number(), z.number()]).optional(),
  anchor_node_id: z.string().optional(),
  text_position_paper_mm: z.tuple([z.number(), z.number()]),
  leader_polyline_mm: z.array(z.tuple([z.number(), z.number()])).default([]),
  style_id: z.string(),
})
```

Label automation rules (applied on demand):

- "Label every pipe size change" — auto-annotation on every
  PipeNode whose size differs from its upstream neighbor.
- "Label every head SKU" — annotation on every SprinklerHeadNode
  showing `{{sku}}` or `K-{{k_factor}}`.
- "Label every system" — annotation near each riser with
  `{{system.id}} · {{system.hazard}}`.

## 7. Hatches / fills

Shaded regions per hazard class. Rendering in both model and
paper space.

```typescript
export const Hatch = z.object({
  id: z.string(),
  polygon_m: z.array(z.tuple([z.number(), z.number()])),
  pattern: z.enum(['solid', 'ansi31', 'ansi32', 'dots', 'cross']),
  color: z.string(),
  opacity: z.number().min(0).max(1).default(0.2),
  label: z.string().optional(),             // 'OH2 — Parking garage'
})
```

## 8. Revision clouds + bubbles

```typescript
export const RevisionCloud = z.object({
  id: z.string(),
  revision_id: z.string(),                  // references a Revision
  polyline_m: z.array(z.tuple([z.number(), z.number()])),
  bubble_number: z.number(),                // auto-assigned
  note: z.string(),                         // AHJ correction
  status: z.enum(['open', 'resolved']).default('open'),
})
```

Every revision cloud ties back to a Revision entry (see
blueprint 12). Exported PDF draws the cloud + number bubble.

## 9. Sheet rendering pipeline

Paper-space rendering stack:

1. **Paper canvas** (SVG @ 1:1 mm) — fixed backdrop.
2. **Title block SVG** — overlaid, fields substituted.
3. **Viewports** — each a framed `<canvas>` rendering a three.js
   scene at the viewport scale, layer_visibility applied.
4. **Annotations + dims + clouds** — SVG overlay on top.
5. **PDF export** — pdf-lib composes all SVG + raster layers.

Implementation in `packages/editor/src/components/sheet/`:

- `sheet-renderer.tsx` — the composite.
- `title-block-renderer.tsx` — SVG with field templating.
- `viewport-renderer.tsx` — three.js attached to an offscreen
  canvas, drawn as a raster into the SVG.
- `annotation-layer.tsx` — SVG overlay.

## 10. Export

- **PDF** — one PDF per sheet, or bound set. pdf-lib composition
  from the sheet SVGs.
- **DXF** — export paper-space to DXF layers (title block =
  `0-TITLE`, dims = `DIM`, heads = `FP-HEADS`, etc). Round-trips
  with AutoCAD.
- **DWG** — via LibreDWG or OpenDWG bridge. P1.

## 11. Tests

- `packages/editor/tests/sheet-renderer.spec.ts` — renders a
  fixture sheet, asserts title block fields + viewport presence.
- Playwright: create default sheet set from fixture project,
  verify page count + page sizes in the exported PDF.

## 12. Open questions

- User-authored title block templates in-app vs firm-provided
  SVG files. — Firm-provided v1; in-app editor post-1.0.
- Revit `rfa` title-block round-trip — stretch goal.
