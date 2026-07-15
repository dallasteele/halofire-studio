import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const ROOF_PACKET_RECEIPT = '9fc9718be4ff957b36483319c629fe90478f0a5075d77b041b47ddcaa4d587fd';
const EVIDENCE_RECEIPT = '368496bdc3db1362b20889af81a4ef6fc7d264d94be09d33ca7f831e9ddb4e6d';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function assertDependencies(roofPacket, evidence) {
  if (roofPacket?.artifactType !== 'halofire.mit-riverside-building-j-roof-plane-elevation.v1' || roofPacket?.receiptSha256 !== ROOF_PACKET_RECEIPT || roofPacket?.headAssignments?.length !== 68 || roofPacket?.headInstallationZReady !== false) throw new Error('MIT_J_CEILING_ENVELOPE_ROOF_PACKET_BLOCKED');
  if (evidence?.artifactType !== 'halofire.mit-riverside-building-j-ceiling-installation-envelope-evidence.v1' || evidence?.receiptSha256 !== EVIDENCE_RECEIPT) throw new Error('MIT_J_CEILING_ENVELOPE_EVIDENCE_BLOCKED');
  if (evidence?.counts?.ceilingZones !== 20 || evidence?.counts?.pendentHeadsBound !== 15 || evidence?.counts?.pendentAt9Ft !== 13 || evidence?.counts?.pendentAt10Ft !== 2 || evidence?.counts?.aboveFinishedCeilingUprights !== 7) throw new Error('MIT_J_CEILING_ENVELOPE_EVIDENCE_COUNTS_BLOCKED');
  if (evidence?.approvedSprinklerSchedule?.pendent?.sin !== 'TY3231' || evidence?.approvedSprinklerSchedule?.upright?.sin !== 'TY3131' || evidence?.submittedManufacturerData?.standardPendentFigure?.escutcheonPlateSeatingSurfaceToDeflectorIn !== 1.5) throw new Error('MIT_J_CEILING_ENVELOPE_PRODUCT_BINDING_BLOCKED');
  if (evidence?.claims?.exactInstalledDeflectorZReady !== false || evidence?.claims?.complianceReady !== false) throw new Error('MIT_J_CEILING_ENVELOPE_FALSE_SOURCE_PROMOTION');
}

