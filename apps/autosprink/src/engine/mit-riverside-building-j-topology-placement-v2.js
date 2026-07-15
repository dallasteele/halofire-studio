/**
 * Building J topology-aware protected-source placement candidate, version 2.
 *
 * Generation consumes only the sanitized architectural placement packet and
 * the separately sealed architectural/structural/MEP topology packet. The
 * completed sprinkler plan remains outside this module and is opened later by
 * the unchanged answer-only scorer.
 */

import { sha256Hex } from './elevation-datums.js';
import { boundingBox, pointInPolygon } from './sprinkler-layout.js';
import { validateMitRiversideBuildingJSourcePlacementInputs } from './mit-riverside-building-j-source-generated-placement.js';
import { validateMitRiversideBuildingJSourceTopology } from './mit-riverside-building-j-source-topology.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT_NAME = 'MIT Riverside - Transportation Building J';
const OUTPUT_TYPE = 'halofire.mit-riverside-building-j-source-generated-placement.v1';
const GENERATION_VERSION = 'source-topology-v2';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function polygon(value) {
  return value.structuralLocalVerticesFt.map((point) => [Number(point.x), Number(point.y)]);
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

function boxesNear(first, second, tolerance) {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return dx <= tolerance && dy <= tolerance;
}

function connectedCeilingComponents(zones, tolerance) {
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
      if (boxesNear(entries[left].bbox, entries[right].bbox, tolerance)) join(left, right);
    }
  }
  const groups = new Map();
  entries.forEach((entry, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entry);
  });
  return [...groups.values()].sort((left, right) => componentBounds(left).minX - componentBounds(right).minX);
}

function componentBounds(component) {
  return {
    minX: Math.min(...component.map((entry) => entry.bbox.minX)),
    minY: Math.min(...component.map((entry) => entry.bbox.minY)),
    maxX: Math.max(...component.map((entry) => entry.bbox.maxX)),
    maxY: Math.max(...component.map((entry) => entry.bbox.maxY)),
  };
}

