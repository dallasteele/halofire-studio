import { z } from 'zod';

const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Region = z.object({
  id: z.string(), polygonSubmittedPt: z.array(Point).min(4), slopeAxis: z.enum(['x', 'y']),
  downhillDirection: z.enum(['positive-x', 'negative-x', 'positive-y', 'negative-y']),
  riseIn: z.number().positive(), runIn: z.number().positive(), shouldProtect: z.boolean(),
}).strict();
const Input = z.object({
  artifactType: z.literal('halofire.sloped-ceiling-model3d-input.v1'),
  printedScalePtPerFt: z.number().positive(), regions: z.array(Region).min(1),
}).strict();

const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const bbox = (polygon) => ({ minX: Math.min(...polygon.map((p) => p[0])), maxX: Math.max(...polygon.map((p) => p[0])), minY: Math.min(...polygon.map((p) => p[1])), maxY: Math.max(...polygon.map((p) => p[1])) });
const inside = (point, polygon) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
};

function elevationAt(pointPt, region, scale) {
  const box = bbox(region.polygonSubmittedPt);
  const alongMin = region.slopeAxis === 'y' ? box.minY : box.minX;
  const alongMax = region.slopeAxis === 'y' ? box.maxY : box.maxX;
  const along = region.slopeAxis === 'y' ? pointPt[1] : pointPt[0];
  const downhillFraction = region.downhillDirection.startsWith('positive-') ? (along - alongMin) / (alongMax - alongMin) : (alongMax - along) / (alongMax - alongMin);
  return (1 - downhillFraction) * ((alongMax - alongMin) / scale) * region.riseIn / region.runIn;
}

export function buildSlopedCeilingModel3d(layout, inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success || !layout || layout.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_MODEL3D_INPUT_INVALID', parsed.success ? 'A passed slope-aware layout is required.' : parsed.error.message)] };
  const input = parsed.data;
  const surfaces = input.regions.map((region) => ({
    id: region.id, shouldProtect: region.shouldProtect,
    vertices: region.polygonSubmittedPt.map((pointPt) => ({ pointPt, pointFt: [pointPt[0] / input.printedScalePtPerFt, pointPt[1] / input.printedScalePtPerFt, elevationAt(pointPt, region, input.printedScalePtPerFt)] })),
    triangles: [[0, 1, 2], [0, 2, 3]], slope: { riseIn: region.riseIn, runIn: region.runIn, axis: region.slopeAxis, downhillDirection: region.downhillDirection },
  }));
  const heads = layout.heads.map((head) => ({ id: head.id, regionId: head.regionId, pointFt: [head.pointPt[0] / input.printedScalePtPerFt, head.pointPt[1] / input.printedScalePtPerFt, head.relativeElevationFt], orientation: 'normal-to-3-12-ceiling-plane' }));
  const pipes = [];
  for (const region of input.regions.filter((entry) => entry.shouldProtect)) {
    const regionHeads = heads.filter((head) => head.regionId === region.id).sort((a, b) => region.slopeAxis === 'y' ? a.pointFt[1] - b.pointFt[1] : a.pointFt[0] - b.pointFt[0]);
    for (let index = 1; index < regionHeads.length; index += 1) pipes.push({ id: `${region.id}-pipe-${index}`, regionId: region.id, fromHeadId: regionHeads[index - 1].id, toHeadId: regionHeads[index].id, fromFt: regionHeads[index - 1].pointFt, toFt: regionHeads[index].pointFt, routeKind: 'slope-following-centerline' });
  }
  return {
    status: 'passed', artifactType: 'halofire.sloped-ceiling-model3d.v1', units: 'ft', datumMode: 'relative-to-downhill-ceiling-edge',
    surfaces, heads, pipes, geometryGrounded: true, absoluteElevationReady: false, complianceReady: false,
    claimStatus: 'source-grounded-relative-3d-calibration-not-code-compliance-or-approval', issues: [],
  };
}

export function verifySlopedCeilingModel3d(model, layout, inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success || !model || model.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_MODEL3D_NOT_READY', 'Passed model and input are required.')] };
  const input = parsed.data; const issues = []; let maxPlaneResidualFt = 0;
  for (const head of model.heads) {
    const region = input.regions.find((entry) => entry.id === head.regionId);
    const layoutHead = layout.heads.find((entry) => entry.id === head.id);
    if (!region || !layoutHead || !inside(layoutHead.pointPt, region.polygonSubmittedPt)) {
      issues.push(issue('SLOPED_MODEL3D_HEAD_OUTSIDE_SURFACE', `Head ${head.id} is not inside its source-bound ceiling surface.`, [head.id]));
      continue;
    }
    const expected = elevationAt(layoutHead.pointPt, region, input.printedScalePtPerFt);
    const residual = Math.abs(expected - head.pointFt[2]); maxPlaneResidualFt = Math.max(maxPlaneResidualFt, residual);
    if (residual > .001) issues.push(issue('SLOPED_MODEL3D_HEAD_PLANE_RESIDUAL', `Head ${head.id} does not lie on its 3:12 plane.`, [head.id]));
  }
  const headIds = new Set(model.heads.map((head) => head.id));
  for (const pipe of model.pipes) if (!headIds.has(pipe.fromHeadId) || !headIds.has(pipe.toHeadId)) issues.push(issue('SLOPED_MODEL3D_PIPE_ENDPOINT_MISSING', `Pipe ${pipe.id} is not connected to generated heads.`, [pipe.id]));
  const nonFlatHeadCount = new Set(model.heads.map((head) => head.pointFt[2].toFixed(4))).size;
  if (model.heads.length > 1 && nonFlatHeadCount < 2) issues.push(issue('SLOPED_MODEL3D_FALSE_FLAT', 'Generated heads collapsed onto a flat elevation.'));
  return { status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.sloped-ceiling-model3d-verification.v1', issues, counts: { surfaces: model.surfaces.length, heads: model.heads.length, pipes: model.pipes.length, nonFlatHeadElevations: nonFlatHeadCount }, maxPlaneResidualFt, geometryGrounded: issues.length === 0, absoluteElevationReady: false, complianceReady: false };
}
