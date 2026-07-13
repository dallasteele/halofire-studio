const COLUMN_LABELS = Object.freeze(Array.from({ length: 16 }, (_, index) => String(index + 1)));
const ROW_LABELS = Object.freeze('ABCDEFGH'.split(''));
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function axisValue(item, axis) {
  const transform = Array.isArray(item?.transform) ? item.transform : null;
  const fallback = axis === 'x' ? item?.xPt : item?.yPt;
  const value = Number(fallback ?? transform?.[axis === 'x' ? 4 : 5]);
  return Number.isFinite(value) ? value : null;
}

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function bestRail(textItems, labels, tolerancePt) {
  const labelSet = new Set(labels);
  const candidates = (Array.isArray(textItems) ? textItems : [])
    .map((item) => ({ label: String(item?.s || '').trim().toUpperCase(), x: axisValue(item, 'x'), y: axisValue(item, 'y') }))
    .filter((item) => labelSet.has(item.label) && item.x != null && item.y != null);
  const rails = [];
  for (const fixedAxis of ['x', 'y']) {
    const variableAxis = fixedAxis === 'x' ? 'y' : 'x';
    const buckets = new Map();
    for (const item of candidates) {
      const key = Math.round(item[fixedAxis] / tolerancePt);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    for (const items of buckets.values()) {
      const byLabel = new Map();
      for (const item of items) {
        if (!byLabel.has(item.label)) byLabel.set(item.label, []);
        byLabel.get(item.label).push(item[variableAxis]);
      }
      const controls = labels
        .filter((label) => byLabel.has(label))
        .map((label) => ({ label, valuePt: median(byLabel.get(label)) }));
      if (!controls.length) continue;
      rails.push({
        fixedAxis,
        variableAxis,
        fixedValuePt: median(items.map((item) => item[fixedAxis])),
        controls,
        uniqueLabels: controls.length,
        spreadPt: Math.max(...controls.map((entry) => entry.valuePt)) - Math.min(...controls.map((entry) => entry.valuePt)),
      });
    }
  }
  return rails.sort((left, right) => right.uniqueLabels - left.uniqueLabels || right.spreadPt - left.spreadPt)[0] || null;
}

/** Locate the complete numbered and lettered structural-grid bubble rails on a PDF page. */
export function extractLabeledGridFrame(textItems, opts = {}) {
  const tolerancePt = Number.isFinite(opts.tolerancePt) ? Number(opts.tolerancePt) : 2;
  const minColumnLabels = Number.isFinite(opts.minColumnLabels) ? Number(opts.minColumnLabels) : 12;
  const minRowLabels = Number.isFinite(opts.minRowLabels) ? Number(opts.minRowLabels) : 6;
  const columns = bestRail(textItems, COLUMN_LABELS, tolerancePt);
  const rows = bestRail(textItems, ROW_LABELS, tolerancePt);
  if (!columns || columns.uniqueLabels < minColumnLabels) {
    throw new Error(`extractLabeledGridFrame: numbered structural-grid rail is incomplete (${columns?.uniqueLabels || 0}/${minColumnLabels})`);
  }
  if (!rows || rows.uniqueLabels < minRowLabels) {
    throw new Error(`extractLabeledGridFrame: lettered structural-grid rail is incomplete (${rows?.uniqueLabels || 0}/${minRowLabels})`);
  }
  if (columns.variableAxis === rows.variableAxis) {
    throw new Error('extractLabeledGridFrame: numbered and lettered rails do not define orthogonal plan axes');
  }
  const monotonicDirection = (controls) => {
    const deltas = controls.slice(1).map((entry, index) => entry.valuePt - controls[index].valuePt);
    if (deltas.every((value) => value > 0)) return 'ascending';
    if (deltas.every((value) => value < 0)) return 'descending';
    return null;
  };
  const columnDirection = monotonicDirection(columns.controls);
  const rowDirection = monotonicDirection(rows.controls);
  if (!columnDirection || !rowDirection) {
    throw new Error('extractLabeledGridFrame: grid labels are swapped, duplicated, or non-monotonic');
  }
  return {
    columns: { ...columns, direction: columnDirection, controls: Object.fromEntries(columns.controls.map((entry) => [entry.label, round(entry.valuePt)])) },
    rows: { ...rows, direction: rowDirection, controls: Object.fromEntries(rows.controls.map((entry) => [entry.label, round(entry.valuePt)])) },
    method: 'largest-complete-labeled-grid-bubble-rails',
  };
}

function piecewiseMap(value, sourceEntries, targetEntries) {
  const pairs = sourceEntries
    .filter(([label]) => targetEntries.some(([targetLabel]) => targetLabel === label))
    .map(([label, source]) => [source, targetEntries.find(([targetLabel]) => targetLabel === label)[1], label])
    .sort((left, right) => left[0] - right[0]);
  if (pairs.length < 2) throw new Error('piecewiseMap: at least two shared grid controls are required');
  let index = pairs.findIndex(([source]) => value <= source);
  if (index <= 0) index = 1;
  if (index >= pairs.length) index = pairs.length - 1;
  const [source0, target0] = pairs[index - 1];
  const [source1, target1] = pairs[index];
  if (Math.abs(source1 - source0) < 1e-9) throw new Error('piecewiseMap: duplicate source controls are invalid');
  const ratio = (value - source0) / (source1 - source0);
  return target0 + ratio * (target1 - target0);
}

function axisEntries(frameAxis) {
  return Object.entries(frameAxis?.controls || {}).map(([label, value]) => [label, Number(value)]);
}

/** Register any source PDF point to a target sheet through the two labeled grid axes. */
export function registerPointViaLabeledGrid(pointPt, sourceFrame, targetFrame) {
  if (!Array.isArray(pointPt) || pointPt.length < 2 || !pointPt.every(Number.isFinite)) {
    throw new Error('registerPointViaLabeledGrid: finite [x,y] source point is required');
  }
  const sourceColumn = pointPt[sourceFrame.columns.variableAxis === 'x' ? 0 : 1];
  const sourceRow = pointPt[sourceFrame.rows.variableAxis === 'x' ? 0 : 1];
  const targetColumn = piecewiseMap(sourceColumn, axisEntries(sourceFrame.columns), axisEntries(targetFrame.columns));
  const targetRow = piecewiseMap(sourceRow, axisEntries(sourceFrame.rows), axisEntries(targetFrame.rows));
  const target = [null, null];
  target[targetFrame.columns.variableAxis === 'x' ? 0 : 1] = round(targetColumn);
  target[targetFrame.rows.variableAxis === 'x' ? 0 : 1] = round(targetRow);
  if (!target.every(Number.isFinite)) throw new Error('registerPointViaLabeledGrid: target grid axes did not reconstruct a 2D point');
  return target;
}

/** Verify exact control replay and quantify why one global affine should or should not be trusted. */
export function verifyLabeledGridRegistration(sourceFrame, targetFrame, opts = {}) {
  const tolerancePt = Number.isFinite(opts.tolerancePt) ? Number(opts.tolerancePt) : 0.02;
  const axes = ['columns', 'rows'];
  const controlResidualsPt = {};
  const affineResidualsPt = {};
  for (const axis of axes) {
    const source = axisEntries(sourceFrame[axis]);
    const target = axisEntries(targetFrame[axis]);
    const shared = source.filter(([label]) => target.some(([targetLabel]) => targetLabel === label));
    const mapped = shared.map(([label, value]) => piecewiseMap(value, source, target) - target.find(([targetLabel]) => targetLabel === label)[1]);
    controlResidualsPt[axis] = round(Math.max(...mapped.map(Math.abs), 0));
    const sourceValues = shared.map(([, value]) => value);
    const targetValues = shared.map(([label]) => target.find(([targetLabel]) => targetLabel === label)[1]);
    const sourceMean = sourceValues.reduce((sum, value) => sum + value, 0) / sourceValues.length;
    const targetMean = targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length;
    const denominator = sourceValues.reduce((sum, value) => sum + (value - sourceMean) ** 2, 0);
    const slope = sourceValues.reduce((sum, value, index) => sum + (value - sourceMean) * (targetValues[index] - targetMean), 0) / denominator;
    const offset = targetMean - slope * sourceMean;
    affineResidualsPt[axis] = round(Math.max(...sourceValues.map((value, index) => Math.abs(slope * value + offset - targetValues[index]))));
  }
  const issues = Object.entries(controlResidualsPt).filter(([, value]) => value > tolerancePt).map(([axis]) => `${axis}_control_residual`);
  return {
    status: issues.length ? 'blocked' : 'passed',
    method: 'labeled-piecewise-grid',
    controlResidualsPt,
    globalAffineMaxResidualsPt: affineResidualsPt,
    globalAffineRejected: Object.values(affineResidualsPt).some((value) => value > tolerancePt),
    issues,
  };
}
