import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const EXPECTED_SOURCES = Object.freeze({
  A103: 'bca163d23e89b86332f670f6f234f5bc5319b1a1e461de28a3fb3124120c2f89',
  A121: '0fa8d19cf2a8ca421a3cad7200b410763eee701bb566ca84d37321b1b51ce921',
  A151: '4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43',
  A201: 'f756533aaf7bb8f1229b28226d26d0fbb53c9cd09f80af2bdcf1b271963243a8',
  A301: '719ae05138b3872c2ed8740fa4470ca457dcc0a9f8fec617cabf7969560ecc30',
});
const REQUIRED_OPERATIONAL_SOURCES = Object.freeze([
  'halofire/bid-process-knowledge.md',
  'halofire-master/03-Design-Engineering/03_Design_Engineering.md',
  'halofire-master/05-Fabrication-Shop/05_Fabrication_Shop.md',
  'halofire-master/06-Field-Ops-Install/06_Field_Ops_Install.md',
  'halofire-autobid/system/autobid-index.md',
]);
const REQUIRED_WORKFLOW_GUARDRAILS = Object.freeze([
  'estimate-before-award-is-not-install-design',
  'source-scale-and-elevation-datums-must-be-proven',
  'completed-bids-are-held-out-calibration-not-generation-inputs',
  'design-hands-off-to-fabrication-and-field-only-after-required-approvals',
  'ahj-compliance-fabrication-and-manufacturer-claims-fail-closed',
  'primary-independent-and-adversarial-verification-loops-are-internal',
]);
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (a, b, tolerance = 1e-5) => Math.abs(Number(a) - Number(b)) <= tolerance;

export async function sealWinterGardenSourceBuildingPacket(draft) {
  const clean = structuredClone(draft); delete clean.receiptSha256;
  return { ...clean, receiptSha256: await sha256Hex(clean) };
}

