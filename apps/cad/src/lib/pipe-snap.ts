/** A 2D point in plan-space, in feet. */
export interface Pt {
  x: number;
  z: number;
}

/** Result of a snapping operation. */
export type SnapHit = 
  | { kind: 'node'; nodeId: string; at: Pt }
  | { kind: 'segment'; segmentId: string; at: Pt; t: number }
  | { kind: 'none'; at: Pt };

/**
 * Calculates the closest point on a line segment [a, b] to point p.
 * Clamps the projection parameter t to the range [0, 1].
 * 
 * @param p The target point.
 * @param a Start of segment.
 * @param b End of segment.
 * @returns The distance, the clamped t value, and the closest point on the segment.
 */
export function distPointToSegment2D(p: Pt, a: Pt, b: Pt): { dist: number; t: number; closest: Pt } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq === 0) {
    const dist = Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.z - a.z, 2));
    return { dist, t: 0, closest: a };
  }

  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closest: Pt = {
    x: a.x + t * dx,
    z: a.z + t * dz,
  };

  const dist = Math.sqrt(Math.pow(p.x - closest.x, 2) + Math.pow(p.z - closest.z, 2));

  return { dist, t, closest };
}

/**
 * Finds the nearest snapping target (node or segment) within a tolerance.
 * 
 * Priority:
 * 1. Nearest NODE within tolFt (smallest distance; ties by nodeId ascending).
 * 2. Nearest SEGMENT within tolFt (projection point, its t value).
 * 3. Otherwise 'none'.
 * 
 * @param p The click point.
 * @param nodes Array of network nodes with positions.
 * @param segments Array of pipe segments connecting node IDs.
 * @param tolFt Tolerance in feet.
 * @throws Error if p coordinates are non-finite or tolFt <= 0.
 */
export function snapToNetwork(p: Pt, nodes: Array<{ id: string; pos: { x: number; y: number; z: number } }>, segments: Array<{ id: string; from: string; to: string }>, tolFt: number): SnapHit {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error('Invalid point');
  if (tolFt <= 0) throw new Error('Tolerance must be positive');

  let bestNode: { id: string; dist: number } | null = null;

  // 1. Check Nodes
  for (const node of nodes) {
    const dx = p.x - node.pos.x;
    const dz = p.z - node.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= tolFt) {
      if (!bestNode || dist < bestNode.dist || (Math.abs(dist - bestNode.dist) < 1e-9 && node.id < bestNode.id)) {
        bestNode = { id: node.id, dist };
      }
    }
  }

  if (bestNode) {
    const targetNode = nodes.find((n) => n.id === bestNode!.id)!;
    return { kind: 'node', nodeId: targetNode.id, at: { x: targetNode.pos.x, z: targetNode.pos.z } };
  }

  // 2. Check Segments
  let bestSeg: { id: string; dist: number; t: number; closest: Pt } | null = null;

  for (const seg of segments) {
    const nodeFrom = nodes.find((n) => n.id === seg.from);
    const nodeTo = nodes.find((n) => n.id === seg.to);

    if (!nodeFrom || !nodeTo) continue;

    const res = distPointToSegment2D(p, { x: nodeFrom.pos.x, z: nodeFrom.pos.z }, { x: nodeTo.pos.x, z: nodeTo.pos.z });

    if (res.dist <= tolFt) {
      if (!bestSeg || res.dist < bestSeg.dist) {
        bestSeg = { id: seg.id, dist: res.dist, t: res.t, closest: res.closest };
      }
    }
  }

  if (bestSeg) {
    return { kind: 'segment', segmentId: bestSeg.id, at: bestSeg.closest, t: bestSeg.t };
  }

  return { kind: 'none', at: p };
}