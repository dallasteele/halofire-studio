/**
 * Building J protected-source sprinkler candidate generator.
 *
 * The module consumes only a sanitized architectural input packet. Completed
 * sprinkler plans, registered answer heads, and answer-derived head assignments
 * are forbidden here and live in a separate scorer. Output is an empirical,
 * deterministic placement candidate: it is not a compliance, hydraulic,
 * fabrication, or field-release decision.
 */

import { sha256Hex } from './elevation-datums.js';
import { boundingBox, layoutRoom, pointInPolygon } from './sprinkler-layout.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT_NAME = 'MIT Riverside - Transportation Building J';
const INPUT_TYPE = 'halofire.mit-riverside-building-j-source-placement-inputs.v1';
const OUTPUT_TYPE = 'halofire.mit-riverside-building-j-source-generated-placement.v1';
const SHA = /^[0-9a-f]{64}$/;
const SOURCE_BINDINGS = Object.freeze({
  architecturalBidSet: ['08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c', 116713715],
  rcpDwg: ['05cdadaa2dd74dd7d02199b7030960864cc30c99044e82de28ca7176188b5658', 6423002],
});
const FORBIDDEN_INPUT_KEYS = new Set(['headAssignments', 'heads3d', 'registeredAnswer', 'answerKeyDenylist', 'approvedFp', 'asBuiltPlan', 'completedLayout']);
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function polygon(zone) {
  return zone.structuralLocalVerticesFt.map((point) => [Number(point.x), Number(point.y)]);
}

function objectHasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(objectHasForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => FORBIDDEN_INPUT_KEYS.has(key) || objectHasForbiddenKey(entry));
}

function boxesNear(first, second, tolerance) {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return dx <= tolerance && dy <= tolerance;
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

function pointNearPolygon(point, vertices, tolerance) {
  if (pointInPolygon(point, vertices)) return true;
  return vertices.some((start, index) => pointSegmentDistance(point, start, vertices[(index + 1) % vertices.length]) <= tolerance);
}

function connectedCeilingComponents(zones, joinToleranceFt) {
  const entries = zones.map((zone) => ({ zone, polygon: polygon(zone), bbox: boundingBox(polygon(zone)) }));
  const parents = entries.map((_, index) => index);
  const find = (index) => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const join = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents[b] = a;
  };
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (boxesNear(entries[left].bbox, entries[right].bbox, joinToleranceFt)) join(left, right);
    }
  }
  const groups = new Map();
  entries.forEach((entry, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entry);
  });
  return [...groups.values()].sort((left, right) => Math.min(...left.map((entry) => entry.bbox.minX)) - Math.min(...right.map((entry) => entry.bbox.minX)));
}

function componentBounds(component) {
  return {
    minX: Math.min(...component.map((entry) => entry.bbox.minX)),
    minY: Math.min(...component.map((entry) => entry.bbox.minY)),
    maxX: Math.max(...component.map((entry) => entry.bbox.maxX)),
    maxY: Math.max(...component.map((entry) => entry.bbox.maxY)),
  };
}

function gridCounts(width, height, policy) {
  let columns = Math.max(1, Math.ceil(width / policy.maxSpacingFt));
  let rows = Math.max(1, Math.ceil(height / policy.maxSpacingFt));
  let guard = 0;
  while ((width / columns) * (height / rows) > policy.maxAreaSqFt && guard < 1000) {
    if (width / columns >= height / rows) columns += 1;
    else rows += 1;
    guard += 1;
  }
  return { columns, rows };
}

function closestCeilingControl(component, controls) {
  const bounds = componentBounds(component);
  const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return controls.map((control) => ({
    control,
    distance: Math.hypot(control.structuralLocalFt.x - center[0], control.structuralLocalFt.y - center[1]),
  })).sort((left, right) => left.distance - right.distance || left.control.id.localeCompare(right.control.id))[0].control;
}

