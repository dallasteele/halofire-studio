/**
 * Registers a completed stamped hydraulic calculation to Winter Garden's
 * source-bound pitched chapel branch rows. Inputs are immutable evidence
 * packets; outputs preserve row-level datum truth while withholding unproved
 * per-head identity, nominal sizes, fabrication, and compliance claims.
 */
import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';
import { buildWinterGardenFabricationRegisteredModel } from './winter-garden-fabrication-plan-mapping.js';
import { renderWinterGardenCeilingViews } from './winter-garden-ceiling-elevation.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const close = (left, right, tolerance = 1e-8) => Math.abs(left - right) <= tolerance;
const sourceSchema = z.object({
  role: z.enum(['stamped-sprinkler-pipe-plan', 'stamped-hydraulic-calculation', 'independent-hydraulic-calc-plate']),
  path: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(SHA256), physicalPages: z.array(z.number().int().positive()).min(1),
}).strict();
const sprinklerSchema = z.tuple([z.string().min(1), z.number().finite(), z.number().positive(), z.number().nonnegative(), z.number().positive(), z.number().positive(), z.number().positive()]);
const rowSchema = z.object({
  rowId: z.string().min(1), plane: z.string().min(1), fabricationElevationText: z.string().min(1), fabricationElevationAboveFloorFt: z.number().positive(),
  hydraulicNodeIds: z.array(z.string().min(1)).min(1), hydraulicNodeKind: z.enum(['operating-sprinkler', 'hydraulic-junction']), hydraulicElevationFt: z.number().positive(),
  hydraulicPhysicalPage: z.literal(4), maximumRoundingResidualFt: z.number().positive().max(0.005), matchMode: z.literal('rounded-elevation-datum-only-no-spatial-node-head-identity'),
}).strict();
const packetSchema = z.object({
  artifactType: z.literal('halofire.winter-garden-pitched-hydraulic-registration.v1'), projectId: z.literal('winter-garden-meetinghouse'),
  projectName: z.literal('LDS Meeting House - Winter Garden FL'), verifiedAt: z.string().min(1), sourceBindings: z.array(sourceSchema).length(3),
  upstreamReceipts: z.record(z.string(), z.string().regex(SHA256)), hydraulicSystem: z.record(z.string(), z.union([z.string(), z.number()])),
  independentCalcPlate: z.record(z.string(), z.union([z.string(), z.number()])), operatingSprinklers: z.array(sprinklerSchema).length(17),
  diameterObservations: z.array(z.object({ actualInsideDiameterIn: z.number().positive(), physicalPages: z.array(z.number().int().positive()).min(1), scope: z.string().min(1) }).strict()).min(2),
  pitchedRowJoins: z.array(rowSchema).length(3), pitchedRowHydraulicDatumRegistrationReady: z.literal(true), operatingSprinklerHydraulicEvidenceReady: z.literal(true),
  hydraulicInsideDiameterReportEvidenceReady: z.literal(true), perHeadHydraulicIdentityReady: z.literal(false), nominalPipeSizeReady: z.literal(false),
  fullNetworkPipeElevationReady: z.literal(false), exactAsBuiltDeflectorElevationReady: z.literal(false), fabricationReady: z.literal(false), complianceReady: z.literal(false),
  limitations: z.array(z.string().min(1)).min(4), receiptSha256: z.string(),
}).strict();