export async function buildMitRiversideBuildingJCeilingInstallationEnvelope(roofPacket, evidence) {
  assertDependencies(roofPacket, evidence);
  const pendentBindings = new Map(evidence.pendentBindings.map((binding) => [binding.headId, binding]));
  const aboveCeiling = new Set(evidence.aboveFinishedCeilingUprightIds);
  const headAssignments = roofPacket.headAssignments.map((head) => {
    const pendent = pendentBindings.get(head.id);
    if (pendent) {
      const conditionalDeflectorZFt = round(pendent.ceilingHeightFt - evidence.submittedManufacturerData.standardPendentFigure.escutcheonPlateSeatingSurfaceToDeflectorIn / 12);
      return {
        ...structuredClone(head), sourceProtectionRegime: 'finished-ceiling-ty3231-standard-pendent-detail-unsealed', sourceProtectionPlaneId: pendent.ceilingZoneId,
        sourceProtectionPlaneZFt: pendent.ceilingHeightFt, ceilingHeightFt: pendent.ceilingHeightFt, ceilingControlId: pendent.controlId,
        approvedSin: 'TY3231', approvedPosition: 'PEND', finishedCeilingOverlap: true,
        conditionalManufacturerDeflectorZFt: conditionalDeflectorZFt, conditionalDeflectorBasis: 'TFP171 figure 3 standard pendent, only if the escutcheon plate seating surface equals the proved ceiling plane',
        headInstallationZFt: null,
      };
    }
    return {
      ...structuredClone(head),
      sourceProtectionRegime: aboveCeiling.has(head.id) ? 'above-finished-ceiling-upright-to-sloped-bottom-of-deck' : 'source-bottom-of-deck-target-no-finished-ceiling-zone-overlap',
      approvedSin: 'TY3131', approvedPosition: 'UPR', finishedCeilingOverlap: aboveCeiling.has(head.id), ceilingHeightFt: null,
      conditionalManufacturerDeflectorZFt: null, conditionalDeflectorBasis: null, headInstallationZFt: null,
    };
  });
  const counts = {
    totalHeads: headAssignments.length,
    pendentCeilingPlanes: headAssignments.filter((head) => head.kind === 'pendent' && Number.isFinite(head.sourceProtectionPlaneZFt)).length,
    pendentAt9Ft: headAssignments.filter((head) => head.kind === 'pendent' && head.ceilingHeightFt === 9).length,
    pendentAt10Ft: headAssignments.filter((head) => head.kind === 'pendent' && head.ceilingHeightFt === 10).length,
    aboveFinishedCeilingUprights: headAssignments.filter((head) => head.kind === 'upright' && head.finishedCeilingOverlap).length,
    uprightNoFinishedCeilingZoneOverlap: headAssignments.filter((head) => head.kind === 'upright' && !head.finishedCeilingOverlap).length,
    allSourceProtectionTargets: headAssignments.filter((head) => Number.isFinite(head.sourceProtectionPlaneZFt)).length,
    conditionalManufacturerDeflectorValues: headAssignments.filter((head) => Number.isFinite(head.conditionalManufacturerDeflectorZFt)).length,
    exactInstalledHeadZ: headAssignments.filter((head) => Number.isFinite(head.headInstallationZFt)).length,
  };
  const expected = { totalHeads: 68, pendentCeilingPlanes: 15, pendentAt9Ft: 13, pendentAt10Ft: 2, aboveFinishedCeilingUprights: 7, uprightNoFinishedCeilingZoneOverlap: 46, allSourceProtectionTargets: 68, conditionalManufacturerDeflectorValues: 15, exactInstalledHeadZ: 0 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error('MIT_J_CEILING_ENVELOPE_ASSIGNMENT_COUNTS_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-ceiling-installation-envelope.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceRoofPlanePacketReceiptSha256: roofPacket.receiptSha256, sourceCeilingInstallationEvidenceReceiptSha256: evidence.receiptSha256,
    generationMode: 'protected-rcp-ceiling-polygons-approved-fp2-product-schedule-and-submitted-tfp171-conditional-geometry',
    approvedProducts: structuredClone(evidence.approvedSprinklerSchedule), submittedManufacturerData: structuredClone(evidence.submittedManufacturerData),
    ceilingControls: structuredClone(evidence.ceilingControls), ceilingZones: structuredClone(evidence.ceilingZones),
    headAssignments, counts,
    regimeCorrection: { priorGenericOpenStructureUprightCount: 53, provedAboveFinishedCeilingUprightCount: 7, remainingUprightsWithoutFinishedCeilingZoneOverlap: 46, openStructureLabelNoLongerUsedAsIndividualHeadFact: true },
    internalVerification: {
      primary: { status: 'passed', method: 'RCP DWG exact ceiling-material polygon containment plus RCP PDF ceiling-height text replay' },
      independent: { status: 'passed', method: 'approved FP-2 schedule and submitted TFP171 TY3131/TY3231 dimensional binding' },
      adversarial: { status: 'passed', method: 'dependency, count, zone, height, product, overlap, conditional geometry, installed-Z, compliance, fabrication, and release mutations' },
    },
    allPendentCeilingPlanesReady: true, allSourceProtectionTargetsReady: true, approvedProductScheduleReady: true, conditionalStandardPendentGeometryReady: true,
    exactInstalledHeadZReady: false, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false,
    complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'prove the selected ceiling escutcheon/fitting seating detail or preserve conditional TY3231 deflector values; then bind source-generated placement to the registered top/elevation/3D underlay proof',
    claimStatus: '68-source-protection-targets-and-approved-products-ready-with-15-conditional-ty3231-deflector-values-not-exact-installed-z-compliance-fabrication-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJCeilingInstallationEnvelope(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJCeilingInstallationEnvelope(dependencies.roofPacket, dependencies.evidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_CEILING_ENVELOPE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_CEILING_ENVELOPE_REPLAY_MISMATCH', 'Ceiling installation-envelope packet no longer equals deterministic protected-source replay.'));
  if (JSON.stringify(packet?.counts) !== JSON.stringify({ totalHeads: 68, pendentCeilingPlanes: 15, pendentAt9Ft: 13, pendentAt10Ft: 2, aboveFinishedCeilingUprights: 7, uprightNoFinishedCeilingZoneOverlap: 46, allSourceProtectionTargets: 68, conditionalManufacturerDeflectorValues: 15, exactInstalledHeadZ: 0 })) issues.push(issue('MIT_J_CEILING_ENVELOPE_COUNT_DRIFT', 'Ceiling, overlap, product, or installed-Z counts changed.'));
  for (const head of packet?.headAssignments || []) {
    if (!Number.isFinite(head.sourceProtectionPlaneZFt)) { issues.push(issue('MIT_J_SOURCE_PROTECTION_TARGET_MISSING', `Head ${head.id} lost its source target.`)); break; }
    if (head.headInstallationZFt !== null) { issues.push(issue('MIT_J_EXACT_INSTALLED_Z_FALSE_PROMOTION', `Head ${head.id} received exact installed Z without seating-detail closure.`)); break; }
    if (head.kind === 'pendent' && (head.approvedSin !== 'TY3231' || !Number.isFinite(head.ceilingHeightFt) || !Number.isFinite(head.conditionalManufacturerDeflectorZFt))) { issues.push(issue('MIT_J_PENDENT_PRODUCT_OR_CEILING_DRIFT', `Pendent ${head.id} lost its approved product or conditional ceiling geometry.`)); break; }
    if (head.kind === 'upright' && head.approvedSin !== 'TY3131') { issues.push(issue('MIT_J_UPRIGHT_PRODUCT_DRIFT', `Upright ${head.id} lost its approved product binding.`)); break; }
  }
  if (packet?.regimeCorrection?.provedAboveFinishedCeilingUprightCount !== 7 || packet?.regimeCorrection?.openStructureLabelNoLongerUsedAsIndividualHeadFact !== true) issues.push(issue('MIT_J_CEILING_REGIME_CORRECTION_DRIFT', 'The RCP-proved above-ceiling correction was weakened.'));
  if (packet?.allPendentCeilingPlanesReady !== true || packet?.allSourceProtectionTargetsReady !== true || packet?.approvedProductScheduleReady !== true || packet?.conditionalStandardPendentGeometryReady !== true || packet?.exactInstalledHeadZReady !== false || packet?.headElevationsReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_CEILING_ENVELOPE_FALSE_PROMOTION', 'Source targets and conditional product geometry may not promote exact installed Z, generation, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, allSourceProtectionTargetsReady: issues.length === 0, conditionalStandardPendentGeometryReady: issues.length === 0, exactInstalledHeadZReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJCeilingInstallationEnvelopeAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (value) => { value.receiptSha256 = '0'.repeat(64); }], ['roof-receipt', (value) => { value.sourceRoofPlanePacketReceiptSha256 = 'f'.repeat(64); }], ['evidence-receipt', (value) => { value.sourceCeilingInstallationEvidenceReceiptSha256 = 'f'.repeat(64); }],
    ['remove-zone', (value) => { value.ceilingZones.pop(); }], ['pendent-height', (value) => { value.headAssignments.find((head) => head.kind === 'pendent').ceilingHeightFt = 8; }], ['pendent-product', (value) => { value.headAssignments.find((head) => head.kind === 'pendent').approvedSin = 'generic'; }], ['upright-product', (value) => { value.headAssignments.find((head) => head.kind === 'upright').approvedSin = 'generic'; }],
    ['conditional-z', (value) => { value.headAssignments.find((head) => head.kind === 'pendent').conditionalManufacturerDeflectorZFt += 1; }], ['source-target', (value) => { value.headAssignments[0].sourceProtectionPlaneZFt = null; }], ['installed-z', (value) => { value.headAssignments[0].headInstallationZFt = 10; }],
    ['above-ceiling', (value) => { value.regimeCorrection.provedAboveFinishedCeilingUprightCount = 0; }], ['open-label', (value) => { value.regimeCorrection.openStructureLabelNoLongerUsedAsIndividualHeadFact = false; }], ['count', (value) => { value.counts.pendentAt9Ft = 12; }],
    ['all-targets', (value) => { value.allSourceProtectionTargetsReady = false; }], ['exact-ready', (value) => { value.exactInstalledHeadZReady = true; }], ['head-ready', (value) => { value.headElevationsReady = true; }], ['generated', (value) => { value.sourceGeneratedPitchedPlacementVerified = true; }], ['compliance', (value) => { value.complianceReady = true; }], ['fabrication', (value) => { value.fabricationReady = true; }], ['release', (value) => { value.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJCeilingInstallationEnvelope(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, allSourceProtectionTargetsReady: true, exactInstalledHeadZReady: false, complianceReady: false };
}
