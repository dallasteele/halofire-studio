const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const length = (segment) => Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const endpoints = (segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]];

const styleMatches = (segment, style, tolerance) => {
  if (style.strokeColor != null && String(segment.strokeColor).toLowerCase() !== String(style.strokeColor).toLowerCase()) return false;
  if (style.lineWidth != null && Math.abs(Number(segment.lineWidth) - Number(style.lineWidth)) > tolerance) return false;
  return true;
};
const orientation = (segment) => {
  const dx = Math.abs(segment.x2 - segment.x1); const dy = Math.abs(segment.y2 - segment.y1);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle <= 2) return 'horizontal'; if (angle >= 88) return 'vertical';
  if (Math.abs(angle - 45) <= 8) return 'diagonal'; return 'other';
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function clusterValues(items, valueOf, tolerance) {
  const sorted = [...items].sort((a, b) => valueOf(a) - valueOf(b)); const clusters = [];
  for (const item of sorted) {
    const value = valueOf(item); const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - median(last.map(valueOf))) > tolerance) clusters.push([item]); else last.push(item);
  }
  return clusters;
}

function clusterEndpoints(segments, tolerance) {
  const points = segments.flatMap((segment, segmentIndex) => endpoints(segment).map((point, endpointIndex) => ({ point, segment, segmentIndex, endpointIndex })));
  const clusters = [];
  for (const item of points) {
    let best = null; let bestDistance = Infinity;
    for (const cluster of clusters) {
      const center = [median(cluster.map((entry) => entry.point[0])), median(cluster.map((entry) => entry.point[1]))];
      const distance = pointDistance(item.point, center);
      if (distance <= tolerance && distance < bestDistance) { best = cluster; bestDistance = distance; }
    }
    if (best) best.push(item); else clusters.push([item]);
  }
  return clusters.map((members) => ({
    members,
    center: [round(median(members.map((entry) => entry.point[0]))), round(median(members.map((entry) => entry.point[1])))],
  }));
}

function deriveRidgeEndpointRectangles(segments, mainRidge, featureStyle, styleTolerance, opts) {
  const minFt = Number.isFinite(opts.featureRectMinFt) ? Number(opts.featureRectMinFt) : 4;
  const maxFt = Number.isFinite(opts.featureRectMaxFt) ? Number(opts.featureRectMaxFt) : 15;
  const toleranceFt = Number.isFinite(opts.featureRectToleranceFt) ? Number(opts.featureRectToleranceFt) : 0.35;
  const proximityFt = Number.isFinite(opts.featureRidgeEndpointProximityFt) ? Number(opts.featureRidgeEndpointProximityFt) : 20;
  const styled = segments.filter((segment) => styleMatches(segment, featureStyle, styleTolerance));
  const horizontals = styled.filter((segment) => orientation(segment) === 'horizontal' && length(segment) >= minFt && length(segment) <= maxFt)
    .map((segment) => ({ segment, minX: Math.min(segment.x1, segment.x2), maxX: Math.max(segment.x1, segment.x2), y: (segment.y1 + segment.y2) / 2 }));
  const verticals = styled.filter((segment) => orientation(segment) === 'vertical' && length(segment) >= minFt && length(segment) <= maxFt)
    .map((segment) => ({ segment, x: (segment.x1 + segment.x2) / 2, minY: Math.min(segment.y1, segment.y2), maxY: Math.max(segment.y1, segment.y2) }));
  const rectangles = [];
  for (let i = 0; i < horizontals.length - 1; i++) for (let j = i + 1; j < horizontals.length; j++) {
    const a = horizontals[i]; const b = horizontals[j]; const height = Math.abs(a.y - b.y); const width = (a.maxX - a.minX + b.maxX - b.minX) / 2;
    if (height < minFt || height > maxFt || width < minFt || width > maxFt || Math.abs(a.minX - b.minX) > toleranceFt || Math.abs(a.maxX - b.maxX) > toleranceFt) continue;
    const minX = (a.minX + b.minX) / 2; const maxX = (a.maxX + b.maxX) / 2; const minY = Math.min(a.y, b.y); const maxY = Math.max(a.y, b.y);
    const left = verticals.find((entry) => Math.abs(entry.x - minX) <= toleranceFt && Math.abs(entry.minY - minY) <= toleranceFt && Math.abs(entry.maxY - maxY) <= toleranceFt);
    const right = verticals.find((entry) => Math.abs(entry.x - maxX) <= toleranceFt && Math.abs(entry.minY - minY) <= toleranceFt && Math.abs(entry.maxY - maxY) <= toleranceFt);
    if (!left && !right) continue;
    const center = [(minX + maxX) / 2, (minY + maxY) / 2];
    const distance = Math.min(pointDistance(center, mainRidge.from), pointDistance(center, mainRidge.to));
    if (distance > proximityFt || Math.abs(center[1] - mainRidge.from[1]) > maxFt) continue;
    rectangles.push({ minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY), centerFt: center.map((value) => round(value)), distanceToRidgeEndpointFt: round(distance), sourceSegmentCount: 2 + Number(Boolean(left)) + Number(Boolean(right)) });
  }
  const unique = new Map(rectangles.map((rectangle) => [`${rectangle.minX},${rectangle.minY},${rectangle.maxX},${rectangle.maxY}`, rectangle]));
  return [...unique.values()].sort((a, b) => a.distanceToRidgeEndpointFt - b.distanceToRidgeEndpointFt);
}

