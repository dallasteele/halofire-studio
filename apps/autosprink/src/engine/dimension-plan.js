/**
 * Dimension-plan geometry helpers.
 *
 * These functions do not guess a building crop from ink density. They derive a sealed
 * plan viewport from explicit overall architectural dimensions and their authored text
 * orientation/position on the source sheet. If an orthogonal pair is unavailable or
 * contradictory the caller gets a hard failure instead of a plausible-looking model.
 */

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

/** Parse common architectural dimension text such as 201'-8", 90' - 8 1/2", or 12'. */
export function parseArchitecturalDimensionFt(value) {
  const text = String(value || '').trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const match = text.match(/^(\d+)\s*'(?:\s*-?\s*(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?\s*")?$/);
  if (!match) return null;
  const feet = Number(match[1]);
  const inches = Number(match[2] || 0);
  const numerator = Number(match[3] || 0);
  const denominator = Number(match[4] || 1);
  if (!Number.isFinite(feet) || !Number.isFinite(inches) || denominator <= 0 || inches >= 12) return null;
  return round(feet + (inches + numerator / denominator) / 12);
}

function itemOrientation(item, tolerance = 0.25) {
  const transform = Array.isArray(item?.transform) ? item.transform : null;
  if (!transform || transform.length < 4) return null;
  const a = Number(transform[0]);
  const b = Number(transform[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const magnitude = Math.hypot(a, b);
  if (magnitude <= 0) return null;
  const horizontalScore = Math.abs(a) / magnitude;
  const verticalScore = Math.abs(b) / magnitude;
  if (horizontalScore >= 1 - tolerance) return 'horizontal';
  if (verticalScore >= 1 - tolerance) return 'vertical';
  return null;
}

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Derive a whole-building viewport from the largest horizontal and vertical overall
 * dimensions. Text coordinates are PDF points; output bounds are feet.
 */
export function deriveOverallDimensionViewport(textItems, opts = {}) {
  const scaleFtPerUnit = Number(opts.scaleFtPerUnit);
  const minOverallFt = Number.isFinite(opts.minOverallFt) ? Number(opts.minOverallFt) : 50;
  const duplicateToleranceFt = Number.isFinite(opts.duplicateToleranceFt) ? Number(opts.duplicateToleranceFt) : 0.02;
  if (!Number.isFinite(scaleFtPerUnit) || scaleFtPerUnit <= 0) {
    throw new Error('deriveOverallDimensionViewport: scaleFtPerUnit must be drawing-derived and positive');
  }
  const candidates = (Array.isArray(textItems) ? textItems : [])
    .map((item) => ({
      text: String(item?.s || '').trim(),
      valueFt: parseArchitecturalDimensionFt(item?.s),
      orientation: itemOrientation(item, opts.orientationTolerance),
      xFt: Number(item?.xPt ?? item?.transform?.[4]) * scaleFtPerUnit,
      yFt: Number(item?.yPt ?? item?.transform?.[5]) * scaleFtPerUnit,
    }))
    .filter((item) => item.valueFt >= minOverallFt && item.orientation && Number.isFinite(item.xFt) && Number.isFinite(item.yFt));

  const horizontal = candidates.filter((item) => item.orientation === 'horizontal');
  const vertical = candidates.filter((item) => item.orientation === 'vertical');
  if (!horizontal.length || !vertical.length) {
    throw new Error('deriveOverallDimensionViewport: no orthogonal overall-dimension pair found');
  }
  const widthFt = Math.max(...horizontal.map((item) => item.valueFt));
  const heightFt = Math.max(...vertical.map((item) => item.valueFt));
  const widthEvidence = horizontal.filter((item) => Math.abs(item.valueFt - widthFt) <= duplicateToleranceFt);
  const heightEvidence = vertical.filter((item) => Math.abs(item.valueFt - heightFt) <= duplicateToleranceFt);
  if (!widthEvidence.length || !heightEvidence.length) {
    throw new Error('deriveOverallDimensionViewport: overall-dimension evidence is inconsistent');
  }

  // CAD dimension text is authored at the measured span center. Duplicate dimension
  // strings on opposite sides of the plan independently stabilize the orthogonal center.
  const centerXFt = median(widthEvidence.map((item) => item.xFt));
  const centerYFt = median(heightEvidence.map((item) => item.yFt));
  const boundsFt = {
    minX: round(centerXFt - widthFt / 2),
    minY: round(centerYFt - heightFt / 2),
    maxX: round(centerXFt + widthFt / 2),
    maxY: round(centerYFt + heightFt / 2),
  };
  return {
    widthFt: round(widthFt),
    heightFt: round(heightFt),
    centerFt: [round(centerXFt), round(centerYFt)],
    boundsFt,
    evidence: {
      method: 'orthogonal-authored-overall-dimensions',
      horizontal: widthEvidence,
      vertical: heightEvidence,
      candidateCount: candidates.length,
    },
  };
}

/** Clip source line segments to an axis-aligned dimension viewport (Liang-Barsky). */
export function clipSegmentsToBounds(segments, boundsFt, opts = {}) {
  const padFt = Number.isFinite(opts.padFt) ? Number(opts.padFt) : 0;
  const minX = Number(boundsFt?.minX) - padFt;
  const minY = Number(boundsFt?.minY) - padFt;
  const maxX = Number(boundsFt?.maxX) + padFt;
  const maxY = Number(boundsFt?.maxY) + padFt;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw new Error('clipSegmentsToBounds: finite non-empty bounds are required');
  }
  const output = [];
  for (const segment of (Array.isArray(segments) ? segments : [])) {
    const x1 = Number(segment.x1), y1 = Number(segment.y1), x2 = Number(segment.x2), y2 = Number(segment.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
    let accepted = true;
    for (let index = 0; index < 4; index += 1) {
      if (Math.abs(p[index]) < 1e-12) {
        if (q[index] < 0) { accepted = false; break; }
        continue;
      }
      const ratio = q[index] / p[index];
      if (p[index] < 0) t0 = Math.max(t0, ratio); else t1 = Math.min(t1, ratio);
      if (t0 > t1) { accepted = false; break; }
    }
    if (!accepted) continue;
    output.push({
      ...segment,
      x1: round(x1 + t0 * dx), y1: round(y1 + t0 * dy),
      x2: round(x1 + t1 * dx), y2: round(y1 + t1 * dy),
    });
  }
  return output;
}

export function dimensionViewportFootprint(viewport) {
  const bounds = viewport?.boundsFt || viewport;
  const minX = Number(bounds?.minX), minY = Number(bounds?.minY), maxX = Number(bounds?.maxX), maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw new Error('dimensionViewportFootprint: finite non-empty bounds are required');
  }
  return [
    [round(minX), round(minY)], [round(maxX), round(minY)],
    [round(maxX), round(maxY)], [round(minX), round(maxY)],
    [round(minX), round(minY)],
  ];
}

const unionLength = (intervals) => {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0, start = null, end = null;
  for (const interval of sorted) {
    if (start == null) { [start, end] = interval; continue; }
    if (interval[0] <= end) end = Math.max(end, interval[1]);
    else { total += end - start; [start, end] = interval; }
  }
  return start == null ? 0 : total + end - start;
};

/**
 * Independently confirm that vector wall ink supports all four dimension-derived sides.
 * Long dimension/grid lines crossing the crop do not count because support must be
 * collinear with a viewport side, not merely terminate at it after clipping.
 */
export function verifyDimensionViewportWallSupport(segments, viewport, opts = {}) {
  const bounds = viewport?.boundsFt || viewport;
  const minX = Number(bounds?.minX), minY = Number(bounds?.minY), maxX = Number(bounds?.maxX), maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw new Error('verifyDimensionViewportWallSupport: finite non-empty bounds are required');
  }
  const sideToleranceFt = Number.isFinite(opts.sideToleranceFt) ? Number(opts.sideToleranceFt) : 0.75;
  const axisToleranceFt = Number.isFinite(opts.axisToleranceFt) ? Number(opts.axisToleranceFt) : 0.08;
  const minCoverage = Number.isFinite(opts.minCoverage) ? Number(opts.minCoverage) : 0.35;
  const intervals = { bottom: [], top: [], left: [], right: [] };
  for (const segment of (Array.isArray(segments) ? segments : [])) {
    const x1 = Number(segment.x1), y1 = Number(segment.y1), x2 = Number(segment.x2), y2 = Number(segment.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    if (Math.abs(y2 - y1) <= axisToleranceFt) {
      const y = (y1 + y2) / 2;
      const interval = [Math.max(minX, Math.min(x1, x2)), Math.min(maxX, Math.max(x1, x2))];
      if (Math.abs(y - minY) <= sideToleranceFt) intervals.bottom.push(interval);
      if (Math.abs(y - maxY) <= sideToleranceFt) intervals.top.push(interval);
    }
    if (Math.abs(x2 - x1) <= axisToleranceFt) {
      const x = (x1 + x2) / 2;
      const interval = [Math.max(minY, Math.min(y1, y2)), Math.min(maxY, Math.max(y1, y2))];
      if (Math.abs(x - minX) <= sideToleranceFt) intervals.left.push(interval);
      if (Math.abs(x - maxX) <= sideToleranceFt) intervals.right.push(interval);
    }
  }
  const width = maxX - minX, height = maxY - minY;
  const coverage = {
    bottom: round(unionLength(intervals.bottom) / width),
    top: round(unionLength(intervals.top) / width),
    left: round(unionLength(intervals.left) / height),
    right: round(unionLength(intervals.right) / height),
  };
  const unsupportedSides = Object.entries(coverage).filter(([, ratio]) => ratio < minCoverage).map(([side]) => side);
  return {
    status: unsupportedSides.length ? 'blocked' : 'passed',
    method: 'independent-collinear-exterior-wall-support',
    coverage,
    minCoverage,
    unsupportedSides,
  };
}
