const PROJECT_ID = 'polaris-academy-mesa-az';
const EXPECTED = Object.freeze({
  nativeCadSha256: '1224C1268B19FD4390FEEB0E7A563852AEC6B9B82EADE8452B3686EDD405D3F4',
  exportedDwgSha256: '3B27B60D74C6058508789929AD0CA20DF490C28905828B5AC096183454154C2F',
  pipeGeometrySha256: '33CE1D1119D64BB349152C3AF83767313404C8ED3443F770A8BA123FBEAEA34A',
  approvedFp2Sha256: '06C502687CE21D66AEE8D7C5212CB5FF2B5E31E17A7433BD22448DE12CA80DD1',
  asBuiltSha256: '1442BE77DA8D08388084E6F56EE3DDFEA9565F08307022449267D065A504E81A',
  approvedAsBuiltRasterSha256: '9BFC1F1F01299E86FF3335ED865F7BD977504B8BD8535BBAC81A5534EDC01904',
  xyOffsetInches: [2089.742556327576, 545.357810486682],
  zDatumOffsetInches: 11.175011099624,
  pipeCount: 186,
  headCount: 158,
  fittingCount: 98,
  hydraulicNodeCount: 59,
  distinctEndpointElevations: 119,
  nominalSizeCounts: { 1: 152, 1.25: 17, 1.5: 4, 2: 3, 2.5: 1, 3: 7, 4: 2 },
  geometryKindCounts: { 'level-run': 86, 'sloped-plan-run': 14, 'vertical-transition': 86 },
  planDirectionCounts: { 'north-south': 73, 'east-west': 20, diagonal: 7, 'vertical-transition': 86 },
});

const issue = (code, message) => ({ code, message });
const pointFinite = (point) => point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
const close = (left, right, tolerance = 1e-6) => Number.isFinite(left) && Math.abs(left - right) <= tolerance;
const countsBy = (items, key) => items.reduce((counts, item) => {
  const value = String(item[key]);
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});
const countsEqual = (actual, expected) => Object.entries(expected)
  .every(([key, value]) => actual[key] === value)
  && Object.keys(actual).length === Object.keys(expected).length;

function expectedGeometryKind(pipe) {
  if (Math.abs(pipe.deltaZInches) <= 1e-6) return 'level-run';
  return pipe.planLengthFt * 12 < 1 ? 'vertical-transition' : 'sloped-plan-run';
}

function expectedPlanDirection(pipe) {
  if (pipe.planLengthFt * 12 < 1) return 'vertical-transition';
  const dx = Math.abs(pipe.endFt.x - pipe.startFt.x);
  const dy = Math.abs(pipe.endFt.y - pipe.startFt.y);
  if (dx < 1e-6) return 'north-south';
  if (dy < 1e-6) return 'east-west';
  return 'diagonal';
}

