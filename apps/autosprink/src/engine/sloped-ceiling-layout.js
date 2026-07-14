import { z } from 'zod';

const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Obstruction = z.object({ id: z.string(), kind: z.literal('ceiling-fan'), centerSubmittedPt: Point, clearanceFt: z.number().positive(), preferredSide: z.enum(['negative-x', 'positive-x', 'negative-y', 'positive-y']) }).strict();
const LinearObstruction = z.object({
  id: z.string().min(1), kind: z.literal('box-beam'), axis: z.enum(['x', 'y']),
  stationSubmittedPt: z.number().finite(), widthIn: z.number().positive(), spansRegion: z.literal(true),
  partitionProtectionRegion: z.literal(true),
}).strict();
const Region = z.object({
  id: z.string().min(1), polygonSubmittedPt: z.array(Point).min(4),
  slopeAxis: z.enum(['x', 'y']), downhillDirection: z.enum(['positive-x', 'negative-x', 'positive-y', 'negative-y']),
  riseIn: z.number().positive(), runIn: z.number().positive(), shouldProtect: z.boolean(),
  obstructions: z.array(Obstruction), linearObstructions: z.array(LinearObstruction).optional().default([]),
}).strict();
const Input = z.object({
  artifactType: z.literal('halofire.sloped-ceiling-layout-input.v1'),
  printedScalePtPerFt: z.number().positive(), regions: z.array(Region).min(1),
  maxAcrossSlopeSpanFt: z.number().positive(), maxAlongSlopeSpanFt: z.number().positive(),
}).strict();

const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const bounds = (polygon) => ({
  minX: Math.min(...polygon.map((point) => point[0])), maxX: Math.max(...polygon.map((point) => point[0])),
  minY: Math.min(...polygon.map((point) => point[1])), maxY: Math.max(...polygon.map((point) => point[1])),
});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const intervals = (min, max, stations) => {
  const breaks = [min, ...stations.filter((value) => value > min && value < max).sort((a, b) => a - b), max];
  return breaks.slice(0, -1).map((start, index) => [start, breaks[index + 1]]);
};

