import { z } from 'zod';

const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Obstruction = z.object({ id: z.string(), kind: z.literal('ceiling-fan'), centerSubmittedPt: Point, clearanceFt: z.number().positive(), preferredSide: z.enum(['negative-x', 'positive-x', 'negative-y', 'positive-y']) }).strict();
const Region = z.object({
  id: z.string().min(1), polygonSubmittedPt: z.array(Point).min(4),
  slopeAxis: z.enum(['x', 'y']), downhillDirection: z.enum(['positive-x', 'negative-x', 'positive-y', 'negative-y']),
  riseIn: z.number().positive(), runIn: z.number().positive(), shouldProtect: z.boolean(),
  obstructions: z.array(Obstruction),
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
    const acrossFt = region.slopeAxis === 'y' ? widthFt : heightFt;
    const alongFt = region.slopeAxis === 'y' ? heightFt : widthFt;
    const acrossCount = Math.max(1, Math.ceil(acrossFt / input.maxAcrossSlopeSpanFt));
    const alongCount = Math.max(1, Math.ceil(alongFt / input.maxAlongSlopeSpanFt));
    const regionHeads = [];
    for (let acrossIndex = 0; acrossIndex < acrossCount; acrossIndex += 1) {
      for (let alongIndex = 0; alongIndex < alongCount; alongIndex += 1) {
        const acrossFraction = (acrossIndex + 0.5) / acrossCount;
        const alongFraction = (alongIndex + 0.5) / alongCount;
        const xFraction = region.slopeAxis === 'y' ? acrossFraction : alongFraction;
        const yFraction = region.slopeAxis === 'y' ? alongFraction : acrossFraction;
        const pointPt = [box.minX + xFraction * (box.maxX - box.minX), box.minY + yFraction * (box.maxY - box.minY)];
        const downhillFraction = region.downhillDirection.startsWith('positive-') ? alongFraction : 1 - alongFraction;
        const relativeElevationFt = (1 - downhillFraction) * alongFt * region.riseIn / region.runIn;
        regionHeads.push({ id: `${region.id}-generated-${heads.length + regionHeads.length + 1}`, regionId: region.id, pointPt, relativeElevationFt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, acrossIndex });
      }
    }
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
    regions.push({ regionId: region.id, shouldProtect: true, generatedHeadCount: acrossCount * alongCount, widthFt, heightFt, acrossCount, alongCount, obstructionAdjustments });
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
  const minZ = Math.min(...elevationValues); const maxZ = Math.max(...elevationValues);
  const elevationMarks = ordered.map((head, index) => { const value = elevationValues[index]; const x = 120 + index * 700; const y = 500 - ((value - minZ) / Math.max(.01, maxZ - minZ)) * 360; return `<g data-elevation-head-id="${head.id}"><circle cx="${x}" cy="${y}" r="9" fill="#007aff"/><text x="${x + 14}" y="${y - 8}" font-size="18">${value.toFixed(2)} ft ${absolute ? 'project elevation' : 'relative'}</text></g>`; }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 560" role="img" aria-label="Generated Dillon 3:12 ${absolute ? 'absolute project' : 'relative'} elevation view"><rect width="1600" height="560" fill="#fff"/><path d="M 60 500 L 1540 130" stroke="#ff9f0a" stroke-width="5"/>${elevationMarks}</svg>`;
  return { status: 'passed', topSvg, elevationSvg, complianceReady: false };
}
