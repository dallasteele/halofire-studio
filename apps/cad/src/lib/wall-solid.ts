export interface Pt2 {
  x: number;
  y: number;
}

export interface WallMesh {
  positions: number[];
  indices: number[];
  vertexCount: number;
}

export function wallSolid(start: Pt2, end: Pt2, thicknessFt: number, heightFt: number, baseY?: number): WallMesh {
  const base = baseY ?? 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-9) {
    throw new Error('Zero-length segment');
  }

  if (!Number.isFinite(length) || !Number.isFinite(thicknessFt) || !Number.isFinite(heightFt) || 
      thicknessFt <= 0 || heightFt <= 0) {
    throw new Error('Invalid input: non-finite or non-positive thickness/height');
  }

  const normalX = -dy / length;
  const normalY = dx / length;
  const halfThickness = thicknessFt / 2;

  const offsetLeft = { x: start.x + normalX * halfThickness, y: start.y + normalY * halfThickness };
  const offsetRight = { x: start.x - normalX * halfThickness, y: start.y - normalY * halfThickness };

  const endOffsetLeft = { x: end.x + normalX * halfThickness, y: end.y + normalY * halfThickness };
  const endOffsetRight = { x: end.x - normalX * halfThickness, y: end.y - normalY * halfThickness };

  const positions = [
    // Bottom face: start-left, start-right, end-right, end-left
    offsetLeft.x, offsetLeft.y, base,
    offsetRight.x, offsetRight.y, base,
    endOffsetRight.x, endOffsetRight.y, base,
    endOffsetLeft.x, endOffsetLeft.y, base,
    // Top face: same order
    offsetLeft.x, offsetLeft.y, base + heightFt,
    offsetRight.x, offsetRight.y, base + heightFt,
    endOffsetRight.x, endOffsetRight.y, base + heightFt,
    endOffsetLeft.x, endOffsetLeft.y, base + heightFt
  ];

  const indices = [
    // Bottom face: 2 triangles
    0, 1, 2,
    0, 2, 3,
    // Top face: 2 triangles
    4, 5, 6,
    4, 6, 7,
    // Front face (start-left to start-right to top-right to top-left): 2 triangles
    0, 1, 5,
    0, 5, 4,
    // Back face (end-left to end-right to top-right to top-left): 2 triangles
    3, 2, 6,
    3, 6, 7,
    // Left face (start-left to end-left to top-left to start-right): 2 triangles
    0, 3, 7,
    0, 7, 4,
    // Right face (start-right to end-right to top-right to start-left): 2 triangles
    1, 2, 6,
    1, 6, 5
  ];

  return {
    positions,
    indices,
    vertexCount: 8
  };
}