export async function validateWinterGardenSourceBuildingPacket(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-building-packet.v1' || value.projectName !== 'LDS Meeting House - Winter Garden FL') {
    return { status: 'blocked', issues: [issue('WG_SOURCE_BUILDING_SCHEMA_INVALID', 'Winter Garden source building packet identity is invalid.')], model: null, complianceReady: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_BUILDING_RECEIPT_MISMATCH', 'Source building packet no longer matches its immutable receipt.'));
  const sources = new Map((Array.isArray(value.sourceBindings) ? value.sourceBindings : []).map((entry) => [entry.sheet, entry.sha256]));
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length || Object.entries(EXPECTED_SOURCES).some(([sheet, sha256]) => sources.get(sheet) !== sha256)) issues.push(issue('WG_SOURCE_BUILDING_SOURCE_DRIFT', 'A103/A121/A151/A201/A301 source bindings are incomplete or changed.'));
  const knowledge = value.operationalKnowledge;
  const operationalSources = new Set(Array.isArray(knowledge?.sources) ? knowledge.sources : []);
  const workflowGuardrails = new Set(Array.isArray(knowledge?.workflowGuardrails) ? knowledge.workflowGuardrails : []);
  const recallEpisodeIds = Array.isArray(knowledge?.recallEpisodeIds) ? knowledge.recallEpisodeIds : [];
  if (knowledge?.preflightStatus !== 'passed'
    || knowledge?.source !== 'gx10-hal-brain+obsidian-vault'
    || typeof knowledge?.sessionId !== 'string'
    || knowledge.sessionId.length < 12
    || recallEpisodeIds.length < 4
    || recallEpisodeIds.some((episodeId) => !Number.isInteger(episodeId) || episodeId <= 0)
    || REQUIRED_OPERATIONAL_SOURCES.some((source) => !operationalSources.has(source))
    || REQUIRED_WORKFLOW_GUARDRAILS.some((guardrail) => !workflowGuardrails.has(guardrail))) {
    issues.push(issue('WG_SOURCE_BUILDING_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed GX10/Obsidian brain preflight, recalled episodes, Halo Fire bid/design/fabrication/field sources, and required workflow guardrails must be sealed into the packet.'));
  }
  if (value.generation?.answerKeyUsed !== false || value.generation?.roomCandidateId !== 'a103-inclusive-plus-a151-cut-collinear-bridge-3') issues.push(issue('WG_SOURCE_BUILDING_ANSWER_KEY_LEAKAGE', 'Generation must remain source-only and use the visually gated room candidate.'));
  const model = value.model;
  if (!model || model.status !== 'passed' || model.artifactType !== 'halofire.orthogonal-gable-building-model.v1' || model.geometryGrounded !== true) issues.push(issue('WG_SOURCE_BUILDING_MODEL_INVALID', 'Passed source-grounded building model is required.'));
  const surfaces = Array.isArray(model?.surfaces) ? model.surfaces : [];
  const rooms = Array.isArray(model?.rooms) ? model.rooms : [];
  const features = Array.isArray(model?.features) ? model.features : [];
  if (rooms.length !== 56 || rooms.some((room) => !Array.isArray(room.poly) || room.poly.length < 4)) issues.push(issue('WG_SOURCE_BUILDING_ROOM_DRIFT', 'The source-only A103/A151 model must contain 56 traced room boundaries.'));
  if (surfaces.filter((surface) => surface.kind === 'pitched-roof').length !== 2
    || surfaces.filter((surface) => surface.kind === 'cross-gable-roof').length !== 8
    || surfaces.filter((surface) => surface.kind === 'low-roof-datum-plane').length !== 1) issues.push(issue('WG_SOURCE_BUILDING_ROOF_SURFACE_DRIFT', 'Two main planes, eight cross-gable planes, and one low-roof datum surface are required.'));
  if (features.length !== 1 || features[0].kind !== 'steeple' || !near(features[0].beamElevationFt, 128 + 8 / 12) || !near(features[0].topElevationFt, 155)) issues.push(issue('WG_SOURCE_BUILDING_STEEPLE_DRIFT', 'A121 steeple footprint and A201 128-8/155-0 datums are required.'));
  if (!near(model?.floorElevationFt, 100) || !near(model?.wallTopElevationFt, 111 + (6 + 5 / 16) / 12)
    || !near(model?.lowRoofElevationFt, 113) || !near(model?.mainRoof?.bearingElevationFt, 115 + 8 / 12)
    || !near(model?.mainRoof?.ridgeElevationFt, 125 + 11.5 / 12) || !near(model?.mainRoof?.pitchRiseIn, 4.5) || !near(model?.mainRoof?.pitchRunIn, 12)) issues.push(issue('WG_SOURCE_BUILDING_ELEVATION_DRIFT', 'A201/A301 floor, wall, low-roof, bearing, ridge, or pitch datum changed.'));
  if (model?.verification?.exactPitchReplay !== true || model?.verification?.crossGableResidualsFt?.some((entry) => entry.leftPitchResidual !== 0 || entry.rightPitchResidual !== 0)) issues.push(issue('WG_SOURCE_BUILDING_PITCH_REPLAY_FAILED', 'Every cross gable must replay the source 4.5:12 pitch exactly.'));
  if (value.geometryGrounded !== true || value.complianceReady !== false || value.fabricationReady !== false || model?.complianceReady !== false || model?.fabricationReady !== false) issues.push(issue('WG_SOURCE_BUILDING_FAIL_CLOSED_STATUS_DRIFT', 'Building geometry cannot claim sprinkler compliance or fabrication release.'));
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    packet: issues.length ? null : value,
    model: issues.length ? null : model,
    counts: { rooms: rooms.length, roofSurfaces: surfaces.length, pitchedRoofSurfaces: surfaces.filter((surface) => surface.kind !== 'low-roof-datum-plane').length, verticalFeatures: features.length },
    geometryGrounded: issues.length === 0,
    operationalKnowledgeGrounded: issues.length === 0,
    complianceReady: false,
    fabricationReady: false,
    claimStatus: value.claimStatus,
  };
}
