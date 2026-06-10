// AutoSprink "Tag Leaks" (Commands menu) — find OPEN PIPE ENDS in the sprinkler
// network: connection points where water would escape. A leak is (a) a segment
// endpoint referencing a node id that does not exist (dangling reference), or
// (b) a degree-1 node whose type is NOT a closed/terminal type (HEAD, SOURCE,
// VALVE). Degree-0 nodes are unpiped, not open — not leaks.
//
// HONESTY: pure topology analysis. No AHJ/PE/parity claim.

export interface Leak {
  nodeId: string;
  reason: 'dangling-reference' | 'open-end';
  segmentIds: string[];
}

export interface LeakReport {
  leaks: Leak[];
  checkedNodes: number;
  checkedSegments: number;
  clean: boolean;
}

/** Node types that legitimately terminate a pipe run at degree 1. */
const TERMINAL_TYPES = new Set(['HEAD', 'SOURCE', 'VALVE']);

/**
 * Find open pipe ends. Degree counts every segment endpoint touching the node
 * (a self-loop counts 2). Dangling references report the MISSING id with the
 * referencing segments. Leaks are sorted by nodeId for determinism. Pure.
 */
export function findLeaks(net: {
  nodes: Array<{ id: string; type: string }>;
  segments: Array<{ id: string; from: string; to: string }>;
}): LeakReport {
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  const touching = new Map<string, string[]>();
  const danglingSegs = new Map<string, string[]>();

  for (const seg of net.segments) {
    for (const end of [seg.from, seg.to]) {
      if (!nodeById.has(end)) {
        const list = danglingSegs.get(end) ?? [];
        if (!list.includes(seg.id)) list.push(seg.id);
        danglingSegs.set(end, list);
        continue;
      }
      degree.set(end, (degree.get(end) ?? 0) + 1);
      const list = touching.get(end) ?? [];
      if (!list.includes(seg.id)) list.push(seg.id);
      touching.set(end, list);
    }
  }

  const leaks: Leak[] = [];
  for (const [missingId, segmentIds] of danglingSegs) {
    leaks.push({ nodeId: missingId, reason: 'dangling-reference', segmentIds });
  }
  for (const node of net.nodes) {
    if ((degree.get(node.id) ?? 0) === 1 && !TERMINAL_TYPES.has(node.type)) {
      leaks.push({
        nodeId: node.id,
        reason: 'open-end',
        segmentIds: touching.get(node.id) ?? [],
      });
    }
  }
  leaks.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));

  return {
    leaks,
    checkedNodes: net.nodes.length,
    checkedSegments: net.segments.length,
    clean: leaks.length === 0,
  };
}