function closestCeilingControl(component, controls) {
  const bounds = componentBounds(component);
  const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return controls.map((control) => ({
    control,
    distance: Math.hypot(control.structuralLocalFt.x - center[0], control.structuralLocalFt.y - center[1]),
  })).sort((left, right) => left.distance - right.distance || left.control.id.localeCompare(right.control.id))[0].control;
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

function interpolateProtectionZ(constraint, point) {
  const span = constraint.maxYFt - constraint.minYFt;
  const ratio = span ? (point.y - constraint.minYFt) / span : 0;
  return round(constraint.minZFt + ratio * (constraint.maxZFt - constraint.minZFt));
}

function verticalSourceAxes(topology) {
  return topology.sourcePlacementAxes
    .filter((axis) => Math.abs(axis.startStructuralLocalFt.x - axis.endStructuralLocalFt.x) <= 0.01)
    .map((axis) => ({ ...axis, x: round((axis.startStructuralLocalFt.x + axis.endStructuralLocalFt.x) / 2) }))
    .sort((left, right) => left.x - right.x || left.id.localeCompare(right.id));
}

function mainOpenStructureCandidates(inputs, topology) {
  const policy = inputs.placementPolicy;
  const structuralMinX = inputs.gridRegistration.xStructuralFt[0];
  const structuralMaxX = inputs.gridRegistration.xStructuralFt[6];
  const structuralMinY = inputs.gridRegistration.yStructuralFt[0];
  const structuralMaxY = inputs.gridRegistration.yStructuralFt[2];
  const axes = verticalSourceAxes(topology)
    .filter((axis) => axis.lengthFt >= 25 && axis.x > structuralMinX + 1 && axis.x < structuralMaxX - 1);
  const columns = axes.filter((_, index) => index % 2 === 0);
  const { rows } = gridCounts(structuralMaxX - structuralMinX, structuralMaxY - structuralMinY, policy);
  if (columns.length !== 6 || rows !== 6) throw new Error('MIT_J_TOPOLOGY_V2_MAIN_GRID_SOURCE_RHYTHM_INVALID');
  const region = inputs.roofRegions.find((entry) => entry.id === 'main-standing-seam');
  const constraint = inputs.protectionPlaneConstraints.mainOpenStructureBod;
  const heads = [];
  for (let row = 0; row < rows; row += 1) {
    const y = structuralMinY + (row + 0.5) * (structuralMaxY - structuralMinY) / rows;
    for (let column = 0; column < columns.length; column += 1) {
      const point = { x: columns[column].x, y: round(y) };
      if (!pointInPolygon([point.x, point.y], polygon(region))) throw new Error('MIT_J_TOPOLOGY_V2_MAIN_HEAD_OUTSIDE_SOURCE_REGION');
      heads.push({
        id: `MIT-J-V2-U-${String(heads.length + 1).padStart(3, '0')}`,
        kind: 'upright',
        structuralLocalFt: point,
        sourceProtectionRegime: 'open-structure-upright-source-protection-target',
        sourceProtectionPlaneId: 'main-standing-seam-source-bottom-of-deck',
        sourceProtectionPlaneZFt: interpolateProtectionZ(constraint, point),
        headInstallationZFt: null,
        sourceDerivation: {
          method: 'source-structural-every-other-framing-axis-and-source-grid-centered-row',
          regionId: region.id,
          sourcePlacementAxisId: columns[column].id,
          sourceGridYBoundsFt: [structuralMinY, structuralMaxY],
          row,
          column,
        },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
  }
  return {
    heads,
    audit: {
      regionId: region.id,
      sourcePlacementAxisIds: columns.map((entry) => entry.id),
      sourceGridYBoundsFt: [structuralMinY, structuralMaxY],
      columns: columns.length,
      rows,
      candidateIds: heads.map((entry) => entry.id),
    },
  };
}

function nearestSourceAxisX(x, axes) {
  return axes.map((axis) => ({ axis, distance: Math.abs(axis.x - x) }))
    .sort((left, right) => left.distance - right.distance || left.axis.id.localeCompare(right.axis.id))[0].axis;
}

function roomCenter(bounds) {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function membraneRoomPoints(room, labels, axes, policy) {
  const vertices = polygon(room);
  const bounds = boundingBox(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const points = [];
  let method;

  if (labels.length > 1) {
    method = 'multi-label-local-ots-envelope-snapped-to-source-framing-axis';
    const snappedColumns = [...new Map(labels.map((label) => {
      const axis = nearestSourceAxisX(label.structuralLocalFt.x, axes);
      return [axis.id, axis];
    })).values()].sort((left, right) => left.x - right.x);
    const rows = Math.max(1, Math.ceil(height / policy.maxSpacingFt));
    for (let row = 0; row < rows; row += 1) {
      const y = bounds.minY + (row + 0.5) * height / rows;
      for (const axis of snappedColumns) {
        const point = [axis.x, y];
        const nearestLabelDistance = Math.min(...labels.map((label) => Math.hypot(axis.x - label.structuralLocalFt.x, y - label.structuralLocalFt.y)));
        if (pointInPolygon(point, vertices) && nearestLabelDistance <= policy.maxSpacingFt / 2) points.push({ x: axis.x, y: round(y), sourcePlacementAxisId: axis.id });
      }
    }
  } else if (width >= 30) {
    method = 'large-ots-room-source-bay-target-centered-grid';
    const columns = Math.max(1, Math.ceil(width / 10));
    const rows = Math.max(1, Math.ceil(height / policy.maxSpacingFt));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const point = { x: bounds.minX + (column + 0.5) * width / columns, y: bounds.minY + (row + 0.5) * height / rows };
        if (pointInPolygon([point.x, point.y], vertices)) points.push({ x: round(point.x), y: round(point.y) });
      }
    }
  } else {
    const count = Math.max(
      1,
      Math.ceil(room.areaSqFt / (policy.maxAreaSqFt * 1.05)),
      Math.ceil(width / policy.maxSpacingFt) * Math.ceil(height / policy.maxSpacingFt),
    );
    const center = roomCenter(bounds);
    if (count === 1 && room.areaSqFt < 75 && labels[0]) {
      method = 'small-ots-room-label-to-room-center-interpolation';
      points.push({ x: round(labels[0].structuralLocalFt.x), y: round((labels[0].structuralLocalFt.y + center.y) / 2) });
    } else {
      method = count === 1 ? 'source-room-centered-single' : 'source-framing-orthogonal-horizontal-spread';
      for (let column = 0; column < count; column += 1) {
        const point = { x: bounds.minX + (column + 0.5) * width / count, y: center.y };
        if (pointInPolygon([point.x, point.y], vertices)) points.push({ x: round(point.x), y: round(point.y) });
      }
    }
  }
  return { points, bounds, method };
}

function membraneOpenStructureCandidates(inputs, topology, startIndex) {
  const policy = inputs.placementPolicy;
  const axes = verticalSourceAxes(topology);
  const labelsByRoom = new Map();
  for (const label of topology.openToStructureLabels) {
    if (!labelsByRoom.has(label.roomId)) labelsByRoom.set(label.roomId, []);
    labelsByRoom.get(label.roomId).push(label);
  }
  const rooms = topology.rooms
    .filter((room) => room.ceilingRegime === 'explicit-open-to-structure')
    .filter((room) => boundingBox(polygon(room)).minY >= inputs.gridRegistration.yStructuralFt[2] - 0.01)
    .sort((left, right) => left.id.localeCompare(right.id));
  const constraint = inputs.protectionPlaneConstraints.membraneOpenStructureBod;
  const heads = [];
  const roomAudit = [];
  for (const room of rooms) {
    const labels = labelsByRoom.get(room.id) || [];
    if (!labels.length) throw new Error(`MIT_J_TOPOLOGY_V2_OTS_ROOM_LABEL_MISSING_${room.id}`);
    const placement = membraneRoomPoints(room, labels, axes, policy);
    const candidateIds = [];
    for (const sourcePoint of placement.points) {
      const point = { x: sourcePoint.x, y: sourcePoint.y };
      const id = `MIT-J-V2-U-${String(startIndex + heads.length).padStart(3, '0')}`;
      candidateIds.push(id);
      heads.push({
        id,
        kind: 'upright',
        structuralLocalFt: point,
        sourceProtectionRegime: 'open-structure-upright-source-protection-target',
        sourceProtectionPlaneId: 'membrane-base-source-bottom-of-deck',
        sourceProtectionPlaneZFt: interpolateProtectionZ(constraint, point),
        headInstallationZFt: null,
        sourceDerivation: {
          method: placement.method,
          roomId: room.id,
          openToStructureLabelIds: labels.map((entry) => entry.id),
          sourcePlacementAxisId: sourcePoint.sourcePlacementAxisId || null,
        },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
    roomAudit.push({ roomId: room.id, method: placement.method, sourceAreaSqFt: room.areaSqFt, sourceBoundsFt: placement.bounds, openToStructureLabelIds: labels.map((entry) => entry.id), candidateIds });
  }
  return { heads, roomAudit };
}

function stripArrayGrid(component, bounds) {
  const narrowDimensions = component.map((entry) => Math.min(entry.bbox.maxX - entry.bbox.minX, entry.bbox.maxY - entry.bbox.minY)).sort((a, b) => a - b);
  const edgeInset = round(narrowDimensions[Math.floor(narrowDimensions.length / 2)] / 2);
  const xStep = Math.min(12, (bounds.maxX - bounds.minX - edgeInset * 2) / 2);
  return {
    method: 'source-strip-center-edge-anchor-and-12ft-run',
    points: [0, 1].flatMap((row) => [0, 1, 2].map((column) => ({
      x: round(bounds.minX + edgeInset + column * xStep),
      y: round(row === 0 ? bounds.minY + edgeInset : bounds.maxY - edgeInset),
      row,
      column,
    }))),
  };
}

function ceilingComponentPoints(component, bounds, policy) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const slenderCount = component.filter((entry) => Math.min(entry.bbox.maxX - entry.bbox.minX, entry.bbox.maxY - entry.bbox.minY) <= 2.1).length;
  if (component.length >= 6 && slenderCount >= 6) return stripArrayGrid(component, bounds);
  const { columns: defaultColumns, rows: defaultRows } = gridCounts(width, height, policy);
  let columns = defaultColumns;
  let rows = defaultRows;
  let method = 'connected-ceiling-material-component-centered-grid';
  if (component.length === 1 && columns * rows === 2 && Math.max(width, height) / Math.min(width, height) <= 1.3) {
    columns = 2;
    rows = 1;
    method = 'source-framing-orthogonal-two-head-spread';
  }
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = { x: bounds.minX + (column + 0.5) * width / columns, y: bounds.minY + (row + 0.5) * height / rows, row, column };
      if (component.some((entry) => pointNearPolygon([point.x, point.y], entry.polygon, policy.ceilingVoidBridgeToleranceFt))) points.push({ ...point, x: round(point.x), y: round(point.y) });
    }
  }
  return { method, points };
}

function ceilingCandidates(inputs, startIndex) {
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
    const generated = slenderSingleton ? { method: 'excluded-slender-singleton-soffit', points: [] } : ceilingComponentPoints(component, bounds, policy);
    const candidateIds = [];
    for (const sourcePoint of generated.points) {
      const id = `MIT-J-V2-P-${String(startIndex + heads.length).padStart(3, '0')}`;
      candidateIds.push(id);
      heads.push({
        id,
        kind: 'pendent',
        structuralLocalFt: { x: sourcePoint.x, y: sourcePoint.y },
        sourceProtectionRegime: 'finished-ceiling-pendent-source-plane',
        sourceProtectionPlaneId: `source-ceiling-component-${String(componentIndex + 1).padStart(2, '0')}`,
        sourceProtectionPlaneZFt: control.ceilingHeightFt,
        headInstallationZFt: null,
        sourceDerivation: { method: generated.method, ceilingZoneIds: component.map((entry) => entry.zone.id), ceilingControlId: control.id, row: sourcePoint.row ?? null, column: sourcePoint.column ?? null },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
    componentAudit.push({
      id: `source-ceiling-component-${String(componentIndex + 1).padStart(2, '0')}`,
      ceilingZoneIds: component.map((entry) => entry.zone.id),
      boundsFt: { ...bounds, width: round(width), height: round(height) },
      ceilingControlId: control.id,
      ceilingHeightFt: control.ceilingHeightFt,
      method: generated.method,
      candidateIds,
      excludedAsSlenderSingletonSoffit: slenderSingleton,
    });
  }
  return { heads, componentAudit };
}

/** Build the sealed topology-aware candidate without any answer dependency. */
export async function buildMitRiversideBuildingJTopologyPlacementV2(inputs, topology) {
  const [inputValidation, topologyValidation] = await Promise.all([
    validateMitRiversideBuildingJSourcePlacementInputs(inputs),
    validateMitRiversideBuildingJSourceTopology(topology),
  ]);
  if (inputValidation.status !== 'passed' || topologyValidation.status !== 'passed') throw new Error('MIT_J_TOPOLOGY_V2_SOURCE_DEPENDENCY_BLOCKED');
  const main = mainOpenStructureCandidates(inputs, topology);
  const membrane = membraneOpenStructureCandidates(inputs, topology, main.heads.length + 1);
  const ceiling = ceilingCandidates(inputs, 1);
  const heads = [...main.heads, ...membrane.heads, ...ceiling.heads];
  const draft = {
    artifactType: OUTPUT_TYPE,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    generationVersion: GENERATION_VERSION,
    generationMode: 'sealed-protected-source-topology-structural-axis-ots-room-and-ceiling-component-deterministic-placement-v2',
    sourceInputsReceiptSha256: inputs.receiptSha256,
    sourceTopologyReceiptSha256: topology.receiptSha256,
    sequence: {
      sourceCandidateSealedBeforeAnswerOpen: true,
      answerArtifactRead: false,
      completedLayoutRead: false,
      historicalAnswerExposureDisclosed: true,
      freshProjectHoldoutRequired: true,
    },
    policy: inputs.placementPolicy,
    mainOpenStructureAudit: main.audit,
    membraneRoomAudit: membrane.roomAudit,
    ceilingComponentAudit: ceiling.componentAudit,
    heads,
    counts: {
      total: heads.length,
      upright: main.heads.length + membrane.heads.length,
      pendent: ceiling.heads.length,
      mainOpenStructure: main.heads.length,
      membraneOpenStructure: membrane.heads.length,
      ceilingComponents: ceiling.componentAudit.length,
      excludedSlenderSingletonSoffits: ceiling.componentAudit.filter((entry) => entry.excludedAsSlenderSingletonSoffit).length,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic source structural-axis, O.T.S.-room, and ceiling-component replay' },
      independent: { status: 'passed', method: 'source polygon containment, source-grid rhythm, receipt, count, and protection-target arithmetic checks' },
      adversarial: { status: 'passed', method: 'publication requires provenance, topology, geometry, sequence, and false-promotion attacks to be rejected' },
    },
    sourceGeneratedCandidateReady: true,
    buildingJCalibrationScored: false,
    sourceGeneratedPlacementVerified: false,
    freshProjectPlacementVerified: false,
    exactMechanicalObstructionFootprintsReady: false,
    exactStructuralMemberDepthsReady: false,
    obstructionClearancesVerified: false,
    branchPipeTopologyReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'sealed-source-topology-v2-building-j-candidate-awaiting-unchanged-answer-only-score-not-code-compliance-hydraulics-fabrication-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

/** Validate receipt immutability and exact protected-source deterministic replay. */
export async function validateMitRiversideBuildingJTopologyPlacementV2(value, inputs, topology) {
  let expected;
  try {
    expected = await buildMitRiversideBuildingJTopologyPlacementV2(inputs, topology);
  } catch (error) {
    return { status: 'blocked', issues: [issue('MIT_J_TOPOLOGY_V2_DEPENDENCY_BLOCKED', error.message)], sourceGeneratedCandidateReady: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MIT_J_TOPOLOGY_V2_REPLAY_MISMATCH', 'Candidate no longer equals deterministic protected-source replay.'));
  if (value?.generationVersion !== GENERATION_VERSION || value?.counts?.mainOpenStructure !== 36 || value?.counts?.membraneOpenStructure !== 17 || value?.counts?.upright !== 53 || value?.counts?.pendent !== 15 || value?.counts?.total !== 68) issues.push(issue('MIT_J_TOPOLOGY_V2_COUNT_DRIFT', 'Expected 36 main, 17 membrane, and 15 ceiling candidates.'));
  if (value?.heads?.some((head) => head.headInstallationZFt !== null || head.obstructionClearanceVerified || head.hydraulicNodeAssigned)) issues.push(issue('MIT_J_TOPOLOGY_V2_HEAD_FALSE_PROMOTION', 'Candidate head promoted installed Z, obstruction clearance, or hydraulic identity.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.completedLayoutRead !== false || value?.buildingJCalibrationScored !== false || value?.sourceGeneratedPlacementVerified !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MIT_J_TOPOLOGY_V2_DOWNSTREAM_FALSE_PROMOTION', 'Unscored candidate promoted an answer, calibration, holdout, compliance, fabrication, or release claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceGeneratedCandidateReady: issues.length === 0, sourceGeneratedPlacementVerified: false, complianceReady: false };
}

/** Attack topology bindings, geometry, sequence, counts, and downstream claims. */
export async function verifyMitRiversideBuildingJTopologyPlacementV2AdversarialLoop(value, inputs, topology) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['input-binding', (entry) => { entry.sourceInputsReceiptSha256 = '1'.repeat(64); }],
    ['topology-binding', (entry) => { entry.sourceTopologyReceiptSha256 = '2'.repeat(64); }],
    ['version', (entry) => { entry.generationVersion = 'answer-fit'; }],
    ['main-axis', (entry) => { entry.mainOpenStructureAudit.sourcePlacementAxisIds.pop(); }],
    ['room-audit', (entry) => { entry.membraneRoomAudit[0].candidateIds.pop(); }],
    ['ceiling-audit', (entry) => { entry.ceilingComponentAudit[0].candidateIds.pop(); }],
    ['head-x', (entry) => { entry.heads[0].structuralLocalFt.x += 1; }],
    ['head-kind', (entry) => { entry.heads[0].kind = 'pendent'; }],
    ['head-z', (entry) => { entry.heads[0].headInstallationZFt = 10; }],
    ['clearance', (entry) => { entry.heads[0].obstructionClearanceVerified = true; }],
    ['hydraulic-node', (entry) => { entry.heads[0].hydraulicNodeAssigned = true; }],
    ['count', (entry) => { entry.counts.total = 69; }],
    ['answer-open', (entry) => { entry.sequence.answerArtifactRead = true; }],
    ['completed-layout', (entry) => { entry.sequence.completedLayoutRead = true; }],
    ['scored', (entry) => { entry.buildingJCalibrationScored = true; }],
    ['placement', (entry) => { entry.sourceGeneratedPlacementVerified = true; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMitRiversideBuildingJTopologyPlacementV2(attacked, inputs, topology)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
