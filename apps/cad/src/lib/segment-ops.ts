// AutoSprink Commands-menu operations, pure form: Break (C1), Divide (C2),
// Reverse (C3) over a network slice. All three return NEW objects — inputs are
// never mutated — so they slot straight into the store's undoable mutate path.
//
// HONESTY: pure geometry/topology edits. No AHJ/PE/parity claim.

export interface NetworkSlice {
  nodes: Array<{ id: string; type: string; pos: { x: number; y: number; z: number } }>;
  segments: Array<{
    id: string;
    from: string;
    to: string;
    diameterIn: number;
    lengthFt: number;
    role: string;
    material: string;
  }>;
}

type Seg = NetworkSlice['segments'][number];
type Nd = NetworkSlice['nodes'][number];

/** Find a segment by id or throw with a clear message. */
function mustFindSegment(net: NetworkSlice, segmentId: string): Seg {
  const seg = net.segments.find((s) => s.id === segmentId);
  if (!seg) throw new Error(`segment '${segmentId}' not found`);
  return seg;
}

/** Linear interpolation between two node positions at parameter t. */
function lerp(a: Nd['pos'], b: Nd['pos'], t: number): Nd['pos'] {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * C1 Break: split one segment at parameter t (0 < t < 1) by inserting a new
 * FITTING node linearly interpolated between the endpoints. The segment is
 * replaced by two segments (from->new at lengthFt*t, new->to at lengthFt*(1-t))
 * preserving diameterIn/role/material. Pure. Throws on t outside (0,1), a
 * missing segment/endpoint, or when any new id already exists.
 */
export function breakSegment(
  net: NetworkSlice,
  segmentId: string,
  t: number,
  newNodeId: string,
  seg1Id: string,
  seg2Id: string,
): NetworkSlice {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) {
    throw new Error(`breakSegment: t must be in (0,1); got ${t}`);
  }
  const seg = mustFindSegment(net, segmentId);
  const a = net.nodes.find((n) => n.id === seg.from);
  const b = net.nodes.find((n) => n.id === seg.to);
  if (!a || !b) throw new Error(`breakSegment: segment '${segmentId}' has a missing endpoint node`);
  const nodeIds = new Set(net.nodes.map((n) => n.id));
  const segIds = new Set(net.segments.map((s) => s.id));
  if (nodeIds.has(newNodeId)) throw new Error(`breakSegment: node id '${newNodeId}' already exists`);
  for (const id of [seg1Id, seg2Id]) {
    if (segIds.has(id) && id !== segmentId) {
      throw new Error(`breakSegment: segment id '${id}' already exists`);
    }
  }
  if (seg1Id === seg2Id) throw new Error('breakSegment: seg1Id and seg2Id must differ');

  const mid: Nd = { id: newNodeId, type: 'FITTING', pos: lerp(a.pos, b.pos, t) };
  const common = { diameterIn: seg.diameterIn, role: seg.role, material: seg.material };
  const seg1: Seg = { id: seg1Id, from: seg.from, to: newNodeId, lengthFt: seg.lengthFt * t, ...common };
  const seg2: Seg = { id: seg2Id, from: newNodeId, to: seg.to, lengthFt: seg.lengthFt * (1 - t), ...common };
  return {
    nodes: [...net.nodes.map((n) => ({ ...n, pos: { ...n.pos } })), mid],
    segments: net.segments.flatMap((s) => (s.id === segmentId ? [seg1, seg2] : [{ ...s }])),
  };
}

/**
 * C2 Divide: split one segment into N equal parts (integer 2..50) by repeated
 * interpolation. Creates N-1 nodes `${idPrefix}_n1..` and N segments
 * `${idPrefix}_s1..`, each of length lengthFt/N (summing to the original).
 * Pure. Throws on a non-integer or out-of-range N, or a missing segment/endpoint.
 */
export function divideSegment(
  net: NetworkSlice,
  segmentId: string,
  parts: number,
  idPrefix: string,
): NetworkSlice {
  if (!Number.isInteger(parts) || parts < 2 || parts > 50) {
    throw new Error(`divideSegment: parts must be an integer in 2..50; got ${parts}`);
  }
  const seg = mustFindSegment(net, segmentId);
  const a = net.nodes.find((n) => n.id === seg.from);
  const b = net.nodes.find((n) => n.id === seg.to);
  if (!a || !b) throw new Error(`divideSegment: segment '${segmentId}' has a missing endpoint node`);

  const newNodes: Nd[] = [];
  for (let i = 1; i < parts; i++) {
    newNodes.push({ id: `${idPrefix}_n${i}`, type: 'FITTING', pos: lerp(a.pos, b.pos, i / parts) });
  }
  const chain = [seg.from, ...newNodes.map((n) => n.id), seg.to];
  const common = { diameterIn: seg.diameterIn, role: seg.role, material: seg.material };
  const newSegs: Seg[] = [];
  for (let i = 0; i < parts; i++) {
    newSegs.push({
      id: `${idPrefix}_s${i + 1}`,
      from: chain[i],
      to: chain[i + 1],
      lengthFt: seg.lengthFt / parts,
      ...common,
    });
  }
  return {
    nodes: [...net.nodes.map((n) => ({ ...n, pos: { ...n.pos } })), ...newNodes],
    segments: net.segments.flatMap((s) => (s.id === segmentId ? newSegs : [{ ...s }])),
  };
}

/**
 * C3 Reverse: swap one segment's from/to. Pure. Throws when the id is missing.
 */
export function reverseSegment(net: NetworkSlice, segmentId: string): NetworkSlice {
  mustFindSegment(net, segmentId);
  return {
    nodes: net.nodes.map((n) => ({ ...n, pos: { ...n.pos } })),
    segments: net.segments.map((s) =>
      s.id === segmentId ? { ...s, from: s.to, to: s.from } : { ...s },
    ),
  };
}