const EXPECTED_SOURCES = Object.freeze({
  'stamped-sprinkler-pipe-plan': ['ac052124095f73e3529fd63906127bac9c2cf3b3f6abd45222c5125fa4195977', 2653154, 1],
  'stamped-hydraulic-calculation': ['29b028c1dc89bcf73462aefd11f773a5079d169146cf2ef8c9df752889cf6e95', 637146, 17],
  'independent-hydraulic-calc-plate': ['27214965864964897431c27cd2a99be4e32374a27dc17f977d069095869f5c81', 45230, 1],
});
const EXPECTED_RECEIPTS = Object.freeze({
  completedHeadEvidence: '458c5af81950028f2a8eca8a0d683c438e39729280bc19113df0ece7ae8be9e7', gridRegistration: 'ba64ed53695dc5b515ccbb1dd6a43efc634c3081869444f464164913ceb2ffc5',
  pipeEvidence: '44ecf142b388c63b14bb2b3aca89d98b612eae74a33c12e953ef9f6f84e708af', ceilingElevation: 'f3844b7427f28ac282e50ab50a05e9f5b4547cc69888a5e593ca784008e582cd',
  fabricationPlanMapping: 'c746308eddaf57f1c17da5b128744c3ccbfd596240ba825335bd0f3a677d7673',
});
const EXPECTED_SPRINKLERS = Object.freeze([
  ['1', 19.42, 5.6, 24.2, 27.5, 25, 0.23], ['2', 19.42, 5.6, 23.9, 27.4, 25, 0.23], ['4', 16.33, 5.6, 22.7, 26.7, 25, 0.24],
  ['5', 16.33, 5.6, 20.6, 25.4, 25, 0.23], ['7', 16.33, 5.6, 20, 25, 25, 0.23], ['8', 16.33, 5.6, 20, 25, 25, 0.23],
  ['9', 16.33, 5.6, 20.7, 25.5, 25, 0.23], ['11', 13.42, 5.6, 23.2, 27, 25, 0.21], ['12', 13.42, 5.6, 21, 25.7, 25, 0.2],
  ['14', 13.42, 5.6, 20.4, 25.3, 25, 0.19], ['15', 13.42, 5.6, 20.4, 25.3, 25, 0.19], ['16', 13.42, 5.6, 21.1, 25.7, 25, 0.2],
  ['18', 9.33, 5.6, 24.4, 27.7, 25, 0.21], ['19', 9.33, 5.6, 22.1, 26.4, 25, 0.2], ['20', 9.33, 5.6, 21.6, 26, 25, 0.2],
  ['22', 9.33, 5.6, 21.6, 26, 25, 0.2], ['23', 9.33, 5.6, 22.3, 26.5, 25, 0.2],
]);
const EXPECTED_ROWS = Object.freeze({
  'chapel-north': { plane: 'chapel-north-slope', text: '(+19\'-5")', fabricationFt: 19 + 5 / 12, hydraulicFt: 19.42, nodes: ['1', '2'], kind: 'operating-sprinkler' },
  'chapel-ridge': { plane: 'chapel-ridge', text: '(+24\'-1")', fabricationFt: 24 + 1 / 12, hydraulicFt: 24.08, nodes: ['38'], kind: 'hydraulic-junction' },
  'chapel-south': { plane: 'chapel-south-slope', text: '(+19\'-4")', fabricationFt: 19 + 4 / 12, hydraulicFt: 19.33, nodes: ['A6'], kind: 'hydraulic-junction' },
});

