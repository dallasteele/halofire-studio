export interface Pt { x: number; y: number; }

export type DrawingElement = {
  id: string;
} & (
  { kind: 'line'; a: Pt; b: Pt } |
  { kind: 'polyline'; points: Pt[] } |
  { kind: 'arc'; center: Pt; radiusFt: number; startDeg: number; endDeg: number } |
  { kind: 'circle'; center: Pt; radiusFt: number } |
  { kind: 'rectangle'; corner: Pt; widthFt: number; heightFt: number } |
  { kind: 'point'; at: Pt }
);

function validatePt(pt: Pt): void {
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    throw new Error('Point coordinates must be finite numbers');
  }
}

function validateRadius(radius: number): void {
  if (radius <= 0 || !Number.isFinite(radius)) {
    throw new Error('Radius must be a positive finite number');
  }
}

function validateDimensions(dim: number): void {
  if (dim <= 0 || !Number.isFinite(dim)) {
    throw new Error('Dimensions must be positive finite numbers');
  }
}

export function makeLine(id: string, a: Pt, b: Pt): DrawingElement {
  validatePt(a);
  validatePt(b);
  if (a.x === b.x && a.y === b.y) {
    throw new Error('Line segment must have distinct endpoints');
  }
  return { id, kind: 'line', a, b };
}

export function makePolyline(id: string, points: Pt[]): DrawingElement {
  if (points.length < 2) {
    throw new Error('Polyline must have at least 2 points');
  }
  points.forEach(validatePt);
  return { id, kind: 'polyline', points };
}

export function makeArc(id: string, center: Pt, radiusFt: number, startDeg: number, endDeg: number): DrawingElement {
  validatePt(center);
  validateRadius(radiusFt);
  if (!Number.isFinite(startDeg) || !Number.isFinite(endDeg)) {
    throw new Error('Arc angles must be finite numbers');
  }
  const normalizedStart = startDeg % 360;
  const normalizedEnd = endDeg % 360;
  return {
    id,
    kind: 'arc',
    center,
    radiusFt,
    startDeg: normalizedStart,
    endDeg: normalizedEnd
  };
}

export function makeCircle(id: string, center: Pt, radiusFt: number): DrawingElement {
  validatePt(center);
  validateRadius(radiusFt);
  return { id, kind: 'circle', center, radiusFt };
}

export function makeRectangle(id: string, corner: Pt, widthFt: number, heightFt: number): DrawingElement {
  validatePt(corner);
  validateDimensions(widthFt);
  validateDimensions(heightFt);
  return { id, kind: 'rectangle', corner, widthFt, heightFt };
}

export function makePoint(id: string, at: Pt): DrawingElement {
  validatePt(at);
  return { id, kind: 'point', at };
}

export function elementLengthFt(el: DrawingElement): number {
  switch (el.kind) {
    case 'line':
      return Math.hypot(el.b.x - el.a.x, el.b.y - el.a.y);
    case 'polyline':
      return el.points.reduce((sum, p, i) => {
        if (i === 0) return sum;
        return sum + Math.hypot(p.x - el.points[i-1].x, p.y - el.points[i-1].y);
      }, 0);
    case 'arc':
      const sweep = ((el.endDeg - el.startDeg + 360) % 360);
      return 2 * Math.PI * el.radiusFt * (sweep / 360);
    case 'circle':
      return 2 * Math.PI * el.radiusFt;
    case 'rectangle':
      return 2 * (el.widthFt + el.heightFt);
    case 'point':
      return 0;
  }
}

export function elementAreaFt2(el: DrawingElement): number {
  switch (el.kind) {
    case 'circle':
      return Math.PI * el.radiusFt * el.radiusFt;
    case 'rectangle':
      return el.widthFt * el.heightFt;
    case 'polyline':
      if (el.points.length < 3 || !arePointsEqual(el.points[0], el.points[el.points.length - 1])) {
        return 0;
      }
      return Math.abs(shoelace(el.points));
    default:
      return 0;
  }
}

function arePointsEqual(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

function shoelace(points: Pt[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
}
