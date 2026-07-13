import { z } from 'zod';

const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Region = z.object({
  id: z.string(), polygonSubmittedPt: z.array(Point).min(4), slopeAxis: z.enum(['x', 'y']),
  downhillDirection: z.enum(['positive-x', 'negative-x', 'positive-y', 'negative-y']),
  riseIn: z.number().positive(), runIn: z.number().positive(), shouldProtect: z.boolean(),
  elevationDatum: z.object({ datumPointSubmittedPt: Point, projectElevationFt: z.number().finite(), slopeDirection: z.literal('positive-y-down'), sourceText: z.string().min(1) }).strict().nullable(),
}).strict();
const Input = z.object({
  artifactType: z.literal('halofire.sloped-ceiling-model3d-input.v1'),
  printedScalePtPerFt: z.number().positive(), regions: z.array(Region).min(1),
  hydraulicDatumJoin: z.object({ projectDatumOffsetFt: z.number().finite(), activeNodes: z.array(z.object({ report: z.string(), nodeId: z.string(), hydraulicLocalElevationFt: z.number(), projectElevationFt: z.number() }).strict()).min(1), protectedRegionHeadNodeMappingReady: z.boolean() }).strict(),
}).strict();

const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const bbox = (polygon) => ({ minX: Math.min(...polygon.map((p) => p[0])), maxX: Math.max(...polygon.map((p) => p[0])), minY: Math.min(...polygon.map((p) => p[1])), maxY: Math.max(...polygon.map((p) => p[1])) });
const magnitude = (vector) => Math.hypot(...vector);
const normalize = (vector) => { const length = magnitude(vector); return vector.map((value) => value / length); };
const polygonArea = (polygon) => Math.abs(polygon.reduce((sum, point, index) => { const next = polygon[(index + 1) % polygon.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
const signedPolygonArea2 = (polygon) => polygon.reduce((sum, point, index) => { const next = polygon[(index + 1) % polygon.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);
const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const inTriangle = (point, a, b, c, orientation) => orientation * cross2(a, b, point) >= -1e-8 && orientation * cross2(b, c, point) >= -1e-8 && orientation * cross2(c, a, point) >= -1e-8;
const triangulate = (polygon) => {
  const orientation = Math.sign(signedPolygonArea2(polygon));
  if (!orientation) return null;
  const remaining = polygon.map((_, index) => index); const triangles = [];
  while (remaining.length > 3) {
    let ear = -1;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length]; const current = remaining[cursor]; const next = remaining[(cursor + 1) % remaining.length];
      if (orientation * cross2(polygon[previous], polygon[current], polygon[next]) <= 1e-8) continue;
      if (remaining.some((candidate) => candidate !== previous && candidate !== current && candidate !== next && inTriangle(polygon[candidate], polygon[previous], polygon[current], polygon[next], orientation))) continue;
      triangles.push([previous, current, next]); ear = cursor; break;
    }
    if (ear < 0) return null;
    remaining.splice(ear, 1);
  }
  triangles.push([...remaining]);
  return triangles;
};
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
  if (region.elevationDatum) {
    const along = region.slopeAxis === 'y' ? pointPt[1] : pointPt[0];
    const datumAlong = region.slopeAxis === 'y' ? region.elevationDatum.datumPointSubmittedPt[1] : region.elevationDatum.datumPointSubmittedPt[0];
    const sign = region.downhillDirection.startsWith('positive-') ? -1 : 1;
    return region.elevationDatum.projectElevationFt + sign * ((along - datumAlong) / scale) * region.riseIn / region.runIn;
  }
  const alongMin = region.slopeAxis === 'y' ? box.minY : box.minX;
  const alongMax = region.slopeAxis === 'y' ? box.maxY : box.maxX;
  const along = region.slopeAxis === 'y' ? pointPt[1] : pointPt[0];
  const downhillFraction = region.downhillDirection.startsWith('positive-') ? (along - alongMin) / (alongMax - alongMin) : (alongMax - along) / (alongMax - alongMin);
  return (1 - downhillFraction) * ((alongMax - alongMin) / scale) * region.riseIn / region.runIn;
}

function normalFor(region) {
  const derivative = (region.downhillDirection.startsWith('positive-') ? -1 : 1) * region.riseIn / region.runIn;
  return normalize(region.slopeAxis === 'x' ? [-derivative, 0, 1] : [0, -derivative, 1]);
}

function elevationProfileFor(region, scale) {
  const box = bbox(region.polygonSubmittedPt); const axisIsY = region.slopeAxis === 'y';
  const alongMin = axisIsY ? box.minY : box.minX; const alongMax = axisIsY ? box.maxY : box.maxX;
  const across = axisIsY ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2;
  const positiveDownhill = region.downhillDirection.startsWith('positive-');
  const uphillAlong = positiveDownhill ? alongMin : alongMax; const downhillAlong = positiveDownhill ? alongMax : alongMin;
  const pointAt = (along) => axisIsY ? [across, along] : [along, across];
  const uphillElevationFt = elevationAt(pointAt(uphillAlong), region, scale); const downhillElevationFt = elevationAt(pointAt(downhillAlong), region, scale);
  const spanFt = Math.abs(downhillAlong - uphillAlong) / scale;
  return {
    axis: region.slopeAxis, downhillDirection: region.downhillDirection,
    sourceDatumStatus: region.elevationDatum ? 'source-bound-project-elevation' : 'relative-to-downhill-ceiling-edge',
    sourceText: region.elevationDatum?.sourceText ?? null,
    spanFt, riseFt: Math.abs(uphillElevationFt - downhillElevationFt),
    uphill: { stationFt: 0, elevationFt: uphillElevationFt },
    downhill: { stationFt: spanFt, elevationFt: downhillElevationFt },
    pitch: { riseIn: region.riseIn, runIn: region.runIn },
  };
}

export function buildSlopedCeilingModel3d(layout, inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success || !layout || layout.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_MODEL3D_INPUT_INVALID', parsed.success ? 'A passed slope-aware layout is required.' : parsed.error.message)] };
  const input = parsed.data; const surfaces = [];
  for (const region of input.regions) {
    const triangles = triangulate(region.polygonSubmittedPt);
    if (!triangles) return { status: 'blocked', issues: [issue('SLOPED_MODEL3D_SURFACE_TRIANGULATION_FAILED', `Surface ${region.id} is not a simple triangulable polygon.`, [region.id])] };
    const projectedAreaSqFt = polygonArea(region.polygonSubmittedPt) / input.printedScalePtPerFt ** 2;
    surfaces.push({
      id: region.id, shouldProtect: region.shouldProtect,
      vertices: region.polygonSubmittedPt.map((pointPt) => ({ pointPt, pointFt: [pointPt[0] / input.printedScalePtPerFt, pointPt[1] / input.printedScalePtPerFt, elevationAt(pointPt, region, input.printedScalePtPerFt)] })),
      triangles, normalUnit: normalFor(region), projectedAreaSqFt, slopedAreaSqFt: projectedAreaSqFt * Math.hypot(1, region.riseIn / region.runIn),
      elevationProfile: elevationProfileFor(region, input.printedScalePtPerFt),
      slope: { riseIn: region.riseIn, runIn: region.runIn, axis: region.slopeAxis, downhillDirection: region.downhillDirection },
    });
  }
  const heads = layout.heads.map((head) => {
    const region = input.regions.find((entry) => entry.id === head.regionId);
    return { id: head.id, regionId: head.regionId, pointFt: [head.pointPt[0] / input.printedScalePtPerFt, head.pointPt[1] / input.printedScalePtPerFt, elevationAt(head.pointPt, region, input.printedScalePtPerFt)], orientation: 'normal-to-3-12-ceiling-plane', normalUnit: normalFor(region) };
  });
  const pipes = [];
  for (const region of input.regions.filter((entry) => entry.shouldProtect)) {
    const regionHeads = heads.filter((head) => head.regionId === region.id).sort((a, b) => region.slopeAxis === 'y' ? a.pointFt[1] - b.pointFt[1] : a.pointFt[0] - b.pointFt[0]);
    for (let index = 1; index < regionHeads.length; index += 1) pipes.push({ id: `${region.id}-pipe-${index}`, regionId: region.id, fromHeadId: regionHeads[index - 1].id, toHeadId: regionHeads[index].id, fromFt: regionHeads[index - 1].pointFt, toFt: regionHeads[index].pointFt, routeKind: 'slope-following-centerline' });
  }
  const absoluteElevationReady = input.regions.filter((region) => region.shouldProtect).every((region) => region.elevationDatum);
  return {
    status: 'passed', artifactType: 'halofire.sloped-ceiling-model3d.v1', units: 'ft', printedScalePtPerFt: input.printedScalePtPerFt, datumMode: absoluteElevationReady ? 'source-bound-project-elevation' : 'relative-to-downhill-ceiling-edge',
    surfaces, elevationProfiles: surfaces.map(({ id, elevationProfile }) => ({ regionId: id, ...elevationProfile })), heads, pipes, geometryGrounded: true, absoluteElevationReady,
    hydraulicDatumJoined: true, hydraulicDatumJoin: input.hydraulicDatumJoin,
    protectedRegionHeadNodeMappingReady: input.hydraulicDatumJoin.protectedRegionHeadNodeMappingReady,
    complianceReady: false,
    claimStatus: 'source-grounded-relative-3d-calibration-not-code-compliance-or-approval', issues: [],
  };
}

export function verifySlopedCeilingModel3d(model, layout, inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success || !model || model.status !== 'passed') return { status: 'blocked', issues: [issue('SLOPED_MODEL3D_NOT_READY', 'Passed model and input are required.')] };
  const input = parsed.data; const issues = []; let maxPlaneResidualFt = 0; let maxNormalResidual = 0; let maxProfileResidualFt = 0;
  for (const region of input.regions) {
    const surface = model.surfaces.find((entry) => entry.id === region.id); const expectedNormal = normalFor(region); const expectedProfile = elevationProfileFor(region, input.printedScalePtPerFt);
    if (!surface || surface.vertices.length !== region.polygonSubmittedPt.length || surface.triangles.length !== region.polygonSubmittedPt.length - 2) {
      issues.push(issue('SLOPED_MODEL3D_TRIANGULATION_INCOMPLETE', `Surface ${region.id} does not contain a complete n-2 triangulation.`, [region.id]));
      continue;
    }
    if (surface.triangles.some((triangle) => triangle.length !== 3 || triangle.some((index) => !Number.isInteger(index) || index < 0 || index >= surface.vertices.length) || Math.abs(cross2(surface.vertices[triangle[0]].pointPt, surface.vertices[triangle[1]].pointPt, surface.vertices[triangle[2]].pointPt)) <= 1e-8)) issues.push(issue('SLOPED_MODEL3D_TRIANGLE_INVALID', `Surface ${region.id} contains an invalid triangle.`, [region.id]));
    surface.vertices.forEach((vertex, index) => { const expected = elevationAt(region.polygonSubmittedPt[index], region, input.printedScalePtPerFt); const residual = Math.abs(vertex.pointFt[2] - expected); maxPlaneResidualFt = Math.max(maxPlaneResidualFt, residual); if (residual > .001) issues.push(issue('SLOPED_MODEL3D_SURFACE_PLANE_RESIDUAL', `Surface ${region.id} has a vertex off its source plane.`, [region.id])); });
    if (!Array.isArray(surface.normalUnit) || surface.normalUnit.length !== 3) issues.push(issue('SLOPED_MODEL3D_NORMAL_MISSING', `Surface ${region.id} is missing its plane normal.`, [region.id]));
    else { const residual = magnitude(surface.normalUnit.map((value, index) => value - expectedNormal[index])); maxNormalResidual = Math.max(maxNormalResidual, residual); if (residual > 1e-6 || Math.abs(magnitude(surface.normalUnit) - 1) > 1e-6) issues.push(issue('SLOPED_MODEL3D_NORMAL_DRIFT', `Surface ${region.id} normal does not match its source pitch direction.`, [region.id])); }
    const profile = surface.elevationProfile;
    if (!profile) issues.push(issue('SLOPED_MODEL3D_ELEVATION_PROFILE_MISSING', `Surface ${region.id} is missing its side-elevation profile.`, [region.id]));
    else { const residual = Math.max(Math.abs(profile.spanFt - expectedProfile.spanFt), Math.abs(profile.riseFt - expectedProfile.riseFt), Math.abs(profile.uphill.elevationFt - expectedProfile.uphill.elevationFt), Math.abs(profile.downhill.elevationFt - expectedProfile.downhill.elevationFt)); maxProfileResidualFt = Math.max(maxProfileResidualFt, residual); if (residual > .001 || profile.sourceDatumStatus !== expectedProfile.sourceDatumStatus) issues.push(issue('SLOPED_MODEL3D_ELEVATION_PROFILE_DRIFT', `Surface ${region.id} side-elevation profile does not match its source plane and datum.`, [region.id])); }
    const indexedProfile = model.elevationProfiles?.find((entry) => entry.regionId === region.id);
    if (!indexedProfile || !profile || indexedProfile.spanFt !== profile.spanFt || indexedProfile.riseFt !== profile.riseFt || indexedProfile.uphill.elevationFt !== profile.uphill.elevationFt || indexedProfile.downhill.elevationFt !== profile.downhill.elevationFt) issues.push(issue('SLOPED_MODEL3D_ELEVATION_PROFILE_INDEX_DRIFT', `Surface ${region.id} indexed side-elevation profile is missing or stale.`, [region.id]));
  }
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
    const expectedNormal = normalFor(region); const normalResidual = Array.isArray(head.normalUnit) && head.normalUnit.length === 3 ? magnitude(head.normalUnit.map((value, index) => value - expectedNormal[index])) : Infinity; maxNormalResidual = Math.max(maxNormalResidual, normalResidual);
    if (normalResidual > 1e-6) issues.push(issue('SLOPED_MODEL3D_HEAD_NORMAL_DRIFT', `Head ${head.id} is not normal to its source ceiling plane.`, [head.id]));
  }
  const headIds = new Set(model.heads.map((head) => head.id));
  for (const pipe of model.pipes) if (!headIds.has(pipe.fromHeadId) || !headIds.has(pipe.toHeadId)) issues.push(issue('SLOPED_MODEL3D_PIPE_ENDPOINT_MISSING', `Pipe ${pipe.id} is not connected to generated heads.`, [pipe.id]));
  const nonFlatHeadCount = new Set(model.heads.map((head) => head.pointFt[2].toFixed(4))).size;
  if (model.heads.length > 1 && nonFlatHeadCount < 2) issues.push(issue('SLOPED_MODEL3D_FALSE_FLAT', 'Generated heads collapsed onto a flat elevation.'));
  for (const node of input.hydraulicDatumJoin.activeNodes) if (node.hydraulicLocalElevationFt + input.hydraulicDatumJoin.projectDatumOffsetFt !== node.projectElevationFt) issues.push(issue('SLOPED_MODEL3D_HYDRAULIC_DATUM_DRIFT', `Hydraulic node ${node.report}:${node.nodeId} does not share the project datum.`, [node.report, node.nodeId]));
  return { status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.sloped-ceiling-model3d-verification.v1', issues, counts: { surfaces: model.surfaces.length, heads: model.heads.length, pipes: model.pipes.length, nonFlatHeadElevations: nonFlatHeadCount, hydraulicNodesJoined: input.hydraulicDatumJoin.activeNodes.length }, elevationProfileCount: model.elevationProfiles?.length ?? 0, maxPlaneResidualFt, maxNormalResidual, maxProfileResidualFt, geometryGrounded: issues.length === 0, absoluteElevationReady: model.absoluteElevationReady, hydraulicDatumJoined: issues.length === 0, protectedRegionHeadNodeMappingReady: input.hydraulicDatumJoin.protectedRegionHeadNodeMappingReady, complianceReady: false };
}
