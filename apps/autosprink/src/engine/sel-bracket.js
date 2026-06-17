const DEFAULT_PIXEL_SIZE = 10;
const MIN_PIXEL_SIZE = 6;
const MAX_PIXEL_SIZE = 12;
const DEFAULT_CORNER_RATIO = 0.34;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pointXYZ(point) {
  if (!point) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(point)) {
    return { x: num(point[0]), y: num(point[1]), z: num(point[2]) };
  }
  return { x: num(point.x), y: num(point.y), z: num(point.z) };
}

function vectorBetween(a, b) {
  return { x: num(a.x) - num(b.x), y: num(a.y) - num(b.y), z: num(a.z) - num(b.z) };
}

function vectorLength(v) {
  return Math.hypot(num(v.x), num(v.y), num(v.z));
}

function normalize(v, fallback = { x: 0, y: 0, z: -1 }) {
  const len = vectorLength(v);
  if (len <= 1e-9) return { ...fallback };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a, b) {
  return num(a.x) * num(b.x) + num(a.y) * num(b.y) + num(a.z) * num(b.z);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cameraForward(camera, worldPoint) {
  if (camera && typeof camera.getWorldDirection === 'function') {
    const forward = camera.getWorldDirection({
      x: 0,
      y: 0,
      z: -1,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
      normalize() {
        const n = normalize(this);
        this.x = n.x; this.y = n.y; this.z = n.z;
        return this;
      },
    });
    return normalize(forward);
  }
  const target = camera && (camera.target || camera.lookAtTarget)
    ? pointXYZ(camera.target || camera.lookAtTarget)
    : pointXYZ(worldPoint);
  return normalize(vectorBetween(target, pointXYZ(camera && camera.position)));
}

export function selectionBracketPixelSize(options = {}) {
  return clamp(
    num(options.pixelSize, DEFAULT_PIXEL_SIZE),
    num(options.minPixelSize, MIN_PIXEL_SIZE),
    num(options.maxPixelSize, MAX_PIXEL_SIZE),
  );
}

export function selectionBracketViewDepth(camera, worldPoint) {
  const camPos = pointXYZ(camera && camera.position);
  const point = pointXYZ(worldPoint);
  const toPoint = vectorBetween(point, camPos);
  const forward = cameraForward(camera, point);
  const depth = Math.abs(dot(toPoint, forward));
  return depth > 1e-6 ? depth : vectorLength(toPoint);
}

export function selectionBracketWorldSize(camera, worldPoint, viewportHeightPx, options = {}) {
  const pxSize = selectionBracketPixelSize(options);
  const viewportPx = Math.max(1, num(viewportHeightPx, 1));
  if (camera && camera.isOrthographicCamera) {
    const zoom = Math.max(1e-6, num(camera.zoom, 1));
    const frustumHeight = Math.abs(num(camera.top) - num(camera.bottom)) / zoom;
    return (frustumHeight / viewportPx) * pxSize;
  }
  const depth = Math.max(1e-6, selectionBracketViewDepth(camera, worldPoint));
  const fovDeg = num(camera && camera.fov, 50);
  const fovRad = (fovDeg * Math.PI) / 180;
  const frustumHeight = 2 * depth * Math.tan(fovRad / 2);
  return (frustumHeight / viewportPx) * pxSize;
}

export function selectionBracketCornerSegments(options = {}) {
  const corner = clamp(num(options.cornerRatio, DEFAULT_CORNER_RATIO), 0.15, 0.48);
  const min = -0.5;
  const max = 0.5;
  return [
    [min, max, 0, min + corner, max, 0],
    [min, max, 0, min, max - corner, 0],
    [max, max, 0, max - corner, max, 0],
    [max, max, 0, max, max - corner, 0],
    [min, min, 0, min + corner, min, 0],
    [min, min, 0, min, min + corner, 0],
    [max, min, 0, max - corner, min, 0],
    [max, min, 0, max, min + corner, 0],
  ];
}
