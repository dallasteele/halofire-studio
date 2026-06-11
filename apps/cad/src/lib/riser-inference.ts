/**
 * Riser inference for imported kernel networks (W9A).
 *
 * Imported DXF kernel networks carry nodes and segments but no riser or flow
 * direction, so hydraulics cannot solve them. This module proposes the most
 * plausible riser node and orients flow away from it. Honest partial results:
 * segments unreachable from the riser are excluded, never fabricated.
 */

export interface RiserNode {
  id: string;
  type: string;
  pos: { x: number; y: number };
}

export interface RiserSegment {
  id: string;
  from: string;
  to: string;
  diameterIn: number;
  lengthFt: number;
}

export interface RiserCandidate {
  nodeId: string;
  score: number;
  reasons: string[];
}

/** Scores every non-HEAD node and returns the best riser candidate. */
export function inferRiser(nodes: RiserNode[], segments: RiserSegment[]): RiserCandidate {
  const candidates = nodes.filter((n) => n.type !== 'HEAD');
  if (candidates.length === 0) throw new Error('no non-head nodes');

  const degree = new Map<string, number>();
  for (const s of segments) {
    degree.set(s.from, (degree.get(s.from) ?? 0) + 1);
    degree.set(s.to, (degree.get(s.to) ?? 0) + 1);
  }

  const maxDiameter = segments.reduce((m, s) => Math.max(m, s.diameterIn), -Infinity);
  const touchesMax = new Set<string>();
  for (const s of segments) {
    if (s.diameterIn === maxDiameter) {
      touchesMax.add(s.from);
      touchesMax.add(s.to);
    }
  }

  // Top-decile degree threshold among the candidates (at least one qualifies
  // when any candidate has degree > 0).
  const degrees = candidates
    .map((n) => degree.get(n.id) ?? 0)
    .sort((a, b) => b - a);
  const topDecileCount = Math.max(1, Math.ceil(degrees.length * 0.1));
  const degreeThreshold = degrees[topDecileCount - 1] ?? 0;

  // Bounding box over all node positions; near-perimeter when the distance to
  // the nearest box edge is at most 10 percent of the box diagonal.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.pos.x); maxX = Math.max(maxX, n.pos.x);
    minY = Math.min(minY, n.pos.y); maxY = Math.max(maxY, n.pos.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const perimeterTol = diag * 0.1;

  let best: RiserCandidate | null = null;
  for (const n of candidates) {
    const reasons: string[] = [];
    let score = 0;
    if (segments.length > 0 && touchesMax.has(n.id)) {
      score += 0.4;
      reasons.push('max-diameter');
    }
    const deg = degree.get(n.id) ?? 0;
    if (deg > 0 && deg >= degreeThreshold) {
      score += 0.3;
      reasons.push('high-degree');
    }
    const edgeDist = Math.min(
      n.pos.x - minX, maxX - n.pos.x,
      n.pos.y - minY, maxY - n.pos.y,
    );
    if (diag === 0 || edgeDist <= perimeterTol) {
      score += 0.3;
      reasons.push('perimeter');
    }
    if (
      best === null ||
      score > best.score ||
      (score === best.score && n.id < best.nodeId)
    ) {
      best = { nodeId: n.id, score, reasons };
    }
  }
  return best as RiserCandidate;
}

/**
 * BFS from the riser across segments (treated undirected); each reachable
 * segment is re-oriented so `from` is the node closer (in hops) to the riser.
 * Unreachable segments are excluded from the map.
 */
export function orientFlow(
  _nodes: RiserNode[],
  segments: RiserSegment[],
  riserId: string,
): Map<string, { from: string; to: string }> {
  const adj = new Map<string, RiserSegment[]>();
  for (const s of segments) {
    if (!adj.has(s.from)) adj.set(s.from, []);
    if (!adj.has(s.to)) adj.set(s.to, []);
    (adj.get(s.from) as RiserSegment[]).push(s);
    (adj.get(s.to) as RiserSegment[]).push(s);
  }
  const hops = new Map<string, number>([[riserId, 0]]);
  const queue = [riserId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const curHops = hops.get(cur) as number;
    for (const s of adj.get(cur) ?? []) {
      const other = s.from === cur ? s.to : s.from;
      if (!hops.has(other)) {
        hops.set(other, curHops + 1);
        queue.push(other);
      }
    }
  }
  const oriented = new Map<string, { from: string; to: string }>();
  for (const s of segments) {
    const hf = hops.get(s.from);
    const ht = hops.get(s.to);
    if (hf === undefined || ht === undefined) continue;
    oriented.set(s.id, hf <= ht ? { from: s.from, to: s.to } : { from: s.to, to: s.from });
  }
  return oriented;
}

/** Fraction of segments the oriented map covers (0 when there are none). */
export function solvableFraction(
  segments: RiserSegment[],
  oriented: Map<string, { from: string; to: string }>,
): number {
  if (segments.length === 0) return 0;
  return oriented.size / segments.length;
}
