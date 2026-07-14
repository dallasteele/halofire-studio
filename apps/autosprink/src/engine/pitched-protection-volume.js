import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const MODES = new Set(['sealed-source-only', 'answer-exposed-calibration']);
const KINDS = new Set([
  'occupied-room-label',
  'sloped-ceiling-label',
  'flat-ceiling-label',
  'ceiling-is-roof-deck',
  'roof-ceiling-separation',
  'attic-label',
  'attic-access',
  'roof-framing-cavity',
  'attic-protection-note',
]);
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealPitchedProtectionVolumeEvidence(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedProtectionVolumeEvidence(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.pitched-protection-volume-evidence.v1'
    || typeof value.projectId !== 'string' || !value.projectId
    || typeof value.scopeId !== 'string' || !value.scopeId || !MODES.has(value.mode)) {
    return { status: 'blocked', issues: [issue('PITCHED_VOLUME_SCHEMA_INVALID', 'Protection-volume evidence identity, scope, or mode is invalid.')] };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) {
    issues.push(issue('PITCHED_VOLUME_RECEIPT_MISMATCH', 'Protection-volume evidence no longer matches its immutable receipt.'));
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    issues.push(issue('PITCHED_VOLUME_EVIDENCE_MISSING', 'At least one source-bound protection-volume observation is required.'));
  } else {
    const ids = new Set();
    for (const entry of value.evidence) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
        || entry.scopeId !== value.scopeId || !KINDS.has(entry.kind)
        || typeof entry.sourceRole !== 'string' || !entry.sourceRole
        || !SHA.test(entry.sourceSha256 || '') || typeof entry.sheetId !== 'string' || !entry.sheetId
        || typeof entry.assertion !== 'string' || !entry.assertion) {
        issues.push(issue('PITCHED_VOLUME_EVIDENCE_INVALID', 'Every observation needs a unique id, matching scope, allowed kind, source hash, sheet, role, and assertion.'));
        break;
      }
      ids.add(entry.id);
    }
  }
  const answerRoles = value.evidence?.filter((entry) => entry.sourceRole === 'completed-sprinkler-answer') || [];
  if (value.mode === 'sealed-source-only'
    && (value.sequence?.answerKeyOpened !== false || value.sequence?.completedBidUsedForDecision !== false || answerRoles.length > 0)) {
    issues.push(issue('PITCHED_VOLUME_ANSWER_LEAKAGE', 'A sealed source-only decision cannot use or acknowledge a completed sprinkler answer.'));
  }
  if (value.mode === 'answer-exposed-calibration'
    && (value.sequence?.answerKeyOpened !== true || value.sequence?.completedBidUsedForDecision !== true || answerRoles.length === 0)) {
    issues.push(issue('PITCHED_VOLUME_CALIBRATION_DISCLOSURE_MISSING', 'Answer-exposed calibration must disclose answer use and bind at least one completed-answer observation.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues };
}

export async function classifyPitchedProtectionVolume(value) {
  const validation = await validatePitchedProtectionVolumeEvidence(value);
  if (validation.status !== 'passed') {
    return {
      status: 'blocked',
      issues: validation.issues,
      classification: 'unresolved',
      classificationRoutingReady: false,
      productionPlacementEligible: false,
      complianceReady: false,
    };
  }
  const byKind = new Map();
  for (const entry of value.evidence) {
    if (!byKind.has(entry.kind)) byKind.set(entry.kind, []);
    byKind.get(entry.kind).push(entry.id);
  }
  const has = (kind) => byKind.has(kind);
  const roofContradiction = has('ceiling-is-roof-deck') && has('roof-ceiling-separation');
  const occupiedReady = has('occupied-room-label') && has('sloped-ceiling-label') && has('ceiling-is-roof-deck');
  const flatOccupiedReady = has('occupied-room-label') && has('flat-ceiling-label') && has('roof-ceiling-separation');
  const explicitAtticProtection = has('attic-protection-note');
  const atticCavityReady = has('roof-ceiling-separation') && (has('attic-label') || has('attic-access') || has('roof-framing-cavity'));
  let classification = 'unresolved';
  if (!roofContradiction) {
    if (flatOccupiedReady && explicitAtticProtection) classification = 'dual-zone';
    else if (explicitAtticProtection) classification = 'pitched-attic';
    else if (flatOccupiedReady) classification = 'pitched-roof-over-flat-occupied-ceiling';
    else if (occupiedReady) classification = 'occupied-sloped-ceiling';
  }
  const classificationRoutingReady = classification !== 'unresolved';
  const answerExposed = value.mode === 'answer-exposed-calibration';
  const placementEngineRoute = classification === 'pitched-roof-over-flat-occupied-ceiling' ? 'flat-ceiling-layout'
    : classification === 'occupied-sloped-ceiling' ? 'sloped-ceiling-layout'
      : classification === 'pitched-attic' ? 'pitched-attic-layout'
        : classification === 'dual-zone' ? 'flat-ceiling-and-pitched-attic-layouts'
          : null;
  const pitchedSurfacePlacementEligible = classificationRoutingReady
    && classification !== 'pitched-roof-over-flat-occupied-ceiling' && !answerExposed;
  const blockers = [];
  if (roofContradiction) blockers.push('contradictory-roof-cavity-evidence');
  if (atticCavityReady && !explicitAtticProtection) blockers.push('attic-cavity-does-not-prove-attic-protection');
  if (!classificationRoutingReady) blockers.push('protection-volume-unresolved');
  if (classification === 'pitched-roof-over-flat-occupied-ceiling') blockers.push('pitched-roof-not-occupied-protection-surface', 'flat-ceiling-layout-not-generated');
  if (answerExposed) blockers.push('answer-exposed-calibration-not-fresh-production-evidence');
  blockers.push('head-type-and-temperature-selection-unresolved', 'per-head-obstruction-clearance-unresolved', 'hydraulic-calculation-unresolved');
  return {
    status: classificationRoutingReady ? 'passed' : 'blocked',
    issues: roofContradiction ? [issue('PITCHED_VOLUME_ROOF_CONTRADICTION', 'The same scope cannot both terminate at the roof deck and contain a separate roof cavity.')] : [],
    artifactType: 'halofire.pitched-protection-volume-decision.v1',
    projectId: value.projectId,
    scopeId: value.scopeId,
    evidenceReceiptSha256: value.receiptSha256,
    mode: value.mode,
    classification,
    classificationRoutingReady,
    placementEngineRoute,
    atticCavityDetected: atticCavityReady,
    atticProtectionEstablished: explicitAtticProtection,
    pitchedSurfacePlacementEligible,
    productionPlacementEligible: pitchedSurfacePlacementEligible,
    answerExposed,
    resolvedEvidenceIds: classificationRoutingReady ? [...new Set([
      ...(byKind.get('occupied-room-label') || []),
      ...(byKind.get('sloped-ceiling-label') || []),
      ...(byKind.get('flat-ceiling-label') || []),
      ...(byKind.get('ceiling-is-roof-deck') || []),
      ...(byKind.get('roof-ceiling-separation') || []),
      ...(byKind.get('attic-label') || []),
      ...(byKind.get('attic-access') || []),
      ...(byKind.get('roof-framing-cavity') || []),
      ...(byKind.get('attic-protection-note') || []),
    ])] : [],
    headTypeSelectionReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    blockers,
  };
}

export async function verifyPitchedProtectionVolumeAdversarialLoop(sourcePacket) {
  const cases = [
    ['drop-room', (value) => { value.evidence = value.evidence.filter((entry) => entry.kind !== 'occupied-room-label'); }],
    ['drop-ceiling', (value) => { value.evidence = value.evidence.filter((entry) => entry.kind !== 'sloped-ceiling-label'); }],
    ['drop-deck', (value) => { value.evidence = value.evidence.filter((entry) => entry.kind !== 'ceiling-is-roof-deck'); }],
    ['contradictory-cavity', (value) => { value.evidence.push({ ...value.evidence[0], id: 'mutated-cavity', kind: 'roof-ceiling-separation' }); }],
    ['answer-leak', (value) => { value.sequence.answerKeyOpened = true; }],
    ['completed-answer-role', (value) => { value.evidence[0].sourceRole = 'completed-sprinkler-answer'; }],
    ['scope-drift', (value) => { value.evidence[0].scopeId = 'another-scope'; }],
    ['source-hash-drift', (value) => { value.evidence[0].sourceSha256 = 'x'.repeat(64); }],
    ['cavity-only-no-protection', (value) => {
      value.evidence = [
        { ...value.evidence[0], id: 'mutated-separation', kind: 'roof-ceiling-separation' },
        { ...value.evidence[1], id: 'mutated-attic-access', kind: 'attic-access' },
      ];
    }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) {
    const changed = structuredClone(sourcePacket);
    mutate(changed);
    const decision = await classifyPitchedProtectionVolume(await sealPitchedProtectionVolumeEvidence(changed));
    if (decision.status === 'blocked' || decision.productionPlacementEligible === false) rejectedCases.push(name);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}
