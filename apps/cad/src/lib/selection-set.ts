// W2D — multi-selection model + window/crossing marquee hit tests (PURE).
// Built by the GX10 qwen agent loop (gates + spec-verifier green), harvested to
// main after a host crash interrupted its push. Feeds the future selection
// engine (E1) so shift-click + drag-marquee + bulk ops land as one undo step.
//
// HONESTY: pure geometry/selection logic. No AHJ/PE/parity claim.

export interface Pt { x: number; y: number; }
export interface Rect { minX: number; minY: number; maxX: number; maxY: number; }
export type SelKind = 'node' | 'segment' | 'room';
export interface SelectionSet { nodeIds: string[]; segmentIds: string[]; roomIds: string[]; }

export function emptySelection(): SelectionSet {
  return { nodeIds: [], segmentIds: [], roomIds: [] };
}

export function selectionCount(sel: SelectionSet): number {
  return sel.nodeIds.length + sel.segmentIds.length + sel.roomIds.length;
}

/**
 * Toggle one id in the selection. Non-additive: replace the whole selection with
 * just this id in its kind list. Additive: toggle membership (keeping other
 * kinds), output sorted. Throws on an empty id.
 */
export function togglePick(sel: SelectionSet, kind: SelKind, id: string, additive: boolean): SelectionSet {
  if (id === '') {
    throw new Error('empty id');
  }
  const { nodeIds, segmentIds, roomIds } = sel;
  const update = (ids: string[], pick: string): string[] => {
    const index = ids.indexOf(pick);
    if (additive) {
      return index === -1 ? [...ids, pick].sort() : ids.filter((i) => i !== pick).sort();
    }
    return [pick];
  };
  switch (kind) {
    case 'node':
      return { nodeIds: update(nodeIds, id), segmentIds: additive ? segmentIds : [], roomIds: additive ? roomIds : [] };
    case 'segment':
      return { nodeIds: additive ? nodeIds : [], segmentIds: update(segmentIds, id), roomIds: additive ? roomIds : [] };
    case 'room':
      return { nodeIds: additive ? nodeIds : [], segmentIds: additive ? segmentIds : [], roomIds: update(roomIds, id) };
  }
}

export function normalizeRect(a: Pt, b: Pt): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function pointInRect(p: Pt, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

export function segmentInRect(a: Pt, b: Pt, r: Rect): boolean {
  return pointInRect(a, r) && pointInRect(b, r);
}

/** True when either endpoint is inside the rect OR the segment crosses any edge. */
export function segmentIntersectsRect(a: Pt, b: Pt, r: Rect): boolean {
  const orient = (p: Pt, q: Pt, s: Pt): number =>
    (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);

  const bbox = (p: Pt, q: Pt): Rect => ({
    minX: Math.min(p.x, q.x),
    minY: Math.min(p.y, q.y),
    maxX: Math.max(p.x, q.x),
    maxY: Math.max(p.y, q.y),
  });

  const segmentsIntersect = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean => {
    const o1 = orient(p1, p2, p3);
    const o2 = orient(p1, p2, p4);
    const o3 = orient(p3, p4, p1);
    const o4 = orient(p3, p4, p2);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
      return true;
    }
    // collinear-overlap: a zero orientation with the point inside the other segment's bbox
    if (o1 === 0 && pointInRect(p3, bbox(p1, p2))) return true;
    if (o2 === 0 && pointInRect(p4, bbox(p1, p2))) return true;
    if (o3 === 0 && pointInRect(p1, bbox(p3, p4))) return true;
    if (o4 === 0 && pointInRect(p2, bbox(p3, p4))) return true;
    return false;
  };

  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const corners: Pt[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

export interface MarqueeItems {
  nodes: Array<{ id: string; at: Pt }>;
  segments: Array<{ id: string; a: Pt; b: Pt }>;
}

/**
 * Window mode selects fully-contained items; crossing mode selects any item
 * touching the rect. Rooms are never marquee-selected here. Output is sorted.
 */
export function marqueeSelect(
  items: MarqueeItems,
  cornerA: Pt,
  cornerB: Pt,
  mode: 'window' | 'crossing',
): SelectionSet {
  const rect = normalizeRect(cornerA, cornerB);
  const nodeIds: string[] = [];
  const segmentIds: string[] = [];
  for (const node of items.nodes) {
    if (pointInRect(node.at, rect)) nodeIds.push(node.id);
  }
  for (const seg of items.segments) {
    const hit = mode === 'window'
      ? segmentInRect(seg.a, seg.b, rect)
      : segmentIntersectsRect(seg.a, seg.b, rect);
    if (hit) segmentIds.push(seg.id);
  }
  return { nodeIds: nodeIds.sort(), segmentIds: segmentIds.sort(), roomIds: [] };
}
