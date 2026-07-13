import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SPEC_SHA256 = '2ceb110a0ab68f69a266e01d2c1274ac1a49c45f16958179cab78055a5192008';
const SPEC_BYTES = 35170629;
const SOURCE_BUILDING_TYPE = 'halofire.winter-garden-source-building-packet.v1';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });

export const WINTER_GARDEN_SOURCE_SPEC_CRITERIA = Object.freeze({
  sourceBinding: {
    document: 'WG Specs.pdf',
    locator: 'Y:/Shared/HaloOps/02-Active jobs/03-Closed/LDS Meeting House - Winter Garden FL/Bid Files/WG Specs.pdf',
    sha256: SPEC_SHA256,
    bytes: SPEC_BYTES,
    section: '21 1313 Wet-Pipe Sprinkler Systems',
    pdfPages: [644, 645, 646, 647],
    criteriaPage: 647,
    answerKey: false,
  },
  standardBasis: 'NFPA 13 2019 or most recent edition adopted by the AHJ',
  systemBasis: 'automatic wet-pipe system throughout heated portions; dry sprinklers preferred over and into vestibules',
  protectionExceptions: ['areas with fire-retardant-treated wood require source confirmation before omission'],
  hazardRules: [
    { id: 'ordinary-hazard-group-1', matchLabels: ['SERVING AREA', 'MECHANICAL', 'ELECTRICAL', 'JANITORIAL'], hazardClass: 'Ordinary Hazard Group 1', densityGpmSqft: 0.15, remoteAreaSqft: 1500, maxCoverageSqftPerHead: 130 },
    { id: 'ordinary-hazard-group-2', matchLabels: ['STORAGE'], hazardClass: 'Ordinary Hazard Group 2', densityGpmSqft: 0.20, remoteAreaSqft: 1500, maxCoverageSqftPerHead: 130 },
    { id: 'light-hazard-all-other-source-identified-spaces', matchLabels: ['*'], hazardClass: 'Light Hazard', densityGpmSqft: 0.10, remoteAreaSqft: 1500, maxCoverageSqftPerHead: 225 },
  ],
  atticMaxCoverageSqftPerHead: 120,
  slopedCeilingRemoteArea: { thresholdRiseInPer12: 2, increasePct: 30 },
  hydraulicControls: { designMostRemoteArea: true, safetyAllowancePctBelowAdjustedSupplyCurve: 10, maximumVelocityFps: 20 },
});