/**
 * Extract a main horizontal ridge plus orthogonal cross-gable ridge/valley skeletons from
 * vector roof-plan linework. Styles are caller-supplied source observations; geometry selection
 * is based on paired opposing valley arms and ridge/valley endpoint agreement, never target area.
 */
export function deriveOrthogonalGableRoofSkeleton(segments, opts = {}) {
  const source = Array.isArray(segments) ? segments.filter((segment) => [segment.x1, segment.y1, segment.x2, segment.y2].every(Number.isFinite)) : [];
  const ridgeStyle = opts.ridgeStyle || {};
  const valleyStyle = opts.valleyStyle || {};
  const styleTolerance = Number.isFinite(opts.styleTolerance) ? Number(opts.styleTolerance) : 0.015;
  const minMainRidgeFt = Number.isFinite(opts.minMainRidgeFt) ? Number(opts.minMainRidgeFt) : 30;
  const minGableRidgeFt = Number.isFinite(opts.minGableRidgeFt) ? Number(opts.minGableRidgeFt) : 8;
  const minValleyFt = Number.isFinite(opts.minValleyFt) ? Number(opts.minValleyFt) : 8;
  const axisClusterFt = Number.isFinite(opts.axisClusterFt) ? Number(opts.axisClusterFt) : 1.1;
  const valleyApexClusterFt = Number.isFinite(opts.valleyApexClusterFt) ? Number(opts.valleyApexClusterFt) : 1.6;
  const ridgeApexToleranceFt = Number.isFinite(opts.ridgeApexToleranceFt) ? Number(opts.ridgeApexToleranceFt) : 5;

  const ridgeSegments = source.filter((segment) => styleMatches(segment, ridgeStyle, styleTolerance));
  const horizontal = ridgeSegments.filter((segment) => orientation(segment) === 'horizontal' && length(segment) >= minMainRidgeFt);
  if (!horizontal.length) return { status: 'blocked', mainRidge: null, crossGables: [], issues: [{ code: 'ROOF_MAIN_RIDGE_MISSING' }] };
  const horizontalClusters = clusterValues(horizontal, (segment) => (segment.y1 + segment.y2) / 2, axisClusterFt);
  const mainCluster = horizontalClusters.sort((a, b) => Math.max(...b.map(length)) - Math.max(...a.map(length)))[0];
  const mainRepresentative = [...mainCluster].sort((a, b) => length(b) - length(a))[0];
  const mainRidge = {
    from: [round(Math.min(mainRepresentative.x1, mainRepresentative.x2)), round(median(mainCluster.flatMap((segment) => [segment.y1, segment.y2])))],
    to: [round(Math.max(mainRepresentative.x1, mainRepresentative.x2)), round(median(mainCluster.flatMap((segment) => [segment.y1, segment.y2])))],
    sourceSegmentCount: mainCluster.length,
  };

  const vertical = ridgeSegments.filter((segment) => orientation(segment) === 'vertical' && length(segment) >= minGableRidgeFt);
  const verticalClusters = clusterValues(vertical, (segment) => (segment.x1 + segment.x2) / 2, axisClusterFt)
    .flatMap((sameAxis) => {
      const ordered = [...sameAxis].sort((left, right) => Math.min(left.y1, left.y2) - Math.min(right.y1, right.y2));
      const runs = [];
      for (const segment of ordered) {
        const minY = Math.min(segment.y1, segment.y2); const maxY = Math.max(segment.y1, segment.y2); const last = runs[runs.length - 1];
        if (!last || minY > last.maxY + axisClusterFt) runs.push({ members: [segment], maxY });
        else { last.members.push(segment); last.maxY = Math.max(last.maxY, maxY); }
      }
      return runs.map((run) => run.members);
    })
    .map((members) => {
      const x = median(members.flatMap((segment) => [segment.x1, segment.x2]));
      const ys = members.flatMap((segment) => [segment.y1, segment.y2]);
      return { members, x: round(x), minY: round(Math.min(...ys)), maxY: round(Math.max(...ys)) };
    });
  const valleys = source.filter((segment) => styleMatches(segment, valleyStyle, styleTolerance) && orientation(segment) === 'diagonal' && length(segment) >= minValleyFt);
  const apexClusters = clusterEndpoints(valleys, valleyApexClusterFt).filter((cluster) => {
    const arms = cluster.members.map((member) => {
      const other = endpoints(member.segment)[1 - member.endpointIndex];
      return Math.sign(other[0] - cluster.center[0]);
    });
    return arms.some((value) => value < 0) && arms.some((value) => value > 0);
  });

  const crossGables = [];
  for (const ridge of verticalClusters) {
    const innerEnd = Math.abs(ridge.minY - mainRidge.from[1]) < Math.abs(ridge.maxY - mainRidge.from[1]) ? [ridge.x, ridge.minY] : [ridge.x, ridge.maxY];
    const outerEnd = innerEnd[1] === ridge.minY ? [ridge.x, ridge.maxY] : [ridge.x, ridge.minY];
    const candidates = apexClusters
      .filter((cluster) => Math.abs(cluster.center[0] - ridge.x) <= axisClusterFt * 2)
      .map((cluster) => ({ cluster, distance: pointDistance(cluster.center, innerEnd) }))
      .filter((entry) => entry.distance <= ridgeApexToleranceFt)
      .sort((a, b) => a.distance - b.distance);
    if (!candidates.length) continue;
    const apex = candidates[0].cluster;
    const armOptions = apex.members.map((member) => ({ member, other: endpoints(member.segment)[1 - member.endpointIndex] }));
    const left = armOptions.filter((entry) => entry.other[0] < apex.center[0]).sort((a, b) => pointDistance(a.member.point, apex.center) - pointDistance(b.member.point, apex.center))[0];
    const right = armOptions.filter((entry) => entry.other[0] > apex.center[0]).sort((a, b) => pointDistance(a.member.point, apex.center) - pointDistance(b.member.point, apex.center))[0];
    if (!left || !right) continue;
    crossGables.push({
      id: `gable-${crossGables.length + 1}`,
      axisXFt: round(ridge.x),
      ridgeOuterFt: outerEnd.map((value) => round(value)),
      ridgeInnerFt: apex.center.map((value) => round(value)),
      leftEaveFt: left.other.map((value) => round(value)),
      rightEaveFt: right.other.map((value) => round(value)),
      valleyArmCount: apex.members.length,
      sourceRidgeSegmentCount: ridge.members.length,
    });
  }
  crossGables.sort((a, b) => a.axisXFt - b.axisXFt || a.ridgeOuterFt[1] - b.ridgeOuterFt[1]);
  crossGables.forEach((gable, index) => { gable.id = `gable-${index + 1}`; });
  const expectedGableCount = Number.isInteger(opts.expectedGableCount) ? opts.expectedGableCount : null;
  const issues = [];
  if (expectedGableCount != null && crossGables.length !== expectedGableCount) issues.push({ code: 'ROOF_CROSS_GABLE_COUNT_MISMATCH', expected: expectedGableCount, actual: crossGables.length });
  const featureStyle = opts.featureStyle || ridgeStyle;
  const maxRidgeEndFeatures = Number.isInteger(opts.maxRidgeEndFeatures) ? Math.max(0, opts.maxRidgeEndFeatures) : Infinity;
  const roofFeatures = deriveRidgeEndpointRectangles(source, mainRidge, featureStyle, styleTolerance, opts)
    .slice(0, maxRidgeEndFeatures)
    .map((rectangle, index) => ({ id: `ridge-end-rect-${index + 1}`, kind: 'ridge-end-rectangular-feature', ...rectangle }));
  return {
    status: issues.length ? 'blocked' : 'passed',
    method: 'source-vector-lineweight-ridge-plus-opposed-valley-arms',
    mainRidge,
    crossGables: issues.length ? [] : crossGables,
    roofFeatures,
    counts: { ridgeStyleSegments: ridgeSegments.length, valleyStyleSegments: valleys.length, candidateApexClusters: apexClusters.length, crossGables: crossGables.length, roofFeatures: roofFeatures.length },
    issues,
    claimStatus: 'source-bound-roof-plan-skeleton-only-not-elevation-or-compliance',
  };
}
