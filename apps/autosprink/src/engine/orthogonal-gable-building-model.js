const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const finitePoint2 = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

function issue(code, message, refs = []) { return { severity: 'blocking', code, message, refs }; }
function surface(id, kind, vertices, sourceRefs) { return { id, kind, vertices: vertices.map((point) => point.map((value) => round(value))), sourceRefs }; }

/**
 * Build a renderable single-level building extrusion with a source-plan main gable and
 * orthogonal cross gables. This is building geometry only: sprinkler placement, obstruction,
 * hydraulic, listing, AHJ, and fabrication gates remain separate.
 */
export function buildOrthogonalGableBuildingModel(input) {
  const issues = [];
  const footprint = input?.footprintPlanFt;
  const skeleton = input?.roofSkeleton;
  const floorElevationFt = Number(input?.floorElevationFt);
  const wallTopElevationFt = Number(input?.wallTopElevationFt);
  const mainBearingElevationFt = Number(input?.mainBearingElevationFt);
  const mainRidgeElevationFt = Number(input?.mainRidgeElevationFt);
  const lowRoofElevationFt = input?.lowRoofElevationFt == null ? null : Number(input.lowRoofElevationFt);
  const pitchRiseIn = Number(input?.pitchRiseIn);
  const pitchRunIn = Number(input?.pitchRunIn);
  const features = (Array.isArray(input?.features) ? input.features : []).map((feature) => ({ ...feature }));
  if (!Array.isArray(footprint) || footprint.length < 4 || !footprint.every(finitePoint2)) issues.push(issue('BUILDING_FOOTPRINT_INVALID', 'A source-bound footprint polygon is required.'));
  if (!skeleton || skeleton.status !== 'passed' || !finitePoint2(skeleton.mainRidge?.from) || !finitePoint2(skeleton.mainRidge?.to) || !Array.isArray(skeleton.crossGables)) issues.push(issue('BUILDING_ROOF_SKELETON_INVALID', 'A passed source roof skeleton is required.'));
  if (![floorElevationFt, wallTopElevationFt, mainBearingElevationFt, mainRidgeElevationFt, pitchRiseIn, pitchRunIn].every(Number.isFinite)
    || !(wallTopElevationFt > floorElevationFt) || !(mainRidgeElevationFt > mainBearingElevationFt) || !(pitchRiseIn > 0) || !(pitchRunIn > 0)) issues.push(issue('BUILDING_ELEVATION_INPUT_INVALID', 'Ordered source elevations and a positive roof pitch are required.'));
  if (issues.length) return { status: 'blocked', surfaces: [], walls: [], issues, geometryGrounded: false, complianceReady: false };
  if (lowRoofElevationFt != null && (!Number.isFinite(lowRoofElevationFt) || !(lowRoofElevationFt > wallTopElevationFt) || !(lowRoofElevationFt < mainRidgeElevationFt))) {
    issues.push(issue('BUILDING_LOW_ROOF_DATUM_INVALID', 'An optional low-roof datum must sit above the wall top and below the main ridge.'));
  }
  for (const feature of features) {
    if (!feature?.id || !Array.isArray(feature.footprintPlanFt) || feature.footprintPlanFt.length < 4 || !feature.footprintPlanFt.every(finitePoint2)
      || ![feature.baseElevationFt, feature.beamElevationFt, feature.topElevationFt].every(Number.isFinite)
      || !(feature.baseElevationFt < feature.beamElevationFt && feature.beamElevationFt < feature.topElevationFt)) {
      issues.push(issue('BUILDING_VERTICAL_FEATURE_INVALID', 'Every vertical roof feature requires a source footprint and ordered base, beam, and top elevations.', [feature?.id].filter(Boolean)));
    }
  }
  if (issues.length) return { status: 'blocked', surfaces: [], walls: [], issues, geometryGrounded: false, complianceReady: false };

  const slope = pitchRiseIn / pitchRunIn;
  const ridgeY = (skeleton.mainRidge.from[1] + skeleton.mainRidge.to[1]) / 2;
  const halfRunFt = (mainRidgeElevationFt - mainBearingElevationFt) / slope;
  const bearingSouthY = ridgeY - halfRunFt;
  const bearingNorthY = ridgeY + halfRunFt;
  const minX = Math.min(skeleton.mainRidge.from[0], skeleton.mainRidge.to[0]);
  const maxX = Math.max(skeleton.mainRidge.from[0], skeleton.mainRidge.to[0]);
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  const surfaces = [
    ...(lowRoofElevationFt == null ? [] : [surface('vestibule-low-roof-datum', 'low-roof-datum-plane', footprint.map(([x, y]) => [x, y, lowRoofElevationFt]), sourceRefs)]),
    surface('main-gable-south', 'pitched-roof', [[minX, bearingSouthY, mainBearingElevationFt], [maxX, bearingSouthY, mainBearingElevationFt], [maxX, ridgeY, mainRidgeElevationFt], [minX, ridgeY, mainRidgeElevationFt]], sourceRefs),
    surface('main-gable-north', 'pitched-roof', [[minX, ridgeY, mainRidgeElevationFt], [maxX, ridgeY, mainRidgeElevationFt], [maxX, bearingNorthY, mainBearingElevationFt], [minX, bearingNorthY, mainBearingElevationFt]], sourceRefs),
  ];
  const crossGableResidualsFt = [];
  skeleton.crossGables.forEach((gable, index) => {
    const mainZ = gable.ridgeInnerFt[1] < ridgeY
      ? mainBearingElevationFt + (gable.ridgeInnerFt[1] - bearingSouthY) * slope
      : mainBearingElevationFt + (bearingNorthY - gable.ridgeInnerFt[1]) * slope;
    const ridgeZ = Math.min(mainRidgeElevationFt, mainZ);
    const leftZ = ridgeZ - Math.abs(gable.leftEaveFt[0] - gable.axisXFt) * slope;
    const rightZ = ridgeZ - Math.abs(gable.rightEaveFt[0] - gable.axisXFt) * slope;
    surfaces.push(
      surface(`${gable.id}-left`, 'cross-gable-roof', [[...gable.leftEaveFt, leftZ], [...gable.ridgeOuterFt, ridgeZ], [...gable.ridgeInnerFt, ridgeZ]], sourceRefs),
      surface(`${gable.id}-right`, 'cross-gable-roof', [[...gable.ridgeOuterFt, ridgeZ], [...gable.rightEaveFt, rightZ], [...gable.ridgeInnerFt, ridgeZ]], sourceRefs),
    );
    const expectedLeftSlope = Math.abs((ridgeZ - leftZ) / Math.max(1e-9, Math.abs(gable.axisXFt - gable.leftEaveFt[0])));
    const expectedRightSlope = Math.abs((ridgeZ - rightZ) / Math.max(1e-9, Math.abs(gable.rightEaveFt[0] - gable.axisXFt)));
    crossGableResidualsFt.push({ gableId: gable.id, leftPitchResidual: round(Math.abs(expectedLeftSlope - slope)), rightPitchResidual: round(Math.abs(expectedRightSlope - slope)) });
  });

  const walls = footprint.map((point, index) => ({
    id: `exterior-${index + 1}`,
    from: [round(point[0]), round(point[1]), round(floorElevationFt)],
    to: [round(footprint[(index + 1) % footprint.length][0]), round(footprint[(index + 1) % footprint.length][1]), round(floorElevationFt)],
    topElevationFt: round(wallTopElevationFt),
  }));
  return {
    status: 'passed',
    artifactType: 'halofire.orthogonal-gable-building-model.v1',
    units: 'ft',
    floorElevationFt: round(floorElevationFt),
    wallTopElevationFt: round(wallTopElevationFt),
    footprintPlanFt: footprint.map((point) => point.map((value) => round(value))),
    mainRoof: { ridgeYFt: round(ridgeY), bearingSouthYFt: round(bearingSouthY), bearingNorthYFt: round(bearingNorthY), bearingElevationFt: round(mainBearingElevationFt), ridgeElevationFt: round(mainRidgeElevationFt), pitchRiseIn: round(pitchRiseIn), pitchRunIn: round(pitchRunIn) },
    lowRoofElevationFt: lowRoofElevationFt == null ? null : round(lowRoofElevationFt),
    surfaces,
    walls,
    rooms: Array.isArray(input.rooms) ? input.rooms : [],
    interiorWallRuns: Array.isArray(input.interiorWallRuns) ? input.interiorWallRuns : [],
    features,
    verification: { crossGableResidualsFt, exactPitchReplay: crossGableResidualsFt.every((entry) => entry.leftPitchResidual === 0 && entry.rightPitchResidual === 0), sourceRefs },
    unresolved: Array.isArray(input.unresolved) ? input.unresolved : [],
    geometryGrounded: true,
    complianceReady: false,
    fabricationReady: false,
    claimStatus: 'source-bound-floor-and-pitched-roof-geometry-not-sprinkler-code-compliance',
    issues: [],
  };
}