export function evaluatePolarisPitchedPipeCalibration(packet) {
  const issues = [];
  if (packet?.schema !== 'halofire.polaris-pitched-pipe-xyz-calibration.v2' || packet?.projectId !== PROJECT_ID) {
    issues.push(issue('POLARIS_PIPE_IDENTITY_INVALID', 'The calibration schema or project identity changed.'));
  }
  const sources = packet?.sources ?? {};
  if (
    sources.nativeCad?.sha256 !== EXPECTED.nativeCadSha256
    || sources.exportedDwg?.sha256 !== EXPECTED.exportedDwgSha256
    || sources.exportedDwg?.pipeGeometrySha256 !== EXPECTED.pipeGeometrySha256
    || sources.approvedFp2?.sha256 !== EXPECTED.approvedFp2Sha256
    || sources.asBuilt?.sha256 !== EXPECTED.asBuiltSha256
    || sources.approvedAndAsBuiltFp2RasterSha256 !== EXPECTED.approvedAsBuiltRasterSha256
  ) issues.push(issue('POLARIS_PIPE_SOURCE_BINDING_DRIFT', 'Native CAD, DWG, approved, as-built, raster, or geometry identity changed.'));
  if (sources.nativeCad?.archiveEntryCount !== 6 || sources.nativeCad?.typeCount !== 157 || sources.nativeCad?.nativeSpatialTypesReady !== true) {
    issues.push(issue('POLARIS_NATIVE_CAD_CATALOG_INVALID', 'The bounded native AutoSPRINK archive catalog is incomplete.'));
  }

  const registration = packet?.registration ?? {};
  if (
    registration.sourceUnits !== 'inches'
    || registration.projectUnits !== 'feet'
    || registration.xyOffsetInches?.some((value, index) => !close(value, EXPECTED.xyOffsetInches[index], 1e-9))
    || !close(registration.zDatumOffsetInches, EXPECTED.zDatumOffsetInches, 1e-9)
    || registration.architecturalOutlineVertices !== 73
    || registration.architecturalOutlineMaxResidualInches > 2e-11
    || registration.headCount !== EXPECTED.headCount
    || registration.headXyMaxResidualFt > 1e-6
    || registration.headLabelZMaxResidualInches > 0.25
  ) issues.push(issue('POLARIS_PIPE_REGISTRATION_INVALID', 'The source-unit, architecture, head, or vertical-datum registration drifted.'));

  const pipes = Array.isArray(packet?.pipes) ? packet.pipes : [];
  const fittings = Array.isArray(packet?.fittings) ? packet.fittings : [];
  const hydraulicNodeLabels = Array.isArray(packet?.hydraulicNodeLabels) ? packet.hydraulicNodeLabels : [];
  if (pipes.length !== EXPECTED.pipeCount || fittings.length !== EXPECTED.fittingCount) {
    issues.push(issue('POLARIS_PIPE_INVENTORY_INVALID', 'The exact pipe or fitting inventory changed.'));
  }
  if (new Set(pipes.map((pipe) => pipe.id)).size !== pipes.length || new Set(fittings.map((fitting) => fitting.id)).size !== fittings.length) {
    issues.push(issue('POLARIS_PIPE_IDS_NOT_UNIQUE', 'Pipe or fitting identifiers are not unique.'));
  }

  const allowedSizes = new Set([1, 1.25, 1.5, 2, 2.5, 3, 4]);
  for (const pipe of pipes) {
    if (!pointFinite(pipe.startFt) || !pointFinite(pipe.endFt) || !Number.isFinite(pipe.planLengthFt) || !Number.isFinite(pipe.length3dFt) || !Number.isFinite(pipe.deltaZInches)) {
      issues.push(issue('POLARIS_PIPE_XYZ_NONFINITE', `Pipe ${pipe.id ?? 'unknown'} has invalid geometry.`));
      break;
    }
    if (!allowedSizes.has(pipe.nominalSizeInches)) {
      issues.push(issue('POLARIS_PIPE_SIZE_INVALID', `Pipe ${pipe.id ?? 'unknown'} has an unsupported size.`));
      break;
    }
    const computedPlanLength = Math.hypot(pipe.endFt.x - pipe.startFt.x, pipe.endFt.y - pipe.startFt.y);
    const computedLength3d = Math.hypot(computedPlanLength, pipe.endFt.z - pipe.startFt.z);
    const computedDeltaZInches = (pipe.endFt.z - pipe.startFt.z) * 12;
    if (!close(computedPlanLength, pipe.planLengthFt, 2e-8) || !close(computedLength3d, pipe.length3dFt, 2e-8) || !close(computedDeltaZInches, pipe.deltaZInches, 2e-8)) {
      issues.push(issue('POLARIS_PIPE_GEOMETRY_DERIVATION_INVALID', `Pipe ${pipe.id ?? 'unknown'} length or elevation delta is inconsistent.`));
      break;
    }
    if (pipe.geometryKind !== expectedGeometryKind(pipe) || pipe.planDirection !== expectedPlanDirection(pipe)) {
      issues.push(issue('POLARIS_PIPE_DIRECTION_CLASS_INVALID', `Pipe ${pipe.id ?? 'unknown'} direction or geometry class is inconsistent.`));
      break;
    }
    const expectedDownhill = Math.abs(pipe.deltaZInches) <= 1e-6 ? 'level' : pipe.deltaZInches < 0 ? 'start-to-end' : 'end-to-start';
    if (pipe.downhillDirection !== expectedDownhill) {
      issues.push(issue('POLARIS_PIPE_DOWNHILL_DIRECTION_INVALID', `Pipe ${pipe.id ?? 'unknown'} downhill direction conflicts with endpoint Z.`));
      break;
    }
    const expectedGrade = pipe.geometryKind === 'sloped-plan-run'
      ? 10 * Math.abs(pipe.deltaZInches) / pipe.planLengthFt
      : null;
    if (expectedGrade === null ? pipe.gradeInPer10Ft !== null : !close(pipe.gradeInPer10Ft, expectedGrade, 1e-6)) {
      issues.push(issue('POLARIS_PIPE_GRADE_INVALID', `Pipe ${pipe.id ?? 'unknown'} grade does not replay from its endpoints.`));
      break;
    }
  }
  if (fittings.some((fitting) => !pointFinite(fitting.pointFt) || typeof fitting.family !== 'string')) {
    issues.push(issue('POLARIS_FITTING_XYZ_INVALID', 'A fitting has invalid source geometry or family identity.'));
  }
  if (hydraulicNodeLabels.length !== EXPECTED.hydraulicNodeCount
    || new Set(hydraulicNodeLabels.map((label) => label.nodeId)).size !== EXPECTED.hydraulicNodeCount
    || hydraulicNodeLabels.some((label) => !pointFinite(label.connectionPointFt)
      || JSON.stringify(label.sourceGlyphTopologyDegreeSignature) !== JSON.stringify([1, 2, 2, 2, 2, 2, 3])
      || label.sourceGlyphLineHandles?.length !== 7)) {
    issues.push(issue('POLARIS_HYDRAULIC_NODE_CONNECTION_INVALID', 'A hydraulic node lacks a unique seven-line source glyph and exact 3D leader tip.'));
  }

  const summary = packet?.summary ?? {};
  if (
    summary.pipeCount !== EXPECTED.pipeCount
    || summary.headCount !== EXPECTED.headCount
    || summary.fittingCount !== EXPECTED.fittingCount
    || summary.hydraulicNodeLabelCount !== EXPECTED.hydraulicNodeCount
    || summary.hydraulicNodeConnectionPointCount !== EXPECTED.hydraulicNodeCount
    || summary.distinctEndpointElevations !== EXPECTED.distinctEndpointElevations
    || !countsEqual(countsBy(pipes, 'nominalSizeInches'), EXPECTED.nominalSizeCounts)
    || !countsEqual(countsBy(pipes, 'geometryKind'), EXPECTED.geometryKindCounts)
    || !countsEqual(countsBy(pipes, 'planDirection'), EXPECTED.planDirectionCounts)
    || !countsEqual(summary.nominalSizeCounts ?? {}, EXPECTED.nominalSizeCounts)
    || !countsEqual(summary.geometryKindCounts ?? {}, EXPECTED.geometryKindCounts)
    || !countsEqual(summary.planDirectionCounts ?? {}, EXPECTED.planDirectionCounts)
  ) issues.push(issue('POLARIS_PIPE_SUMMARY_INVALID', 'Pipe sizes, directions, geometry classes, or totals changed.'));

  const exactSourcePipeXyzReady = issues.length === 0;
  return {
    status: exactSourcePipeXyzReady ? 'passed' : 'blocked',
    issues,
    exactSourcePipeXyzReady,
    sourceUnitConversionReady: exactSourcePipeXyzReady,
    approvedAndAsBuiltRegistrationReady: exactSourcePipeXyzReady,
    planDirectionReady: exactSourcePipeXyzReady,
    roofRelativePipeGradeGeometryReady: exactSourcePipeXyzReady,
    exactHydraulicNodeConnectionPointsReady: exactSourcePipeXyzReady,
    hydraulicFlowDirectionReady: false,
    drainageGradeSemanticsReady: false,
    fullFittingIdentityReady: false,
    drainDestinationReady: false,
    nativeElementGeometryRecordDecodeReady: false,
    newHopeExactPipeCenterlineZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export function verifyPolarisPitchedPipeAdversarialLoop(packet) {
  const attacks = [
    ['native-hash', (value) => { value.sources.nativeCad.sha256 = '00'.repeat(32); }],
    ['dwg-hash', (value) => { value.sources.exportedDwg.sha256 = '00'.repeat(32); }],
    ['approved-hash', (value) => { value.sources.approvedFp2.sha256 = '00'.repeat(32); }],
    ['as-built-hash', (value) => { value.sources.asBuilt.sha256 = '00'.repeat(32); }],
    ['registration', (value) => { value.registration.xyOffsetInches[0] += 1; }],
    ['datum', (value) => { value.registration.zDatumOffsetInches += 1; }],
    ['pipe-removal', (value) => { value.pipes.pop(); }],
    ['pipe-size', (value) => { value.pipes[0].nominalSizeInches = 9; }],
    ['pipe-z', (value) => { value.pipes[0].endFt.z += 1; }],
    ['downhill-direction', (value) => { value.pipes.find((pipe) => pipe.downhillDirection !== 'level').downhillDirection = 'level'; }],
    ['grade', (value) => { value.pipes.find((pipe) => pipe.gradeInPer10Ft !== null).gradeInPer10Ft += 1; }],
    ['fitting-removal', (value) => { value.fittings.pop(); }],
    ['hydraulic-node-tip', (value) => { value.hydraulicNodeLabels[0].connectionPointFt.z += 1; value.hydraulicNodeLabels[0].connectionPointFt = null; }],
  ];
  const rejectedCases = attacks.map(([name, mutate]) => {
    const value = structuredClone(packet);
    mutate(value);
    return { name, rejected: evaluatePolarisPitchedPipeCalibration(value).status === 'blocked' };
  });
  const promotion = structuredClone(packet);
  Object.assign(promotion.claims, {
    hydraulicFlowDirectionReady: true,
    drainageGradeSemanticsReady: true,
    fullFittingIdentityReady: true,
    drainDestinationReady: true,
    newHopeExactPipeCenterlineZReady: true,
    properPipeLayoutReady: true,
    fabricationReady: true,
    fieldReleaseReady: true,
  });
  const promotionResult = evaluatePolarisPitchedPipeCalibration(promotion);
  const falsePromotionRejected = [
    promotionResult.hydraulicFlowDirectionReady,
    promotionResult.drainageGradeSemanticsReady,
    promotionResult.fullFittingIdentityReady,
    promotionResult.drainDestinationReady,
    promotionResult.newHopeExactPipeCenterlineZReady,
    promotionResult.properPipeLayoutReady,
    promotionResult.fabricationReady,
    promotionResult.fieldReleaseReady,
  ].every((value) => value === false);
  return {
    status: rejectedCases.every((entry) => entry.rejected) && falsePromotionRejected ? 'passed' : 'failed',
    attemptedCases: rejectedCases.length + 1,
    rejectedCases,
    falsePromotionRejected,
  };
}