export function generateSlopedCeilingLayout(inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success) return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_INPUT_INVALID', parsed.error.message)] };
  const input = parsed.data;
  const heads = [];
  const regions = [];
  for (const region of input.regions) {
    const box = bounds(region.polygonSubmittedPt);
    const widthFt = (box.maxX - box.minX) / input.printedScalePtPerFt;
    const heightFt = (box.maxY - box.minY) / input.printedScalePtPerFt;
    if (!region.shouldProtect) {
      regions.push({ regionId: region.id, shouldProtect: false, generatedHeadCount: 0, widthFt, heightFt });
      continue;
    }
    if (region.linearObstructions.length && region.obstructions.length) return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_MIXED_OBSTRUCTION_PARTITION_UNSUPPORTED', `Region ${region.id} combines point-clearance and linear-partition obstructions.`)] };
    const linearKeys = region.linearObstructions.map((entry) => `${entry.axis}:${entry.stationSubmittedPt}`);
    const invalidLinear = region.linearObstructions.find((entry) => {
      const [min, max] = entry.axis === 'x' ? [box.minY, box.maxY] : [box.minX, box.maxX];
      const halfWidthPt = entry.widthIn / 24 * input.printedScalePtPerFt;
      return entry.stationSubmittedPt - halfWidthPt <= min || entry.stationSubmittedPt + halfWidthPt >= max;
    });
    if (new Set(linearKeys).size !== linearKeys.length || invalidLinear) return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_LINEAR_OBSTRUCTION_INVALID', `Region ${region.id} has duplicate or out-of-bounds linear obstruction partitions.`)] };
    const acrossFt = region.slopeAxis === 'y' ? widthFt : heightFt;
    const alongFt = region.slopeAxis === 'y' ? heightFt : widthFt;
    const regionHeads = [];
    const xIntervals = intervals(box.minX, box.maxX, region.linearObstructions.filter((entry) => entry.axis === 'y').map((entry) => entry.stationSubmittedPt));
    const yIntervals = intervals(box.minY, box.maxY, region.linearObstructions.filter((entry) => entry.axis === 'x').map((entry) => entry.stationSubmittedPt));
    const cells = xIntervals.flatMap((xRange, xIndex) => yIntervals.map((yRange, yIndex) => ({ id: `${region.id}-cell-${xIndex + 1}-${yIndex + 1}`, xRange, yRange })));
    const cellTallies = [];
    for (const [cellIndex, cell] of cells.entries()) {
      const cellWidthFt = (cell.xRange[1] - cell.xRange[0]) / input.printedScalePtPerFt;
      const cellHeightFt = (cell.yRange[1] - cell.yRange[0]) / input.printedScalePtPerFt;
      const cellAcrossFt = region.slopeAxis === 'y' ? cellWidthFt : cellHeightFt;
      const cellAlongFt = region.slopeAxis === 'y' ? cellHeightFt : cellWidthFt;
      const cellAcrossCount = Math.max(1, Math.ceil(cellAcrossFt / input.maxAcrossSlopeSpanFt));
      const cellAlongCount = Math.max(1, Math.ceil(cellAlongFt / input.maxAlongSlopeSpanFt));
      cellTallies.push({ cellId: cell.id, widthFt: cellWidthFt, heightFt: cellHeightFt, acrossCount: cellAcrossCount, alongCount: cellAlongCount, generatedHeadCount: cellAcrossCount * cellAlongCount });
      for (let acrossIndex = 0; acrossIndex < cellAcrossCount; acrossIndex += 1) {
        for (let alongIndex = 0; alongIndex < cellAlongCount; alongIndex += 1) {
          const acrossFraction = (acrossIndex + 0.5) / cellAcrossCount;
          const alongFraction = (alongIndex + 0.5) / cellAlongCount;
          const xFraction = region.slopeAxis === 'y' ? acrossFraction : alongFraction;
          const yFraction = region.slopeAxis === 'y' ? alongFraction : acrossFraction;
          const pointPt = [cell.xRange[0] + xFraction * (cell.xRange[1] - cell.xRange[0]), cell.yRange[0] + yFraction * (cell.yRange[1] - cell.yRange[0])];
          const globalAlongFraction = region.slopeAxis === 'y' ? (pointPt[1] - box.minY) / (box.maxY - box.minY) : (pointPt[0] - box.minX) / (box.maxX - box.minX);
          const downhillFraction = region.downhillDirection.startsWith('positive-') ? globalAlongFraction : 1 - globalAlongFraction;
          const relativeElevationFt = (1 - downhillFraction) * alongFt * region.riseIn / region.runIn;
          regionHeads.push({ id: `${region.id}-generated-${heads.length + regionHeads.length + 1}`, regionId: region.id, pointPt, relativeElevationFt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, acrossIndex: cellIndex * 1000 + acrossIndex, ...(region.linearObstructions.length ? { partitionCellId: cell.id } : {}) });
        }
      }
    }
    const acrossCount = region.linearObstructions.length ? Math.max(...cellTallies.map((entry) => entry.acrossCount)) * (region.slopeAxis === 'x' ? yIntervals.length : xIntervals.length) : cellTallies[0].acrossCount;
    const alongCount = region.linearObstructions.length ? Math.max(...cellTallies.map((entry) => entry.alongCount)) * (region.slopeAxis === 'x' ? xIntervals.length : yIntervals.length) : cellTallies[0].alongCount;
    const obstructionAdjustments = [];
    for (const obstruction of region.obstructions) {
      const clearancePt = obstruction.clearanceFt * input.printedScalePtPerFt;
      for (let acrossIndex = 0; acrossIndex < acrossCount; acrossIndex += 1) {
        const column = regionHeads.filter((head) => head.acrossIndex === acrossIndex);
        if (region.slopeAxis === 'y' && obstruction.preferredSide.endsWith('-x')) {
          const allowed = column.flatMap((head) => { const dy = Math.abs(head.pointPt[1] - obstruction.centerSubmittedPt[1]); if (dy >= clearancePt) return []; const dx = Math.sqrt(clearancePt ** 2 - dy ** 2); return [obstruction.centerSubmittedPt[0] + (obstruction.preferredSide === 'negative-x' ? -dx : dx)]; });
          if (allowed.length) {
            const current = column[0].pointPt[0]; const adjusted = obstruction.preferredSide === 'negative-x' ? Math.min(current, ...allowed) : Math.max(current, ...allowed);
            for (const head of column) head.pointPt[0] = adjusted;
            obstructionAdjustments.push({ obstructionId: obstruction.id, acrossIndex, fromPt: current, toPt: adjusted, clearanceFt: obstruction.clearanceFt, alignment: 'shared-branch-centerline' });
          }
        }
      }
    }
    heads.push(...regionHeads.map(({ acrossIndex: _acrossIndex, ...head }) => head));
    const regionResult = { regionId: region.id, shouldProtect: true, generatedHeadCount: regionHeads.length, widthFt, heightFt, acrossCount, alongCount, obstructionAdjustments };
    regions.push(region.linearObstructions.length ? { ...regionResult, linearObstructionPartitions: region.linearObstructions.map((entry) => ({ id: entry.id, kind: entry.kind, axis: entry.axis, stationSubmittedPt: entry.stationSubmittedPt, widthIn: entry.widthIn })), partitionCells: cellTallies } : regionResult);
  }
  return { status: 'passed', artifactType: 'halofire.sloped-ceiling-layout.v1', heads, regions, issues: [], complianceReady: false, claimStatus: 'calibration-candidate-not-code-compliance-or-approval' };
}