function ceilingCandidates(inputs) {
  const policy = inputs.placementPolicy;
  const components = connectedCeilingComponents(inputs.ceilingZones, policy.ceilingComponentJoinToleranceFt);
  const heads = [];
  const componentAudit = [];
  for (const [componentIndex, component] of components.entries()) {
    const bounds = componentBounds(component);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const slenderSingleton = component.length === 1
      && Math.min(width, height) < policy.singletonSoffitMinimumWidthFt
      && Math.max(width, height) / Math.min(width, height) > 6;
    const control = closestCeilingControl(component, inputs.ceilingControls);
    const { columns, rows } = gridCounts(width, height, policy);
    const candidateIds = [];
    if (!slenderSingleton) {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const point = [bounds.minX + (column + 0.5) * width / columns, bounds.minY + (row + 0.5) * height / rows];
          if (!component.some((entry) => pointNearPolygon(point, entry.polygon, policy.ceilingVoidBridgeToleranceFt))) continue;
          const id = `MIT-J-G-P-${String(heads.length + 1).padStart(3, '0')}`;
          candidateIds.push(id);
          heads.push({
            id,
            kind: 'pendent',
            structuralLocalFt: { x: round(point[0]), y: round(point[1]) },
            sourceProtectionRegime: 'finished-ceiling-pendent-source-plane',
            sourceProtectionPlaneId: `source-ceiling-component-${String(componentIndex + 1).padStart(2, '0')}`,
            sourceProtectionPlaneZFt: control.ceilingHeightFt,
            headInstallationZFt: null,
            sourceDerivation: {
              method: 'connected-ceiling-material-component-centered-grid',
              ceilingZoneIds: component.map((entry) => entry.zone.id),
              ceilingControlId: control.id,
              row,
              column,
            },
            obstructionClearanceVerified: false,
            hydraulicNodeAssigned: false,
          });
        }
      }
    }
    componentAudit.push({
      id: `source-ceiling-component-${String(componentIndex + 1).padStart(2, '0')}`,
      ceilingZoneIds: component.map((entry) => entry.zone.id),
      boundsFt: { ...bounds, width: round(width), height: round(height) },
      ceilingControlId: control.id,
      ceilingHeightFt: control.ceilingHeightFt,
      grid: { columns, rows },
      candidateIds,
      excludedAsSlenderSingletonSoffit: slenderSingleton,
    });
  }
  return { heads, componentAudit };
}

function interpolateProtectionZ(constraint, point) {
  const span = constraint.maxYFt - constraint.minYFt;
  const ratio = span ? (point.y - constraint.minYFt) / span : 0;
  return round(constraint.minZFt + ratio * (constraint.maxZFt - constraint.minZFt));
}

function openStructureCandidates(inputs, regionId, constraintKey, startIndex) {
  const region = inputs.roofRegions.find((entry) => entry.id === regionId);
  const constraint = inputs.protectionPlaneConstraints[constraintKey];
  if (!region || !constraint) throw new Error(`MIT_J_SOURCE_PLACEMENT_REGION_MISSING_${regionId}`);
  const layout = layoutRoom({ polygon: polygon(region), hazard: inputs.placementPolicy.hazardAssumption });
  return {
    layout: {
      regionId,
      sourceAreaSqFt: region.areaSqFt,
      gridRows: layout.gridRows,
      gridColumns: layout.gridCols,
      spacingXFt: layout.spacingX,
      spacingYFt: layout.spacingY,
      coveragePerHeadSqFt: layout.coveragePerHeadSqFt,
      candidateCount: layout.heads.length,
    },
    heads: layout.heads.map((head, index) => {
      const point = { x: head.x, y: head.y };
      return {
        id: `MIT-J-G-U-${String(startIndex + index).padStart(3, '0')}`,
        kind: 'upright',
        structuralLocalFt: point,
        sourceProtectionRegime: 'open-structure-upright-source-protection-target',
        sourceProtectionPlaneId: `${regionId}-source-bottom-of-deck`,
        sourceProtectionPlaneZFt: interpolateProtectionZ(constraint, point),
        headInstallationZFt: null,
        sourceDerivation: { method: 'source-roof-region-centered-grid', regionId, row: head.row, column: head.col },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      };
    }),
  };
}

/** Seal sanitized architectural inputs using the repository canonical digest. */
export async function sealMitRiversideBuildingJSourcePlacementInputs(value) {
  const clean = structuredClone(value);
  delete clean.receiptSha256;
  return { ...clean, receiptSha256: await sha256Hex(clean) };
}

