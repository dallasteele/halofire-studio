const EXPECTED_PROJECT = 'polaris-academy-mesa-az';
const EXPECTED_PUBLICATIONS = new Map([
  ['10.03', ['1539 Rev R', '2024-08']],
  ['10.64', ['7072 Rev W', '2026-01']],
  ['06.05', ['1470 Rev S', '2025-09']],
  ['06.08', ['1536 Rev N', '2022-07']],
  ['10.08', ['1479 Rev Y', '2024-07']],
  ['07.01', ['1449 Rev AP', '2026-06']],
]);
const EXPECTED_DIMENSIONS = new Map([
  ['no001-3', ['center-to-end', 3.38, 3]],
  ['no001-4', ['center-to-end', 4, 1]],
  ['no002-3', ['center-to-end', 3.38, 2]],
  ['style009n-3', ['layout-separation-and-envelope', 0.12, 8]],
  ['style009n-4', ['layout-separation-and-envelope', 0.17, 2]],
  ['style75-3', ['layout-separation-and-envelope', 0.06, 2]],
  ['style750-3x2.5', ['layout-separation-and-envelope', 0.07, 2]],
  ['series717-3', ['end-to-end', 4.25, 1]],
  ['no50-4x3', ['end-to-end', 3, 1]],
]);

const issue = (code, message) => ({ code, message });
const close = (left, right) => Number.isFinite(left) && Math.abs(left - right) <= 1e-9;

function dimensionValue(entry) {
  return entry.dimensionKind === 'layout-separation-and-envelope'
    ? entry.allowablePipeEndSeparationInches
    : entry.valueInches;
}

function sourceInventory(calibration) {
  const rigid = (calibration?.fittings || []).filter((fitting) => fitting.family !== 'Flex Drop');
  const identifiedVictaulic = rigid.filter((fitting) => fitting.sourceAttributes?.Manufacturer === 'Victaulic');
  const generic = rigid.filter((fitting) => fitting.sourceAttributes?.Manufacturer === 'Generic');
  return { rigid, identifiedVictaulic, generic };
}

