/**
 * R9.3 — Canonical node-type → DXF layer mapping.
 *
 * Used by the DXF/DWG export pipeline (services/halofire-cad) and by
 * SheetNode layer-visibility toggles in the editor. The Python mirror
 * at `services/halofire-cad/cad/layer_mapping.py` MUST stay in sync —
 * any edit here without a matching edit there is a CI parity failure.
 *
 * See blueprints:
 *   - 07_DRAWING_SHEET_MANAGEMENT.md §10 (DXF export layer naming)
 *   - 11_EXPORTS_AND_HANDOFF.md §6
 */

/** Canonical DXF layer name for a scene-node type.
 *  Pascal node.type → DXF layer on export. */
export const NODE_TYPE_TO_DXF_LAYER: Record<string, string> = {
  sprinkler_head: 'FP-HEADS',
  pipe: 'FP-PIPES', // further refined by role at runtime
  fitting: 'FP-FITTINGS',
  valve: 'FP-VALVES',
  hanger: 'FP-HANGERS',
  device: 'FP-DEVICES',
  fdc: 'FP-FDC',
  riser_assembly: 'FP-RISER',
  remote_area: 'FP-REMOTE-AREA',
  obstruction: 'OBS',
  wall: '0-ARCH',
  slab: '0-ARCH-SLAB',
  ceiling: '0-ARCH-CEIL',
  door: '0-ARCH-DOOR',
  window: '0-ARCH-WINDOW',
  item: 'FP-ITEMS',
  sheet: '0-TITLE',
}

/** Derive the refined pipe layer by pipe role. */
export function pipeLayerForRole(role: string | undefined): string {
  switch (role) {
    case 'drop':
      return 'FP-PIPES-DROP'
    case 'branch':
      return 'FP-PIPES-BRANCH'
    case 'cross_main':
    case 'feed_main':
    case 'main':
      return 'FP-PIPES-MAIN'
    case 'riser':
    case 'riser_nipple':
      return 'FP-PIPES-RISER'
    case 'standpipe':
      return 'FP-STANDPIPE'
    default:
      return 'FP-PIPES'
  }
}

/** Apply a SheetNode.viewport.layer_visibility record to a list of
 *  DXF-bound nodes. Returns only the node ids whose layer is
 *  currently visible. A missing entry in `layer_visibility` means
 *  the layer defaults to visible. */
export function filterByLayerVisibility(
  nodeIdsByLayer: Record<string, string[]>,
  layer_visibility: Record<string, boolean> | undefined,
): string[] {
  const out: string[] = []
  for (const [layer, ids] of Object.entries(nodeIdsByLayer)) {
    const visible =
      layer_visibility === undefined ||
      layer_visibility[layer] === undefined ||
      layer_visibility[layer] === true
    if (visible) out.push(...ids)
  }
  return out
}

/** Layer → color-index (ACI) map used by ezdxf. */
export const LAYER_ACI_COLOR: Record<string, number> = {
  'FP-HEADS': 1, // red
  'FP-PIPES': 1,
  'FP-PIPES-MAIN': 1,
  'FP-PIPES-BRANCH': 1,
  'FP-PIPES-DROP': 1,
  'FP-PIPES-RISER': 1,
  'FP-FITTINGS': 1,
  'FP-VALVES': 6, // magenta
  'FP-HANGERS': 3, // green
  'FP-DEVICES': 4, // cyan
  'FP-FDC': 1,
  'FP-STANDPIPE': 1,
  '0-ARCH': 8, // grey
  '0-ARCH-SLAB': 8,
  '0-ARCH-CEIL': 8,
  '0-ARCH-DOOR': 8,
  '0-ARCH-WINDOW': 5, // blue
  OBS: 7, // white/black
  '0-TITLE': 7,
  'FP-DIMS': 2, // yellow
  'FP-ANNOT': 2,
}