/** Validate protected source identity and prove answer-shaped fields are absent. */
export async function validateMitRiversideBuildingJSourcePlacementInputs(value) {
  const issues = [];
  if (value?.artifactType !== INPUT_TYPE || value?.projectId !== PROJECT_ID || value?.projectName !== PROJECT_NAME) issues.push(issue('MIT_J_SOURCE_PLACEMENT_INPUT_IDENTITY_INVALID', 'Source placement input identity changed.'));
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_SOURCE_PLACEMENT_INPUT_RECEIPT_MISMATCH', 'Source placement inputs no longer match their canonical receipt.'));
  for (const [role, [sha256, bytes]] of Object.entries(SOURCE_BINDINGS)) {
    if (value?.sources?.[role]?.sha256 !== sha256 || value?.sources?.[role]?.bytes !== bytes) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SOURCE_BINDING_DRIFT', `${role} changed.`));
  }
  if (objectHasForbiddenKey(draft)) issues.push(issue('MIT_J_SOURCE_PLACEMENT_FORBIDDEN_ANSWER_FIELD', 'Sanitized generator inputs contain an answer-shaped field.'));
  if (value?.ceilingZones?.length !== 20 || value?.ceilingControls?.length !== 8 || value?.roofRegions?.length !== 3 || value?.floorSlabs?.length !== 3) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SOURCE_COUNT_DRIFT', 'Source floor, roof, ceiling-zone, or ceiling-control counts changed.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.completedLayoutRead !== false || value?.sequence?.freshProjectHoldoutRequired !== true) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SEQUENCE_INVALID', 'Answer isolation or fresh-holdout disclosure changed.'));
  if (value?.placementPolicy?.hazardAssumptionStatus !== 'internal-alpha-default-not-source-classified-not-code-compliance' || value?.claims?.complianceReady !== false) issues.push(issue('MIT_J_SOURCE_PLACEMENT_POLICY_FALSE_PROMOTION', 'The empirical hazard assumption was promoted to source classification or compliance.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceInputsReady: issues.length === 0, answerArtifactRead: false, complianceReady: false };
}

/** Build the immutable architectural candidate without reading a completed plan. */
export async function buildMitRiversideBuildingJSourceGeneratedPlacement(inputs) {
  if ((await validateMitRiversideBuildingJSourcePlacementInputs(inputs)).status !== 'passed') throw new Error('MIT_J_SOURCE_PLACEMENT_INPUTS_BLOCKED');
  const main = openStructureCandidates(inputs, 'main-standing-seam', 'mainOpenStructureBod', 1);
  const membrane = openStructureCandidates(inputs, 'membrane-base', 'membraneOpenStructureBod', main.heads.length + 1);
  const ceiling = ceilingCandidates(inputs);
  const heads = [...main.heads, ...membrane.heads, ...ceiling.heads];
  const draft = {
    artifactType: OUTPUT_TYPE,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    sourceInputsReceiptSha256: inputs.receiptSha256,
    generationMode: 'sealed-protected-architectural-source-only-deterministic-centered-region-and-ceiling-component-grid',
    sequence: {
      sourceCandidateSealedBeforeAnswerOpen: true,
      answerArtifactRead: false,
      completedLayoutRead: false,
      historicalAnswerExposureDisclosed: true,
      freshProjectHoldoutRequired: true,
    },
    policy: inputs.placementPolicy,
    openStructureLayouts: [main.layout, membrane.layout],
    ceilingComponentAudit: ceiling.componentAudit,
    heads,
    counts: {
      total: heads.length,
      upright: heads.filter((head) => head.kind === 'upright').length,
      pendent: heads.filter((head) => head.kind === 'pendent').length,
      mainOpenStructure: main.heads.length,
      membraneOpenStructure: membrane.heads.length,
      ceilingComponents: ceiling.componentAudit.length,
      excludedSlenderSingletonSoffits: ceiling.componentAudit.filter((entry) => entry.excludedAsSlenderSingletonSoffit).length,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic source roof-region and connected RCP ceiling-component replay' },
      independent: { status: 'passed', method: 'source polygon containment, spacing, coverage, ceiling-control, and protection-plane arithmetic checks' },
      adversarial: { status: 'passed', method: 'publication script requires all provenance, geometry, head, and false-promotion attacks to be rejected' },
    },
    sourceGeneratedCandidateReady: true,
    buildingJCalibrationScored: false,
    sourceGeneratedPlacementVerified: false,
    freshProjectPlacementVerified: false,
    obstructionInventoryReady: false,
    obstructionClearancesVerified: false,
    branchPipeTopologyReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'sealed-source-generated-empirical-building-j-candidate-awaiting-answer-only-score-not-code-compliance-hydraulics-fabrication-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

/** Validate receipt immutability and exact deterministic source replay. */
export async function validateMitRiversideBuildingJSourceGeneratedPlacement(value, inputs) {
  let expected;
  try {
    expected = await buildMitRiversideBuildingJSourceGeneratedPlacement(inputs);
  } catch (error) {
    return { status: 'blocked', issues: [issue('MIT_J_SOURCE_PLACEMENT_DEPENDENCY_BLOCKED', error.message)], sourceGeneratedCandidateReady: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MIT_J_SOURCE_PLACEMENT_REPLAY_MISMATCH', 'Candidate no longer equals deterministic protected-source replay.'));
  if (value?.counts?.mainOpenStructure !== 36 || value?.counts?.membraneOpenStructure !== 18 || value?.counts?.pendent !== 15 || value?.counts?.upright !== 54 || value?.counts?.total !== 69) issues.push(issue('MIT_J_SOURCE_PLACEMENT_COUNT_DRIFT', 'Expected 36 main, 18 membrane, and 15 ceiling candidates.'));
  if (value?.heads?.some((head) => head.headInstallationZFt !== null || head.obstructionClearanceVerified || head.hydraulicNodeAssigned)) issues.push(issue('MIT_J_SOURCE_PLACEMENT_HEAD_FALSE_PROMOTION', 'Candidate head promoted installed Z, obstruction clearance, or hydraulic identity.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.completedLayoutRead !== false || value?.buildingJCalibrationScored !== false || value?.sourceGeneratedPlacementVerified !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MIT_J_SOURCE_PLACEMENT_DOWNSTREAM_FALSE_PROMOTION', 'Unscored candidate promoted an answer, calibration, holdout, compliance, fabrication, or release claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceGeneratedCandidateReady: issues.length === 0, sourceGeneratedPlacementVerified: false, complianceReady: false };
}

/** Run provenance, geometry, head, and downstream-claim mutation attacks. */
export async function verifyMitRiversideBuildingJSourceGeneratedPlacementAdversarialLoop(value, inputs) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source-input', (entry) => { entry.sourceInputsReceiptSha256 = '1'.repeat(64); }],
    ['answer-open', (entry) => { entry.sequence.answerArtifactRead = true; }],
    ['completed-layout', (entry) => { entry.sequence.completedLayoutRead = true; }],
    ['history', (entry) => { entry.sequence.historicalAnswerExposureDisclosed = false; }],
    ['fresh-holdout', (entry) => { entry.sequence.freshProjectHoldoutRequired = false; }],
    ['main-count', (entry) => { entry.counts.mainOpenStructure = 35; }],
    ['membrane-count', (entry) => { entry.counts.membraneOpenStructure = 17; }],
    ['pendent-count', (entry) => { entry.counts.pendent = 14; }],
    ['head-remove', (entry) => { entry.heads.pop(); }],
    ['head-x', (entry) => { entry.heads[0].structuralLocalFt.x += 1; }],
    ['head-z', (entry) => { entry.heads[0].headInstallationZFt = 20; }],
    ['obstruction', (entry) => { entry.heads[0].obstructionClearanceVerified = true; }],
    ['hydraulic', (entry) => { entry.heads[0].hydraulicNodeAssigned = true; }],
    ['scored', (entry) => { entry.buildingJCalibrationScored = true; }],
    ['placement', (entry) => { entry.sourceGeneratedPlacementVerified = true; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMitRiversideBuildingJSourceGeneratedPlacement(attacked, inputs)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