/** Returns a canonical content receipt for a registration draft. */
export async function sealWinterGardenPitchedHydraulicRegistration(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

/** Validates source identity, completed-job tables, row datum joins, and fail-closed claims. */
export async function validateWinterGardenPitchedHydraulicRegistration(input) {
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('WG_PITCHED_HYDRAULIC_SCHEMA_INVALID', parsed.error.issues[0]?.message || 'Registration schema is invalid.')] };
  const packet = parsed.data; const issues = []; const { receiptSha256, ...draft } = packet;
  if (!SHA256.test(receiptSha256) || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_PITCHED_HYDRAULIC_RECEIPT_MISMATCH', 'Registration content no longer matches its sealed receipt.'));
  for (const source of packet.sourceBindings) {
    const expected = EXPECTED_SOURCES[source.role];
    if (!expected || source.sha256 !== expected[0] || source.bytes !== expected[1] || source.physicalPages.length !== expected[2]) issues.push(issue('WG_PITCHED_HYDRAULIC_SOURCE_DRIFT', `Source ${source.role} changed identity or page coverage.`));
  }
  if (JSON.stringify(packet.upstreamReceipts) !== JSON.stringify(EXPECTED_RECEIPTS)) issues.push(issue('WG_PITCHED_HYDRAULIC_UPSTREAM_RECEIPT_DRIFT', 'Completed head, grid, pipe, ceiling, or fabrication evidence changed.'));
  const system = packet.hydraulicSystem; const plate = packet.independentCalcPlate;
  if (system.sheetReference !== 'FP2' || system.remoteAreaNumber !== 1 || system.remoteAreaSizeSqFt !== 1500 || system.designDensityGpmPerSqFt !== 0.1 || system.flowingOutletCount !== 17 || system.hydraulicAreaFlowGpm !== 444 || system.pumpDischargeRequiredPressurePsi !== 63.9 || system.availablePressurePsi !== 80.5 || system.safetyPressurePsi !== 16.4 || system.maximumWaterVelocityFps !== 19.5) issues.push(issue('WG_PITCHED_HYDRAULIC_SYSTEM_SUMMARY_DRIFT', 'Stamped hydraulic system summary changed.'));
  if (plate.sheetReference !== 'FP2' || plate.remoteAreaNumber !== 1 || plate.remoteAreaSizeSqFt !== 1500 || plate.designDensityGpmPerSqFt !== 0.1 || plate.flowDemandAtBorGpm !== 444 || plate.hoseAllowanceGpm !== 100 || plate.hazard !== 'Light') issues.push(issue('WG_PITCHED_HYDRAULIC_INDEPENDENT_PLATE_DRIFT', 'Independent calc-plate controls no longer reproduce the completed project, sheet, area, density, flow, hose, and hazard.'));
  if (JSON.stringify(packet.operatingSprinklers) !== JSON.stringify(EXPECTED_SPRINKLERS)) issues.push(issue('WG_PITCHED_HYDRAULIC_SPRINKLER_TABLE_DRIFT', 'The 17 operating sprinkler records changed.'));
  const diameters = [...packet.diameterObservations.map((entry) => entry.actualInsideDiameterIn)].sort((a, b) => a - b);
  if (JSON.stringify(diameters) !== JSON.stringify([1.38, 2.067, 3.068, 8.071, 8.249, 8.488])) issues.push(issue('WG_PITCHED_HYDRAULIC_DIAMETER_DRIFT', 'Actual inside-diameter observations changed or were substituted with nominal sizes.'));
  const rowResiduals = [];
  for (const row of packet.pitchedRowJoins) {
    const expected = EXPECTED_ROWS[row.rowId]; const residualFt = Math.abs(row.fabricationElevationAboveFloorFt - row.hydraulicElevationFt); rowResiduals.push({ rowId: row.rowId, residualFt, residualIn: residualFt * 12 });
    if (!expected || row.plane !== expected.plane || row.fabricationElevationText !== expected.text || !close(row.fabricationElevationAboveFloorFt, expected.fabricationFt, 1e-8) || !close(row.hydraulicElevationFt, expected.hydraulicFt) || JSON.stringify(row.hydraulicNodeIds) !== JSON.stringify(expected.nodes) || row.hydraulicNodeKind !== expected.kind) issues.push(issue('WG_PITCHED_HYDRAULIC_ROW_IDENTITY_DRIFT', `Pitched row ${row.rowId || 'unknown'} no longer matches the sealed FP2/HASS datum join.`));
    if (residualFt > row.maximumRoundingResidualFt) issues.push(issue('WG_PITCHED_HYDRAULIC_ROW_RESIDUAL_HIGH', `Pitched row ${row.rowId} exceeds the hydraulic-report rounding tolerance.`));
  }
  if (new Set(packet.pitchedRowJoins.map((row) => row.rowId)).size !== 3) issues.push(issue('WG_PITCHED_HYDRAULIC_ROW_DUPLICATED', 'All three pitched chapel rows must be unique.'));
  return {
    status: issues.length ? 'blocked' : 'passed', artifactType: packet.artifactType, projectId: packet.projectId, projectName: packet.projectName, issues,
    receiptSha256, sourceBindings: packet.sourceBindings, hydraulicSystem: packet.hydraulicSystem, independentCalcPlate: packet.independentCalcPlate,
    operatingSprinklers: packet.operatingSprinklers.map(([nodeId, elevationFt, kFactor, pressurePsi, actualFlowGpm, minimumFlowGpm, actualDensityGpmPerSqFt]) => ({ nodeId, elevationFt, kFactor, pressurePsi, actualFlowGpm, minimumFlowGpm, actualDensityGpmPerSqFt })),
    diameterObservations: packet.diameterObservations, pitchedRowJoins: packet.pitchedRowJoins, rowResiduals,
    metrics: { pitchedRowCount: 3, operatingSprinklerCount: 17, hydraulicInsideDiameterClassCount: diameters.length, maximumRowElevationResidualIn: Math.max(...rowResiduals.map((row) => row.residualIn)) },
    pitchedRowHydraulicDatumRegistrationReady: issues.length === 0, operatingSprinklerHydraulicEvidenceReady: issues.length === 0, hydraulicInsideDiameterReportEvidenceReady: issues.length === 0,
    perHeadHydraulicIdentityReady: false, nominalPipeSizeReady: false, fullNetworkPipeElevationReady: false, exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
    limitations: packet.limitations,
  };
}