/** Validate primary manufacturer dimensions without applying them as project takeout. */
export function evaluatePolarisManufacturerDimensionSchedule(schedule, calibration) {
  const issues = [];
  if (schedule?.schema !== 'halofire.polaris-victaulic-primary-dimensions.v1' || schedule?.projectId !== EXPECTED_PROJECT || calibration?.projectId !== EXPECTED_PROJECT) {
    issues.push(issue('POLARIS_MANUFACTURER_DIMENSION_IDENTITY_INVALID', 'The schedule or calibration project identity changed.'));
  }
  const sources = Array.isArray(schedule?.sources) ? schedule.sources : [];
  if (sources.length !== EXPECTED_PUBLICATIONS.size || sources.some((source) => {
    const expected = EXPECTED_PUBLICATIONS.get(source.publication);
    return !expected || source.revision !== expected[0] || source.updated !== expected[1]
      || source.url !== `https://assets.victaulic.com/assets/uploads/literature/${source.publication}.pdf`;
  })) issues.push(issue('POLARIS_MANUFACTURER_PRIMARY_SOURCE_INVALID', 'A Victaulic publication, revision, update date, or official URL drifted.'));

  const dimensions = Array.isArray(schedule?.dimensions) ? schedule.dimensions : [];
  if (dimensions.length !== EXPECTED_DIMENSIONS.size || new Set(dimensions.map((entry) => entry.id)).size !== dimensions.length) {
    issues.push(issue('POLARIS_MANUFACTURER_DIMENSION_INVENTORY_INVALID', 'The bounded product dimension schedule is incomplete or duplicated.'));
  }
  for (const entry of dimensions) {
    const expected = EXPECTED_DIMENSIONS.get(entry.id);
    if (!expected || entry.dimensionKind !== expected[0] || !close(dimensionValue(entry), expected[1]) || entry.sourceInstanceCount !== expected[2] || !EXPECTED_PUBLICATIONS.has(entry.publication)) {
      issues.push(issue('POLARIS_MANUFACTURER_DIMENSION_VALUE_INVALID', `Primary dimension ${entry.id || 'unknown'} drifted.`));
      break;
    }
    if (entry.dimensionKind === 'layout-separation-and-envelope' && (!Number.isFinite(entry.assembledEnvelopeInches?.x) || !Number.isFinite(entry.assembledEnvelopeInches?.y) || !Number.isFinite(entry.assembledEnvelopeInches?.z))) {
      issues.push(issue('POLARIS_MANUFACTURER_COUPLING_ENVELOPE_INVALID', `Coupling envelope ${entry.id} is incomplete.`));
      break;
    }
  }

  const inventory = sourceInventory(calibration);
  if (inventory.rigid.length !== 28 || inventory.identifiedVictaulic.length !== 22 || inventory.generic.length !== 6
    || dimensions.reduce((sum, entry) => sum + entry.sourceInstanceCount, 0) !== 22) {
    issues.push(issue('POLARIS_MANUFACTURER_SOURCE_INSTANCE_TALLY_INVALID', 'The 28 rigid fittings no longer partition into 22 identified Victaulic and six generic instances.'));
  }
  const boundary = schedule?.boundary || {};
  if (boundary.identifiedVictaulicInstanceCount !== 22 || boundary.genericUnresolvedInstanceCount !== 6
    || boundary.primaryDimensionScheduleReady !== true || boundary.sourceInsertOriginToPortOffsetReady !== false
    || boundary.manufacturerExactTakeoutReady !== false || boundary.flexibleHoseCenterlineReady !== false
    || boundary.properPipeLayoutReady !== false || boundary.fabricationReady !== false || boundary.fieldReleaseReady !== false) {
    issues.push(issue('POLARIS_MANUFACTURER_FAIL_CLOSED_BOUNDARY_INVALID', 'Catalog dimensions must not promote source port offsets, takeout, flex geometry, proper layout, fabrication, or release.'));
  }

  const primaryDimensionScheduleReady = issues.length === 0;
  return {
    status: primaryDimensionScheduleReady ? 'passed' : 'blocked',
    issues,
    metrics: {
      rigidFittingCount: inventory.rigid.length,
      identifiedVictaulicInstanceCount: inventory.identifiedVictaulic.length,
      genericUnresolvedInstanceCount: inventory.generic.length,
      primaryDimensionRecordCount: dimensions.length,
    },
    primaryDimensionScheduleReady,
    sourceInsertOriginToPortOffsetReady: false,
    manufacturerExactTakeoutReady: false,
    flexibleHoseCenterlineReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export function verifyPolarisManufacturerDimensionAdversarialLoop(schedule, calibration) {
  const attacks = [
    ['publication-revision', (value) => { value.sources[0].revision = 'drift'; }],
    ['dimension-value', (value) => { value.dimensions[0].valueInches += 1; }],
    ['instance-count', (value) => { value.dimensions[0].sourceInstanceCount += 1; }],
    ['coupling-envelope', (value) => { delete value.dimensions.find((entry) => entry.id === 'style009n-3').assembledEnvelopeInches.z; }],
    ['false-takeout-promotion', (value) => { value.boundary.manufacturerExactTakeoutReady = true; }],
    ['false-layout-promotion', (value) => { value.boundary.properPipeLayoutReady = true; }],
  ];
  const rejectedCases = attacks.map(([name, mutate]) => {
    const value = structuredClone(schedule);
    mutate(value);
    return { name, rejected: evaluatePolarisManufacturerDimensionSchedule(value, calibration).status === 'blocked' };
  });
  return { status: rejectedCases.every((entry) => entry.rejected) ? 'passed' : 'failed', rejectedCases };
}
