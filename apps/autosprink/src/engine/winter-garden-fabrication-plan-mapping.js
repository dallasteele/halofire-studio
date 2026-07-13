import { sha256Hex } from './elevation-datums.js';
import { buildWinterGardenCeilingModel3d, validateWinterGardenCeilingElevationEvidence } from './winter-garden-ceiling-elevation.js';
import { buildWinterGardenChapelPlaneAssignments, validatePiecewiseGridRegistration } from './piecewise-grid-registration.js';
import { validateRasterBullseyeHeadEvidence } from './raster-bullseye-head-evidence.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-6) => Math.abs(left - right) <= tolerance;
const EXPECTED = Object.freeze({
  FP2: 'ac052124095f73e3529fd63906127bac9c2cf3b3f6abd45222c5125fa4195977',
  FP3: '93f8df04bc84ac817ecd2e222812fede93565879094c66b4d7511f783631543e',
  TYL: '53ff9f89d03a1672aa06788efd1d20c0a5a711e4bc97ef97f9aa83c333b03d12',
  A007: 'dd2ac41e4ddcd59248102b5d6bd7e317c5a7193f4d6db1df9131ba7308adc41c',
});
const EXPECTED_ROWS = Object.freeze({
  'chapel-north': { plane: 'chapel-north-slope', lines: ['9B', '9C', '9D', '24A'], elevationFt: 19 + 5 / 12, sourceText: '(+19\'-5")' },
  'chapel-ridge': { plane: 'chapel-ridge', lines: ['25L', '25M', '25N', '25O'], elevationFt: 24 + 1 / 12, sourceText: '(+24\'-1")' },
  'chapel-south': { plane: 'chapel-south-slope', lines: ['7B', '7C', '7D', '23A'], elevationFt: 19 + 4 / 12, sourceText: '(+19\'-4")' },
});

function mappedOutlets(row, pxPerFt) {
  const outlets = [];
  for (const chain of row.chains || []) {
    let pieceOrigin = chain.originPlanXPx;
    for (const piece of chain.pieces || []) {
      for (const outlet of piece.selectedOutlets || []) {
        outlets.push({
          rowId: row.id,
          chainId: chain.id,
          lineNo: piece.lineNo,
          outletNo: outlet.outletNo,
          runDimFt: outlet.runDimFt,
          sizeIn: outlet.sizeIn,
          orientation: outlet.orientation,
          takeoffPlanPointPx: [pieceOrigin + outlet.runDimFt * pxPerFt, row.branchPlanYPx],
        });
      }
      pieceOrigin += piece.lengthFt * pxPerFt;
    }
  }
  return outlets.sort((left, right) => left.takeoffPlanPointPx[0] - right.takeoffPlanPointPx[0]);
}