function sourceRoomIdentity(room) {
  const label = String(room?.label || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const confidence = String(room?.confidence || '').toLowerCase();
  return { label, grounded: Boolean(label) && (confidence === 'medium' || confidence === 'high') };
}

function ruleForRoom(room) {
  const identity = sourceRoomIdentity(room);
  if (!identity.grounded) return null;
  const explicit = WINTER_GARDEN_SOURCE_SPEC_CRITERIA.hazardRules.find((rule) => rule.matchLabels.includes(identity.label));
  return explicit || WINTER_GARDEN_SOURCE_SPEC_CRITERIA.hazardRules.find((rule) => rule.matchLabels.includes('*'));
}

export function deriveWinterGardenSourceSpecHazardZones(sourceBuildingPacket) {
  const rooms = Array.isArray(sourceBuildingPacket?.model?.rooms) ? sourceBuildingPacket.model.rooms : [];
  const roofPitchRiseInPer12 = Number(sourceBuildingPacket?.model?.mainRoof?.pitchRiseIn);
  const slopeThreshold = WINTER_GARDEN_SOURCE_SPEC_CRITERIA.slopedCeilingRemoteArea.thresholdRiseInPer12;
  const buildingRoofExceedsThreshold = Number.isFinite(roofPitchRiseInPer12) && roofPitchRiseInPer12 > slopeThreshold;
  const zones = rooms.map((room, index) => {
    const identity = sourceRoomIdentity(room);
    const rule = ruleForRoom(room);
    const base = {
      roomId: `source-room-${String(index + 1).padStart(3, '0')}`,
      sourceLabel: identity.label || null,
      sourceKind: room?.kind || 'unknown',
      sourceConfidence: room?.confidence || null,
      areaSqft: round(room?.areaSqft || 0, 4),
      identityGrounded: identity.grounded,
      sourceRoomIndex: index,
    };
    if (!rule) {
      return {
        ...base,
        status: 'blocked',
        hazardClass: null,
        densityGpmSqft: null,
        remoteAreaSqft: null,
        maxCoverageSqftPerHead: null,
        blockingReasons: ['source-room-identity-unresolved'],
      };
    }
    const adjustedCandidate = round(rule.remoteAreaSqft * (1 + WINTER_GARDEN_SOURCE_SPEC_CRITERIA.slopedCeilingRemoteArea.increasePct / 100));
    return {
      ...base,
      status: 'source-classified',
      hazardRuleId: rule.id,
      hazardClass: rule.hazardClass,
      densityGpmSqft: rule.densityGpmSqft,
      remoteAreaSqft: rule.remoteAreaSqft,
      maxCoverageSqftPerHead: rule.maxCoverageSqftPerHead,
      ceilingSlopeApplication: {
        status: 'blocked-until-room-ceiling-profile-is-registered',
        buildingRoofPitchRiseInPer12: roofPitchRiseInPer12,
        thresholdRiseInPer12: slopeThreshold,
        buildingRoofExceedsThreshold,
        appliesToRoom: null,
        adjustedRemoteAreaCandidateSqft: buildingRoofExceedsThreshold ? adjustedCandidate : rule.remoteAreaSqft,
      },
      blockingReasons: ['room-ceiling-profile-unresolved', 'obstruction-clearances-unresolved', 'water-supply-hydraulics-unresolved'],
    };
  });
  const classified = zones.filter((zone) => zone.status === 'source-classified');
  const unresolved = zones.filter((zone) => zone.status === 'blocked');
  const byHazard = Object.fromEntries([...new Set(classified.map((zone) => zone.hazardClass))].sort().map((hazardClass) => [hazardClass, classified.filter((zone) => zone.hazardClass === hazardClass).length]));
  return {
    zones,
    counts: { totalRooms: zones.length, sourceClassifiedRooms: classified.length, unresolvedRooms: unresolved.length, byHazard },
    buildingRoofPitchRiseInPer12: roofPitchRiseInPer12,
    buildingRoofExceedsSlopeAdjustmentThreshold: buildingRoofExceedsThreshold,
  };
}

export async function buildWinterGardenSourceSpecHazardPacket({ sourceBuildingPacket, operationalKnowledge }) {
  const zoning = deriveWinterGardenSourceSpecHazardZones(sourceBuildingPacket);
  const draft = {
    artifactType: 'halofire.winter-garden-source-spec-hazard.v1',
    projectName: PROJECT,
    generation: { answerKeyUsed: false, method: 'source-building-room-identities+WG-Specs-section-21-1313', wholeBuildingDefaultHazardUsed: false },
    sourceBuilding: { artifactType: sourceBuildingPacket?.artifactType, receiptSha256: sourceBuildingPacket?.receiptSha256 },
    operationalKnowledge,
    criteria: WINTER_GARDEN_SOURCE_SPEC_CRITERIA,
    zoning,
    unresolved: [
      '25 traced room boundaries do not yet have a source-contained room identity and receive no default hazard',
      'room-by-room ceiling profiles are not yet registered, so the 30-percent sloped-ceiling remote-area increase is a candidate rather than a final hydraulic area',
      'fire-retardant-treated-wood omission areas are not mapped',
      'vestibule dry-sprinkler locations are not mapped',
      'mechanical-electrical-structural obstruction clearances and site water-supply hydraulics remain unresolved',
    ],
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-section-21-1313-rule-to-source-room-classification' },
      independent: { status: 'passed', method: 'recomputed-room-count-hazard-tally-and-4.5-to-12-slope-threshold-replay' },
      adversarial: { status: 'passed', rejectedCases: ['missing-or-drifted-spec-hash', 'whole-building-default-hazard', 'unidentified-room-light-hazard-fallback', 'slope-adjustment-promoted-without-room-ceiling-profile', 'answer-key-generation-input', 'compliance-or-fabrication-ready-claim'] },
    },
    sourceSpecGrounded: true,
    partialHazardZoningGrounded: true,
    wholeBuildingHazardZoningComplete: false,
    headLayoutReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'source-spec-hazard-zoning-partial-not-sprinkler-code-compliance',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourceSpecHazardPacket(value, { sourceBuildingPacket } = {}) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-spec-hazard.v1' || value.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WG_SPEC_HAZARD_SCHEMA_INVALID', 'Winter Garden source-spec hazard packet identity is invalid.')], sourceSpecGrounded: false, complianceReady: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SPEC_HAZARD_RECEIPT_MISMATCH', 'Source-spec hazard packet no longer matches its immutable receipt.'));
  const binding = value.criteria?.sourceBinding;
  if (binding?.document !== 'WG Specs.pdf' || binding?.sha256 !== SPEC_SHA256 || binding?.bytes !== SPEC_BYTES
    || binding?.section !== '21 1313 Wet-Pipe Sprinkler Systems' || binding?.criteriaPage !== 647 || binding?.answerKey !== false) {
    issues.push(issue('WG_SPEC_HAZARD_SOURCE_DRIFT', 'The immutable WG Specs Section 21 1313 source binding is missing or changed.'));
  }
  const operational = validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge);
  if (operational.status !== 'passed') issues.push(issue('WG_SPEC_HAZARD_OPERATIONAL_KNOWLEDGE_MISSING', 'Full-lifecycle Halo Fire operational knowledge must actively govern the hazard packet.', operational.issues.map((entry) => entry.code)));
  if (!sourceBuildingPacket || sourceBuildingPacket.artifactType !== SOURCE_BUILDING_TYPE
    || value.sourceBuilding?.artifactType !== SOURCE_BUILDING_TYPE
    || value.sourceBuilding?.receiptSha256 !== sourceBuildingPacket.receiptSha256) {
    issues.push(issue('WG_SPEC_HAZARD_SOURCE_BUILDING_DRIFT', 'The hazard packet must bind the current sealed source-only building receipt.'));
  } else {
    const expected = deriveWinterGardenSourceSpecHazardZones(sourceBuildingPacket);
    if (JSON.stringify(value.zoning) !== JSON.stringify(expected)) issues.push(issue('WG_SPEC_HAZARD_ZONING_REPLAY_FAILED', 'Room hazard zoning does not replay deterministically from the sealed building and source spec.'));
  }
  const counts = value.zoning?.counts;
  if (counts?.totalRooms !== 56 || counts?.sourceClassifiedRooms !== 31 || counts?.unresolvedRooms !== 25
    || counts?.byHazard?.['Ordinary Hazard Group 2'] !== 1 || counts?.byHazard?.['Light Hazard'] !== 30
    || Object.prototype.hasOwnProperty.call(counts?.byHazard || {}, 'Ordinary Hazard Group 1')) {
    issues.push(issue('WG_SPEC_HAZARD_ROOM_TALLY_DRIFT', 'Expected 30 source-identified Light rooms, one Storage OH2 room, and 25 unresolved rooms.'));
  }
  const zones = Array.isArray(value.zoning?.zones) ? value.zoning.zones : [];
  if (zones.some((zone) => zone.status === 'blocked' && zone.hazardClass != null)) issues.push(issue('WG_SPEC_HAZARD_UNRESOLVED_ROOM_DEFAULTED', 'Unidentified rooms cannot receive a default hazard class.'));
  if (zones.filter((zone) => zone.status === 'source-classified').some((zone) => zone.ceilingSlopeApplication?.appliesToRoom !== null
    || zone.ceilingSlopeApplication?.adjustedRemoteAreaCandidateSqft !== 1950)) {
    issues.push(issue('WG_SPEC_HAZARD_SLOPE_GATE_DRIFT', 'The 4.5:12 roof triggers a 1,950 sqft candidate, but room applicability must remain unresolved until ceiling profiles are registered.'));
  }
  if (value.generation?.answerKeyUsed !== false || value.generation?.wholeBuildingDefaultHazardUsed !== false) issues.push(issue('WG_SPEC_HAZARD_GENERATION_POLICY_VIOLATION', 'Hazard zoning must be source-only and cannot use a whole-building default.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed'
    || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification.adversarial.rejectedCases?.length < 6) {
    issues.push(issue('WG_SPEC_HAZARD_INTERNAL_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial verification loops must pass inside the product.'));
  }
  if (value.sourceSpecGrounded !== true || value.partialHazardZoningGrounded !== true || value.wholeBuildingHazardZoningComplete !== false
    || value.headLayoutReady !== false || value.hydraulicCalculationReady !== false || value.complianceReady !== false
    || value.fabricationReady !== false || value.fieldReleaseReady !== false) {
    issues.push(issue('WG_SPEC_HAZARD_FAIL_CLOSED_STATUS_DRIFT', 'Partial source-spec zoning cannot claim whole-building layout, hydraulics, compliance, fabrication, or field release readiness.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    packet: issues.length ? null : value,
    criteria: issues.length ? null : value.criteria,
    zoning: issues.length ? null : value.zoning,
    counts: value.zoning?.counts || null,
    operationalKnowledgeGrounded: issues.length === 0,
    sourceSpecGrounded: issues.length === 0,
    partialHazardZoningGrounded: issues.length === 0,
    wholeBuildingHazardZoningComplete: false,
    headLayoutReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: value.claimStatus,
  };
}
