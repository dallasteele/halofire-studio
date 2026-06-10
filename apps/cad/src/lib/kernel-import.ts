// W2E — 1881 kernel DXF → SprinklerNetwork slice (PURE).
//
// The predecessor pipeline's kernel DXF (e.g. the real 1881 design.dxf) draws
// sprinkler heads as CIRCLE entities on layer HALOFIRE_HEADS and pipes as LINE
// entities on layer HALOFIRE_PIPES (verified on the real artifact: 1303 head
// circles, 1758 pipe lines). This module consumes ALREADY-PARSED entities
// (plan-import's DxfCircle/DxfLine shapes) so tests stay synthetic and the DXF
// text parsing lives in one place.
//
// HONESTY: a deterministic geometry bridge. The imported network carries KERNEL
// provenance — it is the predecessor engine's design, not an AHJ/PE-approved
// layout, and importing it claims nothing beyond "these entities became nodes".

export const KERNEL_HEAD_LAYER = 'HALOFIRE_HEADS';
export const KERNEL_PIPE_LAYER = 'HALOFIRE_PIPES';
/** Two endpoints within this 2D plan distance (feet) snap to one node. */
export const SNAP_TOLERANCE_FT = 0.05;

export interface KernelCircle {
  cx: number;
  cy: number;
  layer: string;
}

export interface KernelLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
}

export interface KernelImportOpts {
  /** Feet per DXF unit (from $INSUNITS or the operator). Must be finite > 0. */
  ftPerUnit: number;
  headLayer?: string;
  pipeLayer?: string;
  /** Elevation (model y, feet) for the imported plane. Default 0. */
  zFt?: number;
  /** Nominal diameter (in) for imported pipes when unknown. Default 1. */
  defaultDiameterIn?: number;
}

export interface KernelNetwork {
  nodes: Array<{
    id: string;
    type: 'HEAD' | 'TEE' | 'ELBOW';
    pos: { x: number; y: number; z: number };
  }>;
  segments: Array<{
    id: string;
    from: string;
    to: string;
    diameterIn: number;
    lengthFt: number;
    role: 'BRANCH';
    material: 'STEEL_SCH40';
  }>;
  headCount: number;
  junctionCount: number;
  droppedZeroLength: number;
}

type KNode = KernelNetwork['nodes'][number];

/**
 * Build a network slice from kernel entities. Deterministic: ids follow input
 * order (`head_1..`, `jct_1..`, `pipe_1..`). Mapping into model space: plan
 * x -> pos.x, plan y -> pos.z, elevation -> pos.y (model.ts "y is up").
 * Pure — inputs untouched. Throws on a non-finite/non-positive ftPerUnit.
 */
export function buildKernelNetwork(
  circles: KernelCircle[],
  lines: KernelLine[],
  opts: KernelImportOpts,
): KernelNetwork {
  const ft = opts.ftPerUnit;
  if (!Number.isFinite(ft) || ft <= 0) {
    throw new Error(`buildKernelNetwork: ftPerUnit must be finite > 0; got ${ft}`);
  }
  const headLayer = opts.headLayer ?? KERNEL_HEAD_LAYER;
  const pipeLayer = opts.pipeLayer ?? KERNEL_PIPE_LAYER;
  const zFt = opts.zFt ?? 0;
  const dia = opts.defaultDiameterIn ?? 1;

  // Plan-space node registry (2D feet) for snap lookups; pos carries the model mapping.
  const nodes: KNode[] = [];
  const plan: Array<{ x: number; y: number }> = []; // parallel to nodes, plan feet

  let headCount = 0;
  for (const c of circles) {
    if (c.layer !== headLayer) continue;
    headCount += 1;
    const px = c.cx * ft;
    const py = c.cy * ft;
    nodes.push({
      id: `head_${headCount}`,
      type: 'HEAD',
      pos: { x: px, y: zFt, z: py },
    });
    plan.push({ x: px, y: py });
  }

  /** Snap a plan-feet point to an existing node id, else create a junction. */
  let junctionCount = 0;
  const degree = new Map<string, number>();
  function resolve(px: number, py: number): string {
    let best = -1;
    let bestD = SNAP_TOLERANCE_FT;
    for (let i = 0; i < plan.length; i++) {
      const d = Math.hypot(plan[i].x - px, plan[i].y - py);
      // Prefer the earliest node within tolerance (heads come first by construction).
      if (d <= bestD && (best === -1 || d < bestD)) {
        best = i;
        bestD = d;
      }
    }
    if (best !== -1) return nodes[best].id;
    junctionCount += 1;
    const id = `jct_${junctionCount}`;
    nodes.push({ id, type: 'ELBOW', pos: { x: px, y: zFt, z: py } });
    plan.push({ x: px, y: py });
    return id;
  }

  const segments: KernelNetwork['segments'] = [];
  let droppedZeroLength = 0;
  let pipeIndex = 0;
  for (const l of lines) {
    if (l.layer !== pipeLayer) continue;
    pipeIndex += 1;
    const ax = l.x1 * ft;
    const ay = l.y1 * ft;
    const bx = l.x2 * ft;
    const by = l.y2 * ft;
    const lengthFt = Math.hypot(bx - ax, by - ay);
    if (lengthFt <= SNAP_TOLERANCE_FT) {
      droppedZeroLength += 1;
      continue;
    }
    const from = resolve(ax, ay);
    const to = resolve(bx, by);
    segments.push({
      id: `pipe_${pipeIndex}`,
      from,
      to,
      diameterIn: dia,
      lengthFt: Math.round(lengthFt * 1e4) / 1e4,
      role: 'BRANCH',
      material: 'STEEL_SCH40',
    });
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
  }

  // Junction typing: degree >= 3 -> TEE, else ELBOW (heads keep their type).
  for (const n of nodes) {
    if (n.type === 'HEAD') continue;
    n.type = (degree.get(n.id) ?? 0) >= 3 ? 'TEE' : 'ELBOW';
  }

  return { nodes, segments, headCount, junctionCount, droppedZeroLength };
}
