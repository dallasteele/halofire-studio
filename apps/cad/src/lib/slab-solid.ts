// W4B — floor/ceiling slab mesh from a room polygon (PURE).
//
// Fan triangulation from vertex 0 — correct for convex polygons (the trace
// tool produces convex-ish rooms). HONEST LIMIT: concave rooms can produce
// overlapping fan triangles; ear-clipping is the documented follow-up. Mapping:
// plan x -> world x, plan y -> world z, slab extruded DOWN from elevationY.

export interface Pt2 {
  x: number;
  y: number;
}

export interface SlabMesh {
  positions: number[];
  indices: number[];
  vertexCount: number;
}

/**
 * Build a horizontal slab: top face at `elevationY`, bottom at
 * `elevationY - thicknessFt`. For N polygon points: 2N vertices (top ring then
 * bottom ring, polygon order), (N-2)*2 fan triangles for top+bottom and N side
 * quads (2 triangles each). Winding: top face CCW viewed from above (+Y),
 * bottom face mirrored, sides outward. Throws on <3 points, non-finite input,
 * non-positive thickness, or repeated consecutive points.
 */
export function slabSolid(polygon: Pt2[], elevationY: number, thicknessFt: number): SlabMesh {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error(`slabSolid: polygon needs >= 3 points; got ${polygon?.length ?? 0}`);
  }
  if (!Number.isFinite(elevationY)) {
    throw new Error(`slabSolid: elevationY must be finite; got ${elevationY}`);
  }
  if (!Number.isFinite(thicknessFt) || thicknessFt <= 0) {
    throw new Error(`slabSolid: thicknessFt must be finite > 0; got ${thicknessFt}`);
  }
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p = polygon[i];
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
      throw new Error(`slabSolid: polygon[${i}] is non-finite`);
    }
    const q = polygon[(i + 1) % n];
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) {
      throw new Error(`slabSolid: repeated consecutive points at index ${i}`);
    }
  }

  const top = elevationY;
  const bottom = elevationY - thicknessFt;
  const positions: number[] = [];
  // Top ring (indices 0..n-1), then bottom ring (n..2n-1), polygon order.
  for (const p of polygon) positions.push(p.x, top, p.y);
  for (const p of polygon) positions.push(p.x, bottom, p.y);

  const indices: number[] = [];
  // Top face fan (viewed from +Y; plan CCW maps to world CW because plan y ->
  // world z, so emit reversed for an up-facing CCW winding).
  for (let i = 1; i < n - 1; i++) indices.push(0, i + 1, i);
  // Bottom face fan, mirrored (faces down).
  for (let i = 1; i < n - 1; i++) indices.push(n, n + i, n + i + 1);
  // Side quads: edge i -> i+1 (top a, top b, bottom b, bottom a).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i;
    const b = j;
    const a2 = n + i;
    const b2 = n + j;
    indices.push(a, b, b2, a, b2, a2);
  }

  return { positions, indices, vertexCount: 2 * n };
}