export function verifySlopedCeilingLayoutParity(layout, calibrationPacket, matchToleranceFt = 5) {
  if (!layout || layout.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_NOT_GENERATED', 'A passed sloped layout is required.')] };
  const scale = calibrationPacket?.printedScalePtPerFt;
  if (!Number.isFinite(scale) || scale <= 0) return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_CALIBRATION_INVALID', 'A sealed calibration packet is required.')] };
  const submittedById = new Map(calibrationPacket.submittedHeads.map((head) => [head.id, head]));
  const matches = [];
  const unmatchedGenerated = [];
  const matchedSubmitted = new Set();
  for (const generated of layout.heads) {
    const region = calibrationPacket.slopeRegions.find((entry) => entry.id === generated.regionId);
    const candidates = (region?.submittedHeadIds || []).filter((id) => !matchedSubmitted.has(id)).map((id) => submittedById.get(id)).filter(Boolean);
    const nearest = candidates.map((head) => ({ head, distanceFt: distance(generated.pointPt, head.pointPt) / scale })).sort((a, b) => a.distanceFt - b.distanceFt)[0];
    if (nearest && nearest.distanceFt <= matchToleranceFt) {
      matchedSubmitted.add(nearest.head.id);
      matches.push({ generatedHeadId: generated.id, submittedHeadId: nearest.head.id, regionId: generated.regionId, distanceFt: Number(nearest.distanceFt.toFixed(3)) });
    } else unmatchedGenerated.push(generated.id);
  }
  const expectedSubmitted = calibrationPacket.slopeRegions.flatMap((region) => region.submittedHeadIds);
  const unmatchedSubmitted = expectedSubmitted.filter((id) => !matchedSubmitted.has(id));
  const falsePositiveEmptyRegions = layout.regions.filter((region) => {
    const reference = calibrationPacket.slopeRegions.find((entry) => entry.id === region.regionId);
    return reference?.protectionBasis === 'completed-bid-no-submitted-heads' && region.generatedHeadCount > 0;
  }).map((region) => region.regionId);
  const errors = matches.map((match) => match.distanceFt);
  const parityReady = unmatchedGenerated.length === 0 && unmatchedSubmitted.length === 0 && falsePositiveEmptyRegions.length === 0 && matches.length > 0;
  return {
    status: parityReady ? 'passed' : 'blocked', artifactType: 'halofire.sloped-ceiling-layout-parity.v1',
    issues: parityReady ? [] : [issue('SLOPED_LAYOUT_PARITY_INCOMPLETE', 'Generated sloped layout does not reproduce the completed protected-region answer key.')],
    matches, unmatchedGenerated, unmatchedSubmitted, falsePositiveEmptyRegions,
    metrics: { precision: layout.heads.length ? matches.length / layout.heads.length : 0, recall: expectedSubmitted.length ? matches.length / expectedSubmitted.length : 0, maxPlanErrorFt: errors.length ? Math.max(...errors) : null, meanPlanErrorFt: errors.length ? Number((errors.reduce((sum, value) => sum + value, 0) / errors.length).toFixed(3)) : null },
    generatedLayoutParityReady: parityReady, complianceReady: false,
    claimStatus: 'completed-bid-geometric-parity-not-code-compliance-or-approval',
  };
}

export function renderSlopedCeilingLayoutViews(layout, parity, model3d = null) {
  if (!layout || layout.status !== 'passed' || !parity || parity.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_LAYOUT_VIEW_NOT_VERIFIED', 'Passed layout and parity evidence are required.')] };
  const topMarks = layout.heads.map((head) => `<g data-generated-head-id="${head.id}"><circle cx="${head.pointPt[0]}" cy="${head.pointPt[1]}" r="8" fill="#007aff"/><path d="M ${head.pointPt[0] - 10} ${head.pointPt[1]} H ${head.pointPt[0] + 10} M ${head.pointPt[0]} ${head.pointPt[1] - 10} V ${head.pointPt[1] + 10}" stroke="#fff" stroke-width="2"/></g>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3024 2160" role="img" aria-label="Generated Dillon slope-aware top view"><rect width="3024" height="2160" fill="#fff"/>${topMarks}</svg>`;
  const ordered = [...layout.heads].sort((a, b) => a.pointPt[1] - b.pointPt[1]);
  const elevationValues = ordered.map((head) => model3d?.heads?.find((entry) => entry.id === head.id)?.pointFt?.[2] ?? head.relativeElevationFt);
  const absolute = Boolean(model3d?.absoluteElevationReady);
  const protectedSurfaces = model3d?.surfaces?.filter((surface) => surface.shouldProtect && surface.elevationProfile) ?? [];
  const profileElevations = protectedSurfaces.flatMap((surface) => [surface.elevationProfile.uphill.elevationFt, surface.elevationProfile.downhill.elevationFt]);
  const allElevations = [...elevationValues, ...profileElevations]; const minZ = Math.min(...allElevations); const maxZ = Math.max(...allElevations);
  const maxSpanFt = Math.max(1, ...protectedSurfaces.map((surface) => surface.elevationProfile.spanFt));
  const xAt = (stationFt) => 60 + stationFt / maxSpanFt * 1480; const yAt = (value) => 500 - ((value - minZ) / Math.max(.01, maxZ - minZ)) * 360;
  const profilePaths = protectedSurfaces.map((surface) => { const profile = surface.elevationProfile; return `<g data-elevation-surface-id="${surface.id}"><path d="M ${xAt(profile.uphill.stationFt)} ${yAt(profile.uphill.elevationFt)} L ${xAt(profile.downhill.stationFt)} ${yAt(profile.downhill.elevationFt)}" stroke="#ff9f0a" stroke-width="5" fill="none"/><text x="70" y="535" font-size="16">${profile.pitch.riseIn}:${profile.pitch.runIn} · ${profile.spanFt.toFixed(2)} ft run · ${profile.riseFt.toFixed(2)} ft rise · ${profile.sourceDatumStatus}</text></g>`; }).join('');
  const scale = model3d?.printedScalePtPerFt ?? 13.5;
  const elevationMarks = ordered.map((head, index) => { const value = elevationValues[index]; const surface = protectedSurfaces.find((entry) => entry.id === head.regionId); let stationFt = index * maxSpanFt / Math.max(1, ordered.length - 1); if (surface) { const values = surface.vertices.map((vertex) => surface.slope.axis === 'y' ? vertex.pointFt[1] : vertex.pointFt[0]); const along = surface.slope.axis === 'y' ? head.pointPt[1] / scale : head.pointPt[0] / scale; stationFt = surface.slope.downhillDirection.startsWith('positive-') ? along - Math.min(...values) : Math.max(...values) - along; } const x = xAt(stationFt); const y = yAt(value); return `<g data-elevation-head-id="${head.id}"><circle cx="${x}" cy="${y}" r="9" fill="#007aff"/><text x="${x + 14}" y="${y - 8}" font-size="18">${value.toFixed(2)} ft ${absolute ? 'project elevation' : 'relative'}</text></g>`; }).join('');
  const fallbackPath = protectedSurfaces.length ? '' : '<path d="M 60 500 L 1540 130" stroke="#ff9f0a" stroke-width="5"/>';
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 560" role="img" aria-label="Generated Dillon 3:12 ${absolute ? 'absolute project' : 'relative'} elevation view"><rect width="1600" height="560" fill="#fff"/>${fallbackPath}${profilePaths}${elevationMarks}</svg>`;
  return { status: 'passed', topSvg, elevationSvg, complianceReady: false };
}
