// Mirrored from pdfjs-dist's OPS enum so the pure extraction helpers remain importable
// in dependency-light test environments.
export const OPS = Object.freeze({
  setLineWidth: 2,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  setStrokeColor: 52,
  setStrokeColorN: 53,
  setStrokeRGBColor: 58,
  constructPath: 91,
});