function renderHydraulicDatumView(model) {
  const rows = model.branchPipes3d; const minimum = Math.min(...rows.map((row) => row.hydraulicProjectElevationFt)); const maximum = Math.max(...rows.map((row) => row.hydraulicProjectElevationFt));
  const y = (z) => 250 - (z - minimum) / Math.max(1, maximum - minimum) * 180;
  const marks = rows.map((row, index) => `<g><line x1="${120 + index * 190}" y1="${y(row.elevationFt).toFixed(2)}" x2="${250 + index * 190}" y2="${y(row.elevationFt).toFixed(2)}"/><text x="${120 + index * 190}" y="${(y(row.elevationFt) - 10).toFixed(2)}">${row.rowId}: ${row.sourceText} / HASS ${row.hydraulicElevationAboveFloorFt.toFixed(2)} ft</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 300" role="img" aria-label="Winter Garden pitched branch hydraulic datum registration"><style>line{stroke:#a78bfa;stroke-width:5}text{fill:#e2e8f0;font:11px monospace}</style><rect width="760" height="300" fill="#07111f"/><text x="20" y="24">FP2 completed branch Z joined to stamped HASS row datums; no per-head node identity</text>${marks}</svg>`;
}

/** Builds the completed 15-head pitched 3D model with row-level hydraulic datum joins. */
export async function buildWinterGardenPitchedHydraulicModel(packet, dependencies) {
  const [validation, baseModel] = await Promise.all([
    validateWinterGardenPitchedHydraulicRegistration(packet),
    buildWinterGardenFabricationRegisteredModel(dependencies.fabricationMapping, dependencies.ceilingEvidence, dependencies.gridRegistration, dependencies.headEvidence),
  ]);
  if (validation.status !== 'passed' || baseModel.status !== 'passed') return { status: 'blocked', issues: [...validation.issues, ...(baseModel.issues || [])], branchPipes3d: [], headEnvelopes: [], complianceReady: false };
  const joins = new Map(validation.pitchedRowJoins.map((row) => [row.rowId, row])); const floorDatumFt = dependencies.ceilingEvidence.ceiling.floorDatumFt;
  const branchPipes3d = baseModel.branchPipes3d.map((pipe) => {
    const join = joins.get(pipe.rowId); const residualFt = pipe.elevationAboveFloorFt - join.hydraulicElevationFt;
    return { ...pipe, hydraulicNodeIds: join.hydraulicNodeIds, hydraulicNodeKind: join.hydraulicNodeKind, hydraulicElevationAboveFloorFt: join.hydraulicElevationFt, hydraulicProjectElevationFt: floorDatumFt + join.hydraulicElevationFt, hydraulicElevationResidualFt: residualFt, hydraulicElevationResidualIn: residualFt * 12, hydraulicMatchMode: join.matchMode, hydraulicInsideDiameterIn: null, nominalPipeSizeReady: false, perHeadHydraulicIdentityReady: false };
  });
  const model = { ...baseModel, artifactType: 'halofire.winter-garden-pitched-hydraulic-model3d.v1', branchPipes3d, hydraulicSystem: validation.hydraulicSystem, operatingSprinklers: validation.operatingSprinklers, diameterObservations: validation.diameterObservations, rowResiduals: validation.rowResiduals, pitchedRowHydraulicDatumRegistrationReady: true, operatingSprinklerHydraulicEvidenceReady: true, hydraulicInsideDiameterReportEvidenceReady: true, perHeadHydraulicIdentityReady: false, nominalPipeSizeReady: false, fullNetworkPipeElevationReady: false, exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false, residuals: [...baseModel.residuals, 'hydraulic_nodes_not_bijectively_mapped_to_completed_chapel_heads', 'hydraulic_inside_diameters_not_spatially_bound_to_every_completed_pipe'] };
  return { ...model, views: { ...renderWinterGardenCeilingViews(model), hydraulicDatumSvg: renderHydraulicDatumView(model) } };
}

/** Runs source, geometry, identity, diameter, and false-promotion mutations through the production validator. */
export async function verifyWinterGardenPitchedHydraulicAdversarialLoop(packet) {
  const mutations = {
    receiptDriftRejected: async (draft) => { draft.receiptSha256 = '0'.repeat(64); return draft; },
    sourceSubstitutionRejected: async (draft) => { draft.sourceBindings[1].sha256 = '0'.repeat(64); return sealWinterGardenPitchedHydraulicRegistration(draft); },
    upstreamReceiptDriftRejected: async (draft) => { draft.upstreamReceipts.fabricationPlanMapping = '0'.repeat(64); return sealWinterGardenPitchedHydraulicRegistration(draft); },
    rowDatumDriftRejected: async (draft) => { draft.pitchedRowJoins[1].hydraulicElevationFt += 1; return sealWinterGardenPitchedHydraulicRegistration(draft); },
    fabricatedNodeIdentityRejected: async (draft) => { draft.pitchedRowJoins[0].hydraulicNodeIds = ['38']; return sealWinterGardenPitchedHydraulicRegistration(draft); },
    insideDiameterSubstitutionRejected: async (draft) => { draft.diameterObservations[0].actualInsideDiameterIn = 1.5; return sealWinterGardenPitchedHydraulicRegistration(draft); },
    perHeadIdentityPromotionRejected: async (draft) => { draft.perHeadHydraulicIdentityReady = true; return sealWinterGardenPitchedHydraulicRegistration(draft); },
    compliancePromotionRejected: async (draft) => { draft.complianceReady = true; return sealWinterGardenPitchedHydraulicRegistration(draft); },
  };
  const results = {};
  for (const [name, mutate] of Object.entries(mutations)) {
    const mutated = await mutate(structuredClone(packet)); results[name] = (await validateWinterGardenPitchedHydraulicRegistration(mutated)).status === 'blocked';
  }
  return { status: Object.values(results).every(Boolean) ? 'passed' : 'blocked', ...results };
}