export async function sealWinterGardenFabricationPlanMapping(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenFabricationPlanMapping(value, registration, headEvidence) {
  if (!value || value.artifactType !== 'halofire.winter-garden-fabrication-plan-mapping.v1') return { status: 'blocked', issues: [issue('WG_FAB_PLAN_SCHEMA_INVALID', 'Winter Garden fabrication-to-plan mapping schema is invalid.')] };
  const issues = []; const { receiptSha256, ...draft } = value;
  if (!SHA256.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_FAB_PLAN_RECEIPT_MISMATCH', 'Fabrication-to-plan evidence no longer matches its sealed receipt.'));
  const sources = value.sources || {};
  if (sources.sprinklerPipePlan?.sha256 !== EXPECTED.FP2 || sources.sprinklerRcp?.sha256 !== EXPECTED.FP3 || sources.fabricationListing?.sha256 !== EXPECTED.TYL || sources.submittedSprinklerCutSheets?.sha256 !== EXPECTED.A007 || sources.submittedSprinklerCutSheets?.documentNumber !== 'TFP181' || JSON.stringify(sources.submittedSprinklerCutSheets?.physicalPages) !== '[1,2,3,4]') issues.push(issue('WG_FAB_PLAN_SOURCE_DRIFT', 'FP2, FP3, TYL, or submitted A007/TFP181 source identity changed.'));
  const product = value.sprinkler || {};
  if (product.manufacturer !== 'Tyco' || product.series !== 'RFII Royal Flush II' || product.sin !== 'TY3531' || product.orientation !== 'concealed pendent' || !near(product.nominalK, 5.6) || !near(product.connectionIn, 0.5) || !near(product.verticalAdjustmentIn, 0.5) || !near(product.droppedDeflectorBelowCeilingIn?.[0], 3 / 16) || !near(product.droppedDeflectorBelowCeilingIn?.[1], 11 / 16) || !near(product.fittingFaceToCeilingRangeIn?.[0], 1.75) || !near(product.fittingFaceToCeilingRangeIn?.[1], 2.25)) issues.push(issue('WG_FAB_PLAN_MANUFACTURER_GEOMETRY_DRIFT', 'Submitted TY3531/TFP181 installation geometry changed.'));
  if (!near(value.registration?.planPxPerFt, 18.75) || !near(value.registration?.fp2MinusFp3Px?.[0], 89.25) || !near(value.registration?.fp2MinusFp3Px?.[1], 10) || value.registration?.maximumOutletToRegisteredHeadXResidualPx > 1.01) issues.push(issue('WG_FAB_PLAN_REGISTRATION_DRIFT', 'Fabrication outlet X-registration controls changed or exceed the sealed residual bound.'));
  const [grid, heads, planes] = await Promise.all([validatePiecewiseGridRegistration(registration), validateRasterBullseyeHeadEvidence(headEvidence), buildWinterGardenChapelPlaneAssignments(registration, headEvidence)]);
  if (grid.status !== 'passed' || heads.status !== 'passed' || planes.status !== 'passed') issues.push(...grid.issues, ...heads.issues, ...planes.issues);
  const assignments = new Map((planes.assignments || []).map((entry) => [entry.headId, entry]));
  const mapped = []; const outletNumbers = new Set(); const headIds = new Set();
  if (!Array.isArray(value.rows) || value.rows.length !== 3) issues.push(issue('WG_FAB_PLAN_ROW_COUNT_DRIFT', 'Exactly three source-bound chapel branch rows are required.'));
  for (const row of value.rows || []) {
    const expected = EXPECTED_ROWS[row.id]; const lines = (row.chains || []).flatMap((chain) => (chain.pieces || []).map((piece) => piece.lineNo));
    if (!expected || row.plane !== expected.plane || JSON.stringify(lines) !== JSON.stringify(expected.lines) || !near(row.pipeElevationAboveFloorFt, expected.elevationFt, 1e-8) || row.pipeElevationSourceText !== expected.sourceText) issues.push(issue('WG_FAB_PLAN_ROW_SOURCE_DRIFT', `Branch row ${row.id || 'unknown'} no longer matches its FP2 tag/elevation evidence.`));
    const outlets = mappedOutlets(row, value.registration?.planPxPerFt || 0); const ids = row.headIds || [];
    if (outlets.length !== 5 || ids.length !== 5) { issues.push(issue('WG_FAB_PLAN_HEAD_COUNT_DRIFT', `Branch row ${row.id || 'unknown'} must map five fabrication outlets to five completed heads.`)); continue; }
    for (let index = 0; index < outlets.length; index += 1) {
      const outlet = outlets[index]; const head = assignments.get(ids[index]);
      if (outlet.sizeIn !== 1 || outletNumbers.has(outlet.outletNo)) issues.push(issue('WG_FAB_PLAN_OUTLET_TYPE_DRIFT', `Outlet ${outlet.outletNo} must be a unique 1-inch pendent takeoff.`));
      if (!head || head.plane !== row.plane || headIds.has(ids[index])) { issues.push(issue('WG_FAB_PLAN_HEAD_ID_DRIFT', `Head ${ids[index]} is missing, duplicated, or assigned to the wrong ceiling row.`)); continue; }
      outletNumbers.add(outlet.outletNo); headIds.add(ids[index]);
      const registeredPlanPoint = [head.renderedPointPx[0] + value.registration.fp2MinusFp3Px[0], head.renderedPointPx[1] + value.registration.fp2MinusFp3Px[1]];
      const xResidualPx = Math.abs(outlet.takeoffPlanPointPx[0] - registeredPlanPoint[0]);
      if (xResidualPx > value.registration.maximumOutletToRegisteredHeadXResidualPx || Math.abs(row.completedHeadYPx - head.renderedPointPx[1]) > 0.01) issues.push(issue('WG_FAB_PLAN_OUTLET_HEAD_RESIDUAL_EXCEEDED', `Outlet ${outlet.outletNo} no longer X-registers to head ${ids[index]}.`));
      mapped.push({ ...outlet, headId: ids[index], registeredPlanHeadPointPx: registeredPlanPoint, outletToHeadXResidualPx: outlet.takeoffPlanPointPx[0] - registeredPlanPoint[0] });
    }
  }
  if (mapped.length !== 15 || outletNumbers.size !== 15 || headIds.size !== 15) issues.push(issue('WG_FAB_PLAN_BIJECTION_FAILED', 'The completed chapel requires a one-to-one join of 15 outlets and 15 heads.'));
  if (value.fabricationPlanMappingReady !== true || value.branchRowPipeElevationReady !== true || value.manufacturerInstallationEnvelopeReady !== true || value.exactAsBuiltDeflectorElevationReady !== false || value.fullNetworkPipeElevationReady !== false || value.fabricationReady !== false || value.complianceReady !== false) issues.push(issue('WG_FAB_PLAN_FAIL_CLOSED_STATUS_DRIFT', 'Only plan mapping, branch-row Z, and the manufacturer installation envelope may be promoted.'));
  const residuals = mapped.map((entry) => Math.abs(entry.outletToHeadXResidualPx));
  return { status: issues.length ? 'blocked' : 'passed', issues, mappings: issues.length ? [] : mapped, metrics: { mappedHeadCount: mapped.length, mappedOutletCount: outletNumbers.size, branchRowCount: value.rows?.length || 0, maximumOutletToHeadXResidualPx: residuals.length ? Math.max(...residuals) : null, manufacturerDeflectorEnvelopeIn: product.droppedDeflectorBelowCeilingIn }, fabricationPlanMappingReady: !issues.length, branchRowPipeElevationReady: !issues.length, manufacturerInstallationEnvelopeReady: !issues.length, exactAsBuiltDeflectorElevationReady: false, fullNetworkPipeElevationReady: false, fabricationReady: false, complianceReady: false };
}

export async function buildWinterGardenFabricationRegisteredModel(mapping, ceilingEvidence, registration, headEvidence) {
  const [fabrication, ceiling, baseModel] = await Promise.all([
    validateWinterGardenFabricationPlanMapping(mapping, registration, headEvidence),
    validateWinterGardenCeilingElevationEvidence(ceilingEvidence),
    buildWinterGardenCeilingModel3d(ceilingEvidence, registration, headEvidence),
  ]);
  if (fabrication.status !== 'passed' || ceiling.status !== 'passed' || baseModel.status !== 'passed') return { status: 'blocked', issues: [...fabrication.issues, ...ceiling.issues, ...(baseModel.issues || [])], ceilingSurfaces: [], headEnvelopes: [], branchPipes3d: [], complianceReady: false };
  const mappingByHead = new Map(fabrication.mappings.map((entry) => [entry.headId, entry]));
  const planeToRow = new Map(mapping.rows.map((row) => [row.plane, row])); const [minimumBelowIn, maximumBelowIn] = mapping.sprinkler.droppedDeflectorBelowCeilingIn;
  const headEnvelopes = baseModel.headEnvelopes.map((head) => {
    const fabricationOutlet = mappingByHead.get(head.headId); const row = planeToRow.get(head.plane);
    return { ...head, deflectorElevationRangeFt: [head.ceilingSurfaceElevationFt - maximumBelowIn / 12, head.ceilingSurfaceElevationFt - minimumBelowIn / 12], sprinkler: { manufacturer: mapping.sprinkler.manufacturer, series: mapping.sprinkler.series, sin: mapping.sprinkler.sin, orientation: mapping.sprinkler.orientation }, fabricationOutlet, branchPipeElevationFt: ceilingEvidence.ceiling.floorDatumFt + row.pipeElevationAboveFloorFt, branchPipeElevationSourceText: row.pipeElevationSourceText, manufacturerInstallationEnvelopeReady: true, exactDeflectorElevationReady: false };
  });
  const branchPipes3d = mapping.rows.map((row) => {
    const heads = headEnvelopes.filter((head) => head.plane === row.plane); const z = ceilingEvidence.ceiling.floorDatumFt + row.pipeElevationAboveFloorFt;
    return { id: `${row.id}-branch-z`, rowId: row.id, plane: row.plane, diameterIn: 1.25, fromFt: [Math.min(...heads.map((head) => head.planPointFt[0])), row.branchPlanYPx / mapping.registration.planPxPerFt, z], toFt: [Math.max(...heads.map((head) => head.planPointFt[0])), row.branchPlanYPx / mapping.registration.planPxPerFt, z], elevationFt: z, elevationAboveFloorFt: row.pipeElevationAboveFloorFt, sourceText: row.pipeElevationSourceText, exactBranchRowElevationReady: true };
  });
  return { ...baseModel, artifactType: 'halofire.winter-garden-fabrication-registered-model3d.v1', headEnvelopes, branchPipes3d, counts: { ...baseModel.counts, fabricationMappedHeads: headEnvelopes.length, exactBranchRowPipes: branchPipes3d.length }, fabricationPlanMappingReady: true, branchRowPipeElevationReady: true, manufacturerInstallationEnvelopeReady: true, exactAsBuiltDeflectorElevationReady: false, fullNetworkPipeElevationReady: false, fabricationReady: false, complianceReady: false, residuals: ['field_adjusted_ty3531_deflector_setpoint_not_recorded', 'main_jog_and_drop_piece_z_not_fully_registered'] };
}
