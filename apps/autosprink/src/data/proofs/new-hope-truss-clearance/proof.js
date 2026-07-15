import {
  buildNewHopeProperPipeGraphCandidate,
  evaluateProperPitchedPipeGraph,
} from '../../../engine/proper-pitched-pipe-graph.js';
import { evaluateApprovedFp20PipeVectors } from '../../../engine/approved-fp20-pipe-vectors.js';
import { buildApprovedFp20PlanGraph } from '../../../engine/approved-fp20-plan-graph.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../../../engine/approved-fp20-governed-skeleton.js';
import { canonicalizeApprovedFp20Topology } from '../../../engine/approved-fp20-canonical-topology.js';
import { bindApprovedFp20HydraulicRouteSet } from '../../../engine/approved-fp20-hydraulic-route-binding.js';
import { evaluateApprovedFp20ArchitecturalVerticalControls } from '../../../engine/approved-fp20-architectural-vertical-controls.js';
import { evaluateNewHopeRidgeBranchGradeEnvelope } from '../../../engine/new-hope-ridge-branch-grade-envelope.js';
import { evaluateNewHopeLongBranchDrainage } from '../../../engine/new-hope-long-branch-drainage.js';
import { evaluateNewHopeSideBranchDrainage } from '../../../engine/new-hope-side-branch-drainage.js';
import { evaluateNewHopeCrossMainDrainage } from '../../../engine/new-hope-cross-main-drainage.js';
import { evaluateNewHopeCentralBranchDrainage } from '../../../engine/new-hope-central-branch-drainage.js';
import { evaluateNewHopeArmOverDrainage } from '../../../engine/new-hope-arm-over-drainage.js';

const calibrationUrl = '../../new-hope-truss-clearance-calibration.json';
const sourceUrl = '../../new-hope-truss-clearance-source.json';
const pipeVectorUrl = '../../new-hope-approved-fp20-pipe-vectors.json';
const planGraphUrl = '../../new-hope-approved-fp20-plan-graph.json';
const operationalAnnotationsUrl = '../../new-hope-approved-fp20-operational-annotations.json';
const hydraulicRoute21Url = '../../new-hope-approved-fp20-hydraulic-route-2-1.json';
const hydraulicRoute22Url = '../../new-hope-approved-fp20-hydraulic-route-2-2.json';
const hydraulicRoute23Url = '../../new-hope-approved-fp20-hydraulic-route-2-3.json';
const architecturalSourceUrl = '../../new-hope-pitched-holdout-source.json';
const atticSourceUrl = '../../new-hope-attic-specific-application-source.json';
const atticCalibrationUrl = '../../new-hope-attic-specific-application-calibration.json';
const answerEvidenceUrl = '../../new-hope-pitched-holdout-answer-evidence.json';
const svg = document.querySelector('#structural-overlay');
const pipeSvg = document.querySelector('#fp20-pipe-overlay');
const gradeProfileSvg = document.querySelector('#bounded-grade-profile');
const longBranchProfileSvg = document.querySelector('#long-branch-relative-profile');
const sideBranchProfileSvg = document.querySelector('#side-branch-relative-profile');
const crossMainProfileSvg = document.querySelector('#cross-main-relative-profile');
const centralBranchProfileSvg = document.querySelector('#central-branch-relative-profile');
const armOverProfileSvg = document.querySelector('#arm-over-relative-profile');
const rows = document.querySelector('#clearance-rows');
const status = document.querySelector('#load-status');
const NS = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

try {
  const [response, sourceResponse, pipeVectorResponse, planGraphResponse, operationalResponse, hydraulicRoute21Response, hydraulicRoute22Response, hydraulicRoute23Response, architecturalSourceResponse, atticSourceResponse, atticCalibrationResponse, answerEvidenceResponse] = await Promise.all([fetch(calibrationUrl), fetch(sourceUrl), fetch(pipeVectorUrl), fetch(planGraphUrl), fetch(operationalAnnotationsUrl), fetch(hydraulicRoute21Url), fetch(hydraulicRoute22Url), fetch(hydraulicRoute23Url), fetch(architecturalSourceUrl), fetch(atticSourceUrl), fetch(atticCalibrationUrl), fetch(answerEvidenceUrl)]);
  if (!response.ok) throw new Error(`calibration fetch ${response.status}`);
  if (!sourceResponse.ok) throw new Error(`source fetch ${sourceResponse.status}`);
  if (!pipeVectorResponse.ok) throw new Error(`pipe vector fetch ${pipeVectorResponse.status}`);
  if (!planGraphResponse.ok) throw new Error(`plan graph fetch ${planGraphResponse.status}`);
  if (!operationalResponse.ok) throw new Error(`operational annotations fetch ${operationalResponse.status}`);
  if (!hydraulicRoute21Response.ok) throw new Error(`hydraulic route 2-1 fetch ${hydraulicRoute21Response.status}`);
  if (!hydraulicRoute22Response.ok) throw new Error(`hydraulic route 2-2 fetch ${hydraulicRoute22Response.status}`);
  if (!hydraulicRoute23Response.ok) throw new Error(`hydraulic route 2-3 fetch ${hydraulicRoute23Response.status}`);
  if (!architecturalSourceResponse.ok) throw new Error(`architectural source fetch ${architecturalSourceResponse.status}`);
  if (!atticSourceResponse.ok) throw new Error(`attic source fetch ${atticSourceResponse.status}`);
  if (!atticCalibrationResponse.ok) throw new Error(`attic calibration fetch ${atticCalibrationResponse.status}`);
  if (!answerEvidenceResponse.ok) throw new Error(`answer evidence fetch ${answerEvidenceResponse.status}`);
  const [calibration, source, pipeVectors, planGraph, operationalAnnotations, hydraulicRoute21Evidence, hydraulicRoute22Evidence, hydraulicRoute23Evidence, architecturalSource, atticSource, atticCalibration, answerEvidence] = await Promise.all([response.json(), sourceResponse.json(), pipeVectorResponse.json(), planGraphResponse.json(), operationalResponse.json(), hydraulicRoute21Response.json(), hydraulicRoute22Response.json(), hydraulicRoute23Response.json(), architecturalSourceResponse.json(), atticSourceResponse.json(), atticCalibrationResponse.json(), answerEvidenceResponse.json()]);
  const scale = 1.5;
  const branchY = 430;

  for (const truss of calibration.trussLattice.centerlines) {
    svg.append(element('line', { class: 'truss', x1: truss.pdfX * scale, y1: 145, x2: truss.pdfX * scale, y2: 690 }));
  }
  const startX = calibration.branch.nodes[0].structuralPdfX * scale;
  const endX = calibration.branch.nodes.at(-1).structuralPdfX * scale;
  svg.append(element('line', { class: 'branch', x1: startX, y1: branchY, x2: endX, y2: branchY }));
  for (const head of calibration.branch.nodes) svg.append(element('circle', { class: 'head', cx: head.structuralPdfX * scale, cy: branchY, r: 12 }));
  for (const x of [calibration.coordinateRegistration.structuralGrid.startCenterPdfPt, calibration.coordinateRegistration.structuralGrid.endCenterPdfPt]) svg.append(element('line', { class: 'gridline', x1: x * scale, y1: 90, x2: x * scale, y2: 740 }));
  svg.append(element('rect', { class: 'unresolved', x: 1490, y: 735, width: 660, height: 72, rx: 16 }));
  const text = element('text', { class: 'svgtext', x: 1520, y: 780 });
  text.textContent = 'X REGISTERED / STRUCTURAL RIDGE Y NOT REGISTERED';
  svg.append(text);

  for (const head of calibration.branch.nodes) {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${head.id}</td><td>${head.localFt.x.toFixed(6)}</td><td>${head.structuralPdfX.toFixed(6)}</td><td>${head.nearestTrussId}</td><td>${head.nearestTrussCenterlineDistanceIn.toFixed(6)}</td><td>${head.maximumTrussFaceWidthForSixInClearanceIn.toFixed(6)} in</td>`;
    rows.append(row);
  }
  status.textContent = `Sealed replay loaded: ${calibration.trussLattice.detectedCount} trusses, ${calibration.branch.nodes.length} approved heads, receipt ${calibration.receiptSha256.slice(0, 16)}...`;
  status.classList.remove('loading');
  const vectorAcceptance = evaluateApprovedFp20PipeVectors(pipeVectors);
  if (!vectorAcceptance.vectorExtractionReady) throw new Error(`approved FP2.0 vector gate: ${vectorAcceptance.blockerCodes.join(', ')}`);
  const replayedPlanGraph = buildApprovedFp20PlanGraph(pipeVectors);
  if (!replayedPlanGraph.sourcePlanGraphReady || JSON.stringify(replayedPlanGraph) !== JSON.stringify(planGraph)) throw new Error('approved FP2.0 persisted plan graph does not match deterministic replay');
  const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
  if (governedSkeleton.status !== 'passed') throw new Error(`approved FP2.0 governed skeleton: ${governedSkeleton.blockerCodes.join(', ')}`);
  const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
  if (!canonicalTopology.canonicalTopologyReady) throw new Error(`approved FP2.0 canonical topology: ${canonicalTopology.blockerCodes.join(', ')}`);
  const hydraulicRouteSet = bindApprovedFp20HydraulicRouteSet(canonicalTopology, [hydraulicRoute21Evidence, hydraulicRoute22Evidence, hydraulicRoute23Evidence]);
  if (!hydraulicRouteSet.approvedRemoteAreaSetReady) throw new Error(`approved FP2.0 hydraulic route set: ${hydraulicRouteSet.blockerCodes.join(', ')}`);
  const architecturalValidation = evaluateApprovedFp20ArchitecturalVerticalControls(architecturalSource);
  if (!architecturalValidation.sourceRegistrationReady) throw new Error(`architectural RCP/roof/elevation/section source registration: ${architecturalValidation.issues.map((entry) => entry.code).join(', ')}`);
  const architecturalVerticalControlReady = architecturalValidation.architecturalVerticalControlReady;
  const pipeCenterlineOffsetReady = architecturalValidation.pipeCenterlineOffsetReady;
  const ridgeGrade = evaluateNewHopeRidgeBranchGradeEnvelope({ pipeVectors, canonicalTopology, operationalAnnotations, atticSource, atticCalibration, answerEvidence });
  if (!ridgeGrade.boundedDeflectorGradeEnvelopeReady) throw new Error(`bounded ridge grade envelope: ${ridgeGrade.blockerCodes.join(', ')}`);
  const longBranchDrainage = evaluateNewHopeLongBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
  if (!longBranchDrainage.longBranchGradeDirectionReady) throw new Error(`complete long-branch drainage: ${longBranchDrainage.blockerCodes.join(', ')}`);
  const sideBranchDrainage = evaluateNewHopeSideBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
  if (!sideBranchDrainage.sideBranchLineGradeDirectionReady) throw new Error(`mirrored side-branch drainage: ${sideBranchDrainage.blockerCodes.join(', ')}`);
  const crossMainDrainage = evaluateNewHopeCrossMainDrainage({
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    operationalAnnotations,
    hydraulicRoutes: [hydraulicRoute21Evidence, hydraulicRoute22Evidence, hydraulicRoute23Evidence],
    sideBranchDrainage,
  });
  if (!crossMainDrainage.crossMainGradeDirectionReady) throw new Error(`complete cross-main drainage: ${crossMainDrainage.blockerCodes.join(', ')}`);
  const centralBranchDrainage = evaluateNewHopeCentralBranchDrainage({
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    operationalAnnotations,
  });
  if (!centralBranchDrainage.centralLoopDirectionReady) throw new Error(`central BL48/BL49 drainage: ${centralBranchDrainage.blockerCodes.join(', ')}`);
  const armOverDrainage = evaluateNewHopeArmOverDrainage({
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    operationalAnnotations,
    longBranchDrainage,
    sideBranchDrainage,
    crossMainDrainage,
    centralBranchDrainage,
  });
  if (!armOverDrainage.allTwelveArmOverDrainageReady) throw new Error(`all twelve arm-over drainage bindings: ${armOverDrainage.blockerCodes.join(', ')}`);
  const [hydraulicRoute21, hydraulicRoute22, hydraulicRoute23] = hydraulicRouteSet.remoteAreas;
  const remainingLayoutBlockers = [
    ...hydraulicRouteSet.remainingBlockers,
    ...governedSkeleton.remainingLayoutBlockers.filter((entry) => !['FP20_CONNECTOR_CLUSTER_CANONICALIZATION_REQUIRED', 'FP20_HYDRAULIC_FLOW_DIRECTION_UNRESOLVED', 'FP20_GRADE_DIRECTION_UNRESOLVED'].includes(entry.code)),
  ];
  const assignmentBySegmentId = new Map(governedSkeleton.primaryAssignments.map((entry) => [entry.sourceSegmentId, entry]));
  for (const segment of pipeVectors.pipeSegments) {
    const assignment = assignmentBySegmentId.get(segment.id);
    const line = element('line', {
      class: `pipe-vector ${segment.strokeClass} role-${assignment.systemRole}`,
      x1: segment.fromPdfPt.x,
      y1: segment.fromPdfPt.y,
      x2: segment.toPdfPt.x,
      y2: segment.toPdfPt.y,
    });
    const title = element('title');
    title.textContent = `${segment.id}: ${assignment.nominalDiameterIn}\u2033 ${assignment.systemRole}, ${(segment.lengthPdfPt / pipeVectors.planRegistration.pdfPtPerFt).toFixed(2)} ft visible`;
    line.append(title);
    pipeSvg.append(line);
  }
  for (const reference of governedSkeleton.operationalReferenceVectors) {
    const line = element('line', {
      class: `operational-vector ${reference.systemRole}`,
      x1: reference.fromPdfPt.x,
      y1: reference.fromPdfPt.y,
      x2: reference.toPdfPt.x,
      y2: reference.toPdfPt.y,
    });
    const title = element('title');
    title.textContent = `drawing ${reference.drawingIndex}: ${reference.systemRole}`;
    line.append(title);
    pipeSvg.append(line);
  }
  const operationalAnchors = [operationalAnnotations.supplyAnchor, ...operationalAnnotations.lowPointAnchors, operationalAnnotations.remoteInspectorsTest];
  for (const anchor of operationalAnchors) {
    const marker = element('circle', {
      class: anchor.id === 'supply-from-riser-room' ? 'operational-anchor supply-anchor' : anchor.id === 'remote-inspectors-test' ? 'operational-anchor inspector-anchor' : 'operational-anchor low-point-anchor',
      cx: anchor.leaderTargetPdfPt.x,
      cy: anchor.leaderTargetPdfPt.y,
      r: 8,
    });
    const title = element('title');
    title.textContent = `${anchor.id}: ${anchor.rawText}`;
    marker.append(title);
    pipeSvg.append(marker);
  }
  for (const head of pipeVectors.sprinklers) {
    const circle = element('circle', { class: `pipe-head ${head.symbolType}`, cx: head.centerPdfPt.x, cy: head.centerPdfPt.y, r: 5.6 });
    const title = element('title');
    title.textContent = `${head.id}: ${head.symbolType}, route ${head.nearestPipeSegmentId}`;
    circle.append(title);
    pipeSvg.append(circle);
  }
  for (const annotation of pipeVectors.pipeSizeAnnotations) {
    const x = (annotation.bboxPdfPt.x0 + annotation.bboxPdfPt.x1) / 2;
    const y = (annotation.bboxPdfPt.y0 + annotation.bboxPdfPt.y1) / 2;
    const angle = Math.atan2(annotation.writingDirection.y, annotation.writingDirection.x) * 180 / Math.PI;
    const label = element('text', { class: 'pipe-size-label', x, y, transform: `rotate(${angle} ${x} ${y})` });
    label.textContent = `${annotation.decodedNominalDiameterIn}\u2033`;
    const title = element('title');
    title.textContent = `${annotation.id}: source text ${annotation.rawText}, nearest ${annotation.nearestPipeSegmentId}`;
    label.append(title);
    pipeSvg.append(label);
  }
  const planNodeById = new Map(planGraph.nodes.map((node) => [node.id, node]));
  for (const edge of planGraph.edges.filter((candidate) => candidate.kind !== 'visible-source-pipe')) {
    const from = planNodeById.get(edge.fromNodeId);
    const to = planNodeById.get(edge.toNodeId);
    pipeSvg.append(element('line', { class: 'plan-connector', x1: from.pdfPt.x, y1: from.pdfPt.y, x2: to.pdfPt.x, y2: to.pdfPt.y }));
  }
  for (const node of planGraph.nodes) pipeSvg.append(element('circle', { class: 'plan-node', cx: node.pdfPt.x, cy: node.pdfPt.y, r: 1.8 }));
  const defs = element('defs');
  for (const remoteAreaId of ['2-1', '2-2', '2-3']) {
    const markerId = `hydraulic-flow-arrow-${remoteAreaId.replace('-', '')}`;
    const arrow = element('marker', { id: markerId, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto-start-reverse' });
    arrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `hydraulic-flow-arrowhead area-${remoteAreaId}` }));
    defs.append(arrow);
  }
  const longBranchArrow = element('marker', { id: 'long-branch-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 11, markerHeight: 11, orient: 'auto' });
  longBranchArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'long-branch-grade-arrowhead' }));
  defs.append(longBranchArrow);
  const sideBranchArrow = element('marker', { id: 'side-branch-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto' });
  sideBranchArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'side-branch-grade-arrowhead' }));
  defs.append(sideBranchArrow);
  const crossMainArrow = element('marker', { id: 'cross-main-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto' });
  crossMainArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'cross-main-grade-arrowhead' }));
  defs.append(crossMainArrow);
  const centralBranchArrow = element('marker', { id: 'central-branch-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto' });
  centralBranchArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'central-branch-grade-arrowhead' }));
  defs.append(centralBranchArrow);
  const armOverArrow = element('marker', { id: 'arm-over-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 14, markerHeight: 14, orient: 'auto' });
  armOverArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arm-over-grade-arrowhead' }));
  defs.append(armOverArrow);
  const gradeArrow = element('marker', { id: 'bounded-grade-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 13, markerHeight: 13, orient: 'auto' });
  gradeArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'bounded-grade-arrowhead' }));
  defs.append(gradeArrow);
  pipeSvg.prepend(defs);
  const canonicalNodeById = new Map(canonicalTopology.nodes.map((node) => [node.id, node]));
  for (const areaResult of hydraulicRouteSet.remoteAreas) {
    const markerId = `hydraulic-flow-arrow-${areaResult.remoteAreaId.replace('-', '')}`;
    for (const routeLeg of [...areaResult.planRouteLegs].reverse()) {
      if (routeLeg.pathKind === 'vertical-at-canonical-node') {
        const node = canonicalNodeById.get(routeLeg.nodeIds[0]);
        pipeSvg.append(element('circle', { class: `vertical-hydraulic-leg area-${areaResult.remoteAreaId}`, cx: node.pdfPt.x, cy: node.pdfPt.y, r: 8 }));
        const verticalLabel = element('text', { class: `vertical-hydraulic-label area-${areaResult.remoteAreaId}`, x: node.pdfPt.x + 10, y: node.pdfPt.y + 13 });
        verticalLabel.textContent = `${routeLeg.calculationFromNodeId}->${routeLeg.calculationToNodeId} Z`;
        pipeSvg.append(verticalLabel);
        continue;
      }
      const physicalNodeIds = [...routeLeg.nodeIds].reverse();
      for (let index = 0; index < physicalNodeIds.length - 1; index += 1) {
        const from = canonicalNodeById.get(physicalNodeIds[index]);
        const to = canonicalNodeById.get(physicalNodeIds[index + 1]);
        const line = element('line', { class: `hydraulic-flow-vector area-${areaResult.remoteAreaId}`, x1: from.pdfPt.x, y1: from.pdfPt.y, x2: to.pdfPt.x, y2: to.pdfPt.y, 'marker-end': `url(#${markerId})` });
        const title = element('title');
        title.textContent = `Remote area ${areaResult.remoteAreaId} route ${routeLeg.routeId} physical flow: ${routeLeg.calculationToNodeId} -> ${routeLeg.calculationFromNodeId}; calculation table is stored in reverse accumulation order`;
        line.append(title);
        pipeSvg.append(line);
      }
    }
    const labelOffsetY = { '2-1': -8, '2-2': 1, '2-3': 10 }[areaResult.remoteAreaId];
    for (const binding of areaResult.planNodeBindings) {
      pipeSvg.append(element('circle', { class: `hydraulic-node area-${areaResult.remoteAreaId}`, cx: binding.leaderTargetPdfPt.x, cy: binding.leaderTargetPdfPt.y, r: 4 }));
      const label = element('text', { class: `hydraulic-node-label area-${areaResult.remoteAreaId}`, x: binding.leaderTargetPdfPt.x + 5, y: binding.leaderTargetPdfPt.y + labelOffsetY });
      label.textContent = binding.calculationNodeId;
      pipeSvg.append(label);
    }
  }
  for (const branchSystem of longBranchDrainage.branchSystems) {
    for (const edge of branchSystem.directedEdges) {
      const line = element('line', { class: 'long-branch-grade-vector', x1: edge.highPdfPt.x, y1: edge.highPdfPt.y, x2: edge.lowPdfPt.x, y2: edge.lowPdfPt.y, 'marker-end': 'url(#long-branch-grade-arrow)' });
      const title = element('title');
      title.textContent = `${branchSystem.id}: ${edge.edgeId} drops ${edge.requiredDropIn.toFixed(3)} in toward ${branchSystem.lowPointId}`;
      line.append(title);
      pipeSvg.append(line);
    }
  }
  for (const branchSystem of sideBranchDrainage.branchSystems) {
    for (const edge of branchSystem.directedBranchLineEdges) {
      const line = element('line', { class: 'side-branch-grade-vector', x1: edge.highPdfPt.x, y1: edge.highPdfPt.y, x2: edge.lowPdfPt.x, y2: edge.lowPdfPt.y, 'marker-end': 'url(#side-branch-grade-arrow)' });
      const title = element('title');
      title.textContent = `${branchSystem.id}: ${edge.edgeId} drops ${edge.requiredDropIn.toFixed(3)} in toward ${branchSystem.lowPointId}; arm-over Z remains unresolved`;
      line.append(title);
      pipeSvg.append(line);
    }
  }
  for (const edge of crossMainDrainage.directedEdges) {
    const line = element('line', { class: 'cross-main-grade-vector', x1: edge.highPdfPt.x, y1: edge.highPdfPt.y, x2: edge.lowPdfPt.x, y2: edge.lowPdfPt.y, 'marker-end': 'url(#cross-main-grade-arrow)' });
    const title = element('title');
    title.textContent = `${edge.edgeId}: drops at least ${edge.minimumRequiredDropIn.toFixed(3)} in toward ${edge.drainageOutletId}`;
    line.append(title);
    pipeSvg.append(line);
  }
  for (const edge of centralBranchDrainage.directedEdges) {
    const line = element('line', { class: 'central-branch-grade-vector', x1: edge.highPdfPt.x, y1: edge.highPdfPt.y, x2: edge.lowPdfPt.x, y2: edge.lowPdfPt.y, 'marker-end': 'url(#central-branch-grade-arrow)' });
    const title = element('title');
    title.textContent = `${edge.lineName} ${edge.edgeId}: generated fall ${edge.minimumRequiredDropIn.toFixed(3)} in toward CMK; BL48/CMI plan crossing remains separated`;
    line.append(title);
    pipeSvg.append(line);
  }
  for (const edge of armOverDrainage.directedEdges) {
    const line = element('line', { class: 'arm-over-grade-vector', x1: edge.highPdfPt.x, y1: edge.highPdfPt.y, x2: edge.lowPdfPt.x, y2: edge.lowPdfPt.y, 'marker-end': 'url(#arm-over-grade-arrow)' });
    const title = element('title');
    title.textContent = `${edge.lineName} ${edge.edgeId}: terminal ${edge.sprinklerId} HIGH, carrier ${edge.lowNodeId} LOW, ${edge.requiredDropIn.toFixed(3)} in fall toward ${edge.drainageCatchmentId}`;
    line.append(title);
    pipeSvg.append(line);
  }
  for (let index = ridgeGrade.headElevationEnvelopes.length - 1; index > 0; index -= 1) {
    const from = ridgeGrade.headElevationEnvelopes[index];
    const to = ridgeGrade.headElevationEnvelopes[index - 1];
    pipeSvg.append(element('line', { class: 'bounded-grade-vector', x1: from.planPdfPt.x, y1: from.planPdfPt.y, x2: to.planPdfPt.x, y2: to.planPdfPt.y, 'marker-end': 'url(#bounded-grade-arrow)' }));
  }
  for (const head of ridgeGrade.headElevationEnvelopes) {
    pipeSvg.append(element('circle', { class: 'bounded-grade-head', cx: head.planPdfPt.x, cy: head.planPdfPt.y, r: 6.5 }));
    const label = element('text', { class: 'bounded-grade-label', x: head.planPdfPt.x, y: head.planPdfPt.y - 11 });
    label.textContent = `${head.minimumDeflectorZFt.toFixed(3)}-${head.maximumDeflectorZFt.toFixed(3)} Z`;
    pipeSvg.append(label);
  }

  const profileWidth = 900;
  const profileHeight = 320;
  const margin = { left: 76, right: 34, top: 30, bottom: 58 };
  const xProfile = (stationFt) => margin.left + stationFt / 36 * (profileWidth - margin.left - margin.right);
  const yProfile = (zFt) => margin.top + (21.35 - zFt) / (21.35 - 19.2) * (profileHeight - margin.top - margin.bottom);
  gradeProfileSvg.append(element('rect', { class: 'profile-allowed-band', x: margin.left, y: yProfile(19.875), width: profileWidth - margin.left - margin.right, height: yProfile(19.375) - yProfile(19.875) }));
  gradeProfileSvg.append(element('line', { class: 'profile-roof-ridge', x1: margin.left, y1: yProfile(21.208333), x2: profileWidth - margin.right, y2: yProfile(21.208333) }));
  const minPoints = ridgeGrade.headElevationEnvelopes.map((head) => `${xProfile(head.stationFtFromWestLowEnd)},${yProfile(head.minimumDeflectorZFt)}`).join(' ');
  const maxPoints = ridgeGrade.headElevationEnvelopes.map((head) => `${xProfile(head.stationFtFromWestLowEnd)},${yProfile(head.maximumDeflectorZFt)}`).join(' ');
  gradeProfileSvg.append(element('polyline', { class: 'profile-grade-min', points: minPoints }));
  gradeProfileSvg.append(element('polyline', { class: 'profile-grade-max', points: maxPoints }));
  for (const head of ridgeGrade.headElevationEnvelopes) {
    const x = xProfile(head.stationFtFromWestLowEnd);
    gradeProfileSvg.append(element('line', { class: 'profile-head-range', x1: x, y1: yProfile(head.maximumDeflectorZFt), x2: x, y2: yProfile(head.minimumDeflectorZFt) }));
    const station = element('text', { class: 'profile-axis-label', x, y: profileHeight - 22, 'text-anchor': 'middle' });
    station.textContent = `${head.stationFtFromWestLowEnd}'`;
    gradeProfileSvg.append(station);
  }
  const roofLabel = element('text', { class: 'profile-roof-label', x: margin.left + 10, y: yProfile(21.208333) - 9 });
  roofLabel.textContent = 'A103 ridge 21.208 ft';
  gradeProfileSvg.append(roofLabel);
  const gradeLabel = element('text', { class: 'profile-grade-label', x: profileWidth - margin.right, y: yProfile(19.525) - 10, 'text-anchor': 'end' });
  gradeLabel.textContent = 'HIGH EAST -> LOW WEST / 0.5 in per 10 ft';
  gradeProfileSvg.append(gradeLabel);

  const ridgeGradeRows = document.querySelector('#ridge-grade-rows');
  for (const head of ridgeGrade.headElevationEnvelopes) {
    const drainage = ridgeGrade.drainageAudit.find((entry) => entry.headId === head.headId);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${head.headId}</td><td>${head.stationFtFromWestLowEnd.toFixed(0)}</td><td>${head.minimumDeflectorZFt.toFixed(3)}</td><td>${head.maximumDeflectorZFt.toFixed(3)}</td><td>${drainage.nearestLowPointId}</td><td>${drainage.alternateLowPointMarginFt.toFixed(3)} ft</td>`;
    ridgeGradeRows.append(row);
  }

  const relativeChart = { left: 290, right: 50, top: 36, bottom: 52, width: 900, height: 520, maxRunFt: 70, riseScalePxPerIn: 17 };
  const relativeX = (runFt) => relativeChart.left + runFt / relativeChart.maxRunFt * (relativeChart.width - relativeChart.left - relativeChart.right);
  const laneBaselines = [112, 220, 328, 436];
  longBranchProfileSvg.append(element('line', { class: 'relative-profile-axis', x1: relativeChart.left, y1: relativeChart.height - relativeChart.bottom, x2: relativeChart.width - relativeChart.right, y2: relativeChart.height - relativeChart.bottom }));
  for (let runFt = 0; runFt <= 70; runFt += 10) {
    const label = element('text', { class: 'profile-axis-label', x: relativeX(runFt), y: 498, 'text-anchor': 'middle' });
    label.textContent = `${runFt}'`;
    longBranchProfileSvg.append(label);
  }
  const longBranchRows = document.querySelector('#long-branch-grade-rows');
  let profileIndex = 0;
  for (const branchSystem of longBranchDrainage.branchSystems) {
    const profileClass = branchSystem.id.startsWith('upper') ? 'upper' : 'lower';
    for (const profile of branchSystem.terminalProfiles) {
      const baselineY = laneBaselines[profileIndex];
      const terminalY = baselineY - profile.requiredRiseFromLowPointIn * relativeChart.riseScalePxPerIn;
      longBranchProfileSvg.append(element('line', { class: 'relative-profile-guide', x1: relativeChart.left, y1: baselineY, x2: relativeChart.width - relativeChart.right, y2: baselineY }));
      longBranchProfileSvg.append(element('line', { class: `relative-profile-line ${profileClass}`, x1: relativeX(0), y1: baselineY, x2: relativeX(profile.planRunLengthFt), y2: terminalY }));
      longBranchProfileSvg.append(element('circle', { class: `relative-profile-dot ${profileClass}`, cx: relativeX(0), cy: baselineY, r: 5 }));
      longBranchProfileSvg.append(element('circle', { class: `relative-profile-dot ${profileClass}`, cx: relativeX(profile.planRunLengthFt), cy: terminalY, r: 6 }));
      const label = element('text', { class: `relative-profile-label ${profileClass}`, x: 24, y: baselineY - 16 });
      label.textContent = `${branchSystem.id.replace('-long-branch-system', '').toUpperCase()}  |  ${profile.lowPointId}`;
      longBranchProfileSvg.append(label);
      const meta = element('text', { class: `relative-profile-meta ${profileClass}`, x: 24, y: baselineY + 10 });
      meta.textContent = `HIGH ${profile.terminalNodeId}  |  ${profile.planRunLengthFt.toFixed(3)} ft  |  +${profile.requiredRiseFromLowPointIn.toFixed(3)} in`;
      longBranchProfileSvg.append(meta);
      const row = document.createElement('tr');
      row.innerHTML = `<td>${branchSystem.id}</td><td>${profile.lowPointId}</td><td>${profile.terminalNodeId}</td><td>${profile.planRunLengthFt.toFixed(3)}</td><td>${profile.requiredRiseFromLowPointIn.toFixed(3)}</td><td>UNSET / FAIL-CLOSED</td>`;
      longBranchRows.append(row);
      profileIndex += 1;
    }
  }
  const sideChart = { left: 300, right: 50, width: 900, height: 330, maxRunFt: 60, riseScalePxPerIn: 18 };
  const sideX = (runFt) => sideChart.left + runFt / sideChart.maxRunFt * (sideChart.width - sideChart.left - sideChart.right);
  const sideBaselines = [126, 246];
  sideBranchProfileSvg.append(element('line', { class: 'side-profile-axis', x1: sideChart.left, y1: 284, x2: sideChart.width - sideChart.right, y2: 284 }));
  for (let runFt = 0; runFt <= 60; runFt += 10) {
    const label = element('text', { class: 'profile-axis-label', x: sideX(runFt), y: 314, 'text-anchor': 'middle' });
    label.textContent = `${runFt}'`;
    sideBranchProfileSvg.append(label);
  }
  const sideBranchRows = document.querySelector('#side-branch-grade-rows');
  sideBranchDrainage.branchSystems.forEach((branchSystem, index) => {
    const profile = branchSystem.trunkProfile;
    const baselineY = sideBaselines[index];
    const terminalY = baselineY - profile.requiredRiseFromLowPointIn * sideChart.riseScalePxPerIn;
    sideBranchProfileSvg.append(element('line', { class: 'side-profile-guide', x1: sideChart.left, y1: baselineY, x2: sideChart.width - sideChart.right, y2: baselineY }));
    sideBranchProfileSvg.append(element('line', { class: 'side-profile-line', x1: sideX(0), y1: baselineY, x2: sideX(profile.planRunLengthFt), y2: terminalY }));
    sideBranchProfileSvg.append(element('circle', { class: 'side-profile-dot', cx: sideX(0), cy: baselineY, r: 5 }));
    sideBranchProfileSvg.append(element('circle', { class: 'side-profile-dot', cx: sideX(profile.planRunLengthFt), cy: terminalY, r: 6 }));
    const label = element('text', { class: 'side-profile-label', x: 24, y: baselineY - 23 });
    label.textContent = `${branchSystem.id.replace('-side-branch-system', '').toUpperCase()}  |  ${profile.lowPointId}`;
    sideBranchProfileSvg.append(label);
    const meta = element('text', { class: 'side-profile-meta', x: 24, y: baselineY + 4 });
    meta.textContent = `HIGH ${profile.terminalNodeId}  |  ${profile.planRunLengthFt.toFixed(3)} ft  |  +${profile.requiredRiseFromLowPointIn.toFixed(3)} in`;
    sideBranchProfileSvg.append(meta);
    const blocker = element('text', { class: 'side-profile-blocker', x: 24, y: baselineY + 31 });
    blocker.textContent = `${branchSystem.armOverEdgeCount} ARM-OVERS: DIRECTION RESOLVED IN THREADED AUDIT / ABSOLUTE Z UNSET`;
    sideBranchProfileSvg.append(blocker);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${branchSystem.id}</td><td>${profile.lowPointId}</td><td>${profile.terminalNodeId}</td><td>${profile.planRunLengthFt.toFixed(3)}</td><td>${profile.requiredRiseFromLowPointIn.toFixed(3)}</td><td>${branchSystem.armOverEdgeCount} DIRECTION-BOUND / Z UNSET</td>`;
    sideBranchRows.append(row);
  });
  const crossChart = { left: 310, right: 50, width: 900, height: 640, maxRunFt: 70, dropScalePxPerIn: 28 };
  const crossX = (runFt) => crossChart.left + runFt / crossChart.maxRunFt * (crossChart.width - crossChart.left - crossChart.right);
  const crossBaselines = [82, 196, 310, 424, 538];
  crossMainProfileSvg.append(element('line', { class: 'cross-main-profile-axis', x1: crossChart.left, y1: 590, x2: crossChart.width - crossChart.right, y2: 590 }));
  for (let runFt = 0; runFt <= 70; runFt += 10) {
    const label = element('text', { class: 'profile-axis-label', x: crossX(runFt), y: 622, 'text-anchor': 'middle' });
    label.textContent = `${runFt}'`;
    crossMainProfileSvg.append(label);
  }
  const crossMainRows = document.querySelector('#cross-main-grade-rows');
  crossMainDrainage.pathProfiles.forEach((profile, index) => {
    const highY = crossBaselines[index];
    const sinkY = highY + profile.minimumRequiredDropIn * crossChart.dropScalePxPerIn;
    crossMainProfileSvg.append(element('line', { class: 'cross-main-profile-guide', x1: crossChart.left, y1: highY, x2: crossChart.width - crossChart.right, y2: highY }));
    crossMainProfileSvg.append(element('line', { class: 'cross-main-profile-line', x1: crossX(0), y1: highY, x2: crossX(profile.planRunLengthFt), y2: sinkY }));
    crossMainProfileSvg.append(element('circle', { class: 'cross-main-profile-dot', cx: crossX(0), cy: highY, r: 5 }));
    crossMainProfileSvg.append(element('circle', { class: 'cross-main-profile-dot sink', cx: crossX(profile.planRunLengthFt), cy: sinkY, r: 6 }));
    const label = element('text', { class: 'cross-main-profile-label', x: 22, y: highY - 18 });
    label.textContent = `${profile.id.toUpperCase()}  |  ${profile.sinkId}`;
    crossMainProfileSvg.append(label);
    const meta = element('text', { class: 'cross-main-profile-meta', x: 22, y: highY + 7 });
    meta.textContent = `${profile.planRunLengthFt.toFixed(3)} ft  |  MIN FALL ${profile.minimumRequiredDropIn.toFixed(3)} in`;
    crossMainProfileSvg.append(meta);
    const zText = profile.absoluteEndpointElevationsReady
      ? `${profile.highCalculationElevationFt.toFixed(3)} -> ${profile.sinkCalculationElevationFt.toFixed(3)} ft CALC Z`
      : `ABSOLUTE ENDPOINT Z UNSET / ${profile.sinkCalculationElevationFt ?? 'NO'} SINK Z`;
    const zLabel = element('text', { class: profile.absoluteEndpointElevationsReady ? 'cross-main-profile-z' : 'cross-main-profile-blocker', x: 22, y: highY + 31 });
    zLabel.textContent = zText;
    crossMainProfileSvg.append(zLabel);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${profile.id}</td><td>${profile.highNodeId}</td><td>${profile.sinkId}</td><td>${profile.planRunLengthFt.toFixed(3)}</td><td>${profile.minimumRequiredDropIn.toFixed(3)}</td><td>${zText}</td>`;
    crossMainRows.append(row);
  });
  const centralChart = { left: 310, right: 50, width: 900, height: 520, maxRunFt: 55, dropScalePxPerIn: 30 };
  const centralX = (runFt) => centralChart.left + runFt / centralChart.maxRunFt * (centralChart.width - centralChart.left - centralChart.right);
  const centralBaselines = [88, 202, 316, 430];
  centralBranchProfileSvg.append(element('line', { class: 'central-branch-profile-axis', x1: centralChart.left, y1: 474, x2: centralChart.width - centralChart.right, y2: 474 }));
  for (let runFt = 0; runFt <= 50; runFt += 10) {
    const label = element('text', { class: 'profile-axis-label', x: centralX(runFt), y: 506, 'text-anchor': 'middle' });
    label.textContent = `${runFt}'`;
    centralBranchProfileSvg.append(label);
  }
  const centralBranchRows = document.querySelector('#central-branch-grade-rows');
  centralBranchDrainage.pathProfiles.forEach((profile, index) => {
    const highY = centralBaselines[index];
    const sinkY = highY + profile.minimumRequiredDropIn * centralChart.dropScalePxPerIn;
    centralBranchProfileSvg.append(element('line', { class: 'central-branch-profile-guide', x1: centralChart.left, y1: highY, x2: centralChart.width - centralChart.right, y2: highY }));
    centralBranchProfileSvg.append(element('line', { class: 'central-branch-profile-line', x1: centralX(0), y1: highY, x2: centralX(profile.planRunLengthFt), y2: sinkY }));
    centralBranchProfileSvg.append(element('circle', { class: 'central-branch-profile-dot', cx: centralX(0), cy: highY, r: 5 }));
    centralBranchProfileSvg.append(element('circle', { class: 'central-branch-profile-dot sink', cx: centralX(profile.planRunLengthFt), cy: sinkY, r: 6 }));
    const label = element('text', { class: 'central-branch-profile-label', x: 22, y: highY - 18 });
    label.textContent = `${profile.lineName} | ${profile.id.replace(`${profile.lineName.toLowerCase()}-`, '').toUpperCase()}`;
    centralBranchProfileSvg.append(label);
    const meta = element('text', { class: 'central-branch-profile-meta', x: 22, y: highY + 7 });
    meta.textContent = `${profile.planRunLengthFt.toFixed(3)} ft | MIN FALL ${profile.minimumRequiredDropIn.toFixed(3)} in`;
    centralBranchProfileSvg.append(meta);
    const blocker = element('text', { class: 'central-branch-profile-blocker', x: 22, y: highY + 31 });
    blocker.textContent = 'ARM-OVER DIRECTION RESOLVED / ABSOLUTE PIPE Z UNSET';
    centralBranchProfileSvg.append(blocker);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${profile.lineName}</td><td>${profile.id}</td><td>${profile.highNodeId}</td><td>${profile.sinkId}</td><td>${profile.planRunLengthFt.toFixed(3)}</td><td>${profile.minimumRequiredDropIn.toFixed(3)}</td><td>UNSET / FAIL-CLOSED</td>`;
    centralBranchRows.append(row);
  });
  const armChart = { left: 330, right: 54, width: 900, laneHeight: 58, top: 42, maxRunFt: 7, dropScalePxPerIn: 30 };
  const armX = (runFt) => armChart.left + runFt / armChart.maxRunFt * (armChart.width - armChart.left - armChart.right);
  const armProfileDefs = element('defs');
  const armProfileArrow = element('marker', { id: 'arm-over-profile-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto' });
  armProfileArrow.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arm-over-grade-arrowhead' }));
  armProfileDefs.append(armProfileArrow);
  armOverProfileSvg.append(armProfileDefs);
  const armOverRows = document.querySelector('#arm-over-grade-rows');
  armOverDrainage.directedEdges.forEach((edge, index) => {
    const highY = armChart.top + index * armChart.laneHeight;
    const lowY = highY + Math.max(5, edge.requiredDropIn * armChart.dropScalePxPerIn);
    armOverProfileSvg.append(element('line', { class: 'arm-over-profile-guide', x1: armChart.left, y1: highY, x2: armChart.width - armChart.right, y2: highY }));
    armOverProfileSvg.append(element('line', { class: 'arm-over-profile-line', x1: armX(0), y1: highY, x2: armX(edge.planLengthFt), y2: lowY, 'marker-end': 'url(#arm-over-profile-arrow)' }));
    armOverProfileSvg.append(element('circle', { class: 'arm-over-profile-dot high', cx: armX(0), cy: highY, r: 5 }));
    armOverProfileSvg.append(element('circle', { class: 'arm-over-profile-dot low', cx: armX(edge.planLengthFt), cy: lowY, r: 5 }));
    const label = element('text', { class: 'arm-over-profile-label', x: 18, y: highY - 7 });
    label.textContent = `${edge.lineName} ${edge.edgeId} | ${edge.sprinklerId}`;
    armOverProfileSvg.append(label);
    const meta = element('text', { class: 'arm-over-profile-meta', x: 18, y: highY + 13 });
    meta.textContent = `${edge.planLengthFt.toFixed(3)} ft | FALL ${edge.requiredDropIn.toFixed(3)} in | ${edge.drainageCatchmentId}`;
    armOverProfileSvg.append(meta);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${edge.lineName}</td><td>${edge.edgeId}</td><td>${edge.sprinklerId}</td><td>${edge.highNodeId}</td><td>${edge.lowNodeId}</td><td>${edge.carrierRole}</td><td>${edge.drainageCatchmentId}</td><td>${edge.planLengthFt.toFixed(3)}</td><td>${edge.requiredDropIn.toFixed(3)}</td><td>UNSET / FAIL-CLOSED</td>`;
    armOverRows.append(row);
  });
  document.querySelector('#vector-proof-status').textContent = `PASS: ${vectorAcceptance.metrics.connectedPipeVectorCount}/${vectorAcceptance.metrics.pipeVectorCount} connected primary vectors, ${vectorAcceptance.metrics.sprinklerCount} heads`;
  document.querySelector('#plan-graph-status').textContent = `PASS: ${planGraph.metrics.nodeCount} nodes / ${planGraph.metrics.edgeCount} split edges / ${planGraph.metrics.connectedComponentCount} component`;
  document.querySelector('#size-proof-status').textContent = `PASS: ${governedSkeleton.metrics.assignedPrimarySegmentCount}/67 primary size + role assignments`;
  document.querySelector('#operations-proof-status').textContent = `PASS: ${governedSkeleton.metrics.operationalReferenceVectorCount} drain/test vectors + ${governedSkeleton.metrics.lowPointAnchorCount} low points`;
  document.querySelector('#hydraulic-route-proof-status').textContent = `PASS: RA2-1/2/3 ${hydraulicRouteSet.metrics.planBoundCalculationNodeCount} plan nodes / ${hydraulicRouteSet.metrics.pipeTableLegCount} calc legs / ${hydraulicRouteSet.metrics.mappedCalculatedCanonicalEdgeCount} calculated edges`;
  document.querySelector('#architectural-source-status').textContent = `PASS: A102 RCP + A103 roof + A201 elevations + A301 sections; 4:12 roof, ${architecturalSource.pitchedConcealedVolume.eaveDatumZFt.toFixed(3)}-${architecturalSource.pitchedConcealedVolume.ridgeDatumZFt.toFixed(3)} ft roof envelope`;
  document.querySelector('#long-branch-grade-proof-status').textContent = `PASS: 2 complete 14-head systems / 44 edges / 43 directed toward low-point-01 and low-point-04`;
  document.querySelector('#side-branch-grade-proof-status').textContent = `PASS: 2 complete seven-head components / 28 branch-line edges directed toward low-point-02 and low-point-03; 4 attached arm-overs source-bound in threaded audit`;
  document.querySelector('#cross-main-grade-proof-status').textContent = `PASS: 35-node / 34-edge cross-main tree, including fabricated CMK.01-.03, directed from three high points toward low-point-01, low-point-04, and the riser return`;
  document.querySelector('#central-branch-grade-proof-status').textContent = `PASS: BL48/BL49 23-node / 23-edge branch component; eight-edge BL49 loop graded on both arms toward CMK; false BL48/CMI crossing kept separated; 4 attached arm-overs source-bound`;
  document.querySelector('#arm-over-grade-proof-status').textContent = `PASS: all 12 threaded terminal arm-overs bound to exact source edges, sprinklers, carrier roles, cut-length groups, and explicit drainage catchments`;
  document.querySelector('#ridge-grade-proof-status').textContent = `PASS: bounded seven-head ridge branch drains east-high to west-low toward low-point-04; ${ridgeGrade.totalHeadRowRiseIn.toFixed(1)} in across 36 ft`;
  const candidate = buildNewHopeProperPipeGraphCandidate(calibration, source);
  const acceptance = evaluateProperPitchedPipeGraph(candidate);
  document.querySelector('#graph-node-count').textContent = canonicalTopology.metrics.canonicalNodeCount;
  document.querySelector('#graph-edge-count').textContent = canonicalTopology.metrics.canonicalEdgeCount;
  document.querySelector('#graph-connected-count').textContent = canonicalTopology.metrics.connectedNodeCount;
  document.querySelector('#graph-blocker-count').textContent = remainingLayoutBlockers.length;
  const blockerRows = document.querySelector('#pipe-blocker-rows');
  for (const blocker of remainingLayoutBlockers) {
    const row = document.createElement('tr');
    row.innerHTML = `<td style="color:#fda4af">${blocker.code}</td><td>${blocker.message}</td>`;
    blockerRows.append(row);
  }
  document.querySelector('#machine-acceptance-boundary').textContent = `actualPdfUnderlays=true | architecturalSourceRegistrationReady=${architecturalValidation.sourceRegistrationReady} | architecturalVerticalControlReady=${architecturalVerticalControlReady} | longBranchSourceTopologyReady=${longBranchDrainage.longBranchSourceTopologyReady} | longBranchLowPointBindingReady=${longBranchDrainage.longBranchLowPointBindingReady} | longBranchGradeDirectionReady=${longBranchDrainage.longBranchGradeDirectionReady} | longBranchRelativeGradeProfilesReady=${longBranchDrainage.longBranchRelativeGradeProfilesReady} | boundedRidgeBranchPlanPathReady=${ridgeGrade.boundedBranchPlanPathReady} | boundedRidgeBranchGradeMagnitudeReady=${ridgeGrade.boundedBranchGradeMagnitudeReady} | boundedRidgeBranchGradeDirectionReady=${ridgeGrade.boundedBranchGradeDirectionReady} | boundedRidgeBranchDrainCatchmentReady=${ridgeGrade.boundedBranchDrainCatchmentReady} | boundedDeflectorGradeEnvelopeReady=${ridgeGrade.boundedDeflectorGradeEnvelopeReady} | exactDeflectorElevationsReady=${ridgeGrade.exactDeflectorElevationsReady} | exactPipeCenterlineZReady=${ridgeGrade.exactPipeCenterlineZReady} | exactDrainRouteReady=${ridgeGrade.exactDrainRouteReady} | pipeCenterlineOffsetReady=${pipeCenterlineOffsetReady} | primaryPipeVectorExtractionReady=${governedSkeleton.primaryPipeVectorExtractionReady} | wholeSystemVectorExtractionReady=${governedSkeleton.wholeSystemVectorExtractionReady} | sourceTopologyConnected=${vectorAcceptance.sourceTopologyConnected} | sourcePlanGraphReady=${planGraph.sourcePlanGraphReady} | canonicalTopologyReady=${canonicalTopology.canonicalTopologyReady} | canonicalNodes=${canonicalTopology.metrics.canonicalNodeCount} | canonicalEdges=${canonicalTopology.metrics.canonicalEdgeCount} | connectorOnlyCyclesRemoved=${canonicalTopology.metrics.artificialConnectorCycleCount} | sourceLoopsBoundByApprovedCalculations=${canonicalTopology.metrics.canonicalCycleRank} | sourceLoopsAwaitingCalcBinding=0 | primaryPipeSizeAssignmentReady=${governedSkeleton.primaryPipeSizeAssignmentReady} | primaryPipeRoleAssignmentReady=${governedSkeleton.primaryPipeRoleAssignmentReady} | operationalReferenceExtractionReady=${governedSkeleton.operationalReferenceExtractionReady} | supplySourceAnchorReady=${governedSkeleton.supplySourceAnchorReady} | lowPointIntentReady=${governedSkeleton.lowPointIntentReady} | drainIntentReady=${governedSkeleton.drainIntentReady} | gradeMagnitudeReady=${governedSkeleton.gradeMagnitudeReady} | hydraulicCalculationCorpusReady=${governedSkeleton.hydraulicCalculationCorpusReady} | approvedRemoteAreaSetReady=${hydraulicRouteSet.approvedRemoteAreaSetReady} | approvedRemoteAreaHydraulicFlowReady=${hydraulicRouteSet.approvedRemoteAreaHydraulicFlowReady} | calculationEndpointElevationEvidenceReady=${hydraulicRouteSet.calculationEndpointElevationEvidenceReady} | route21ExplicitPlanPathReady=${hydraulicRoute21.explicitPlanPathReady} | route22ExplicitPlanPathReady=${hydraulicRoute22.explicitPlanPathReady} | route23ExplicitPlanPathReady=${hydraulicRoute23.explicitPlanPathReady} | wholeFp20HydraulicNodeBindingReady=${hydraulicRouteSet.wholeFp20HydraulicNodeBindingReady} | wholeFp20HydraulicFlowReady=${hydraulicRouteSet.wholeFp20HydraulicFlowReady} | fieldDrainRouteResolved=${governedSkeleton.fieldDrainRouteResolved} | properPipeLayoutReady=${armOverDrainage.properPipeLayoutReady} | wholeFp20GradeDirectionReady=${armOverDrainage.wholeFp20GradeDirectionReady} | endpointElevationsReady=${governedSkeleton.endpointElevationsReady} | complianceReady=false | fabricationReady=${armOverDrainage.fabricationReady} | fieldReleaseReady=${armOverDrainage.fieldReleaseReady}`;
  document.querySelector('#machine-acceptance-boundary').textContent += ` | sideBranchSourceTopologyReady=${sideBranchDrainage.sideBranchSourceTopologyReady} | sideBranchLowPointBindingReady=${sideBranchDrainage.sideBranchLowPointBindingReady} | sideBranchLineGradeDirectionReady=${sideBranchDrainage.sideBranchLineGradeDirectionReady} | sideBranchRelativeGradeProfilesReady=${sideBranchDrainage.sideBranchRelativeGradeProfilesReady} | sideBranchArmOverDrainageReady=${armOverDrainage.sideBranchArmOverDrainageReady}`;
  document.querySelector('#machine-acceptance-boundary').textContent += ` | crossMainSourceTopologyReady=${crossMainDrainage.crossMainSourceTopologyReady} | crossMainHighPointBindingReady=${crossMainDrainage.crossMainHighPointBindingReady} | crossMainLowPointBindingReady=${crossMainDrainage.crossMainLowPointBindingReady} | crossMainRiserReturnReady=${crossMainDrainage.crossMainRiserReturnReady} | crossMainGradeDirectionReady=${crossMainDrainage.crossMainGradeDirectionReady} | crossMainRelativeGradeProfilesReady=${crossMainDrainage.crossMainRelativeGradeProfilesReady} | upperHighPointAbsoluteZReady=${crossMainDrainage.upperHighPointAbsoluteZReady}`;
  document.querySelector('#machine-acceptance-boundary').textContent += ` | cmkLineBindingReady=${crossMainDrainage.cmkLineBindingReady} | cmkHighPointBindingReady=${crossMainDrainage.cmkHighPointBindingReady} | cmkHighPointAbsoluteZReady=${crossMainDrainage.cmkHighPointAbsoluteZReady} | centralBranchSourceTopologyReady=${centralBranchDrainage.centralBranchSourceTopologyReady} | centralBranchFabricationLineBindingReady=${centralBranchDrainage.centralBranchFabricationLineBindingReady} | centralBranchSeparatedCrossingReady=${centralBranchDrainage.centralBranchSeparatedCrossingReady} | centralBranchGeneratedGradeDirectionReady=${centralBranchDrainage.centralBranchGeneratedGradeDirectionReady} | centralBranchRelativeGradeProfilesReady=${centralBranchDrainage.centralBranchRelativeGradeProfilesReady} | centralLoopDirectionReady=${centralBranchDrainage.centralLoopDirectionReady} | selectedLoopHighPointAbsoluteZReady=${centralBranchDrainage.selectedLoopHighPointAbsoluteZReady} | centralBranchArmOverDrainageReady=${armOverDrainage.centralBranchArmOverDrainageReady}`;
  document.querySelector('#machine-acceptance-boundary').textContent += ` | armOverSourceTopologyReady=${armOverDrainage.armOverSourceTopologyReady} | armOverTerminalSprinklerBindingReady=${armOverDrainage.armOverTerminalSprinklerBindingReady} | armOverFabricationBindingReady=${armOverDrainage.armOverFabricationBindingReady} | armOverCrossProjectMethodCalibrationReady=${armOverDrainage.armOverCrossProjectMethodCalibrationReady} | armOverGeneratedGradeDirectionReady=${armOverDrainage.armOverGeneratedGradeDirectionReady} | armOverRelativeGradeProfilesReady=${armOverDrainage.armOverRelativeGradeProfilesReady} | allTwelveArmOverDrainageReady=${armOverDrainage.allTwelveArmOverDrainageReady}`;
  document.documentElement.dataset.proofReady = 'true';
  document.documentElement.dataset.architecturalSourceRegistrationReady = String(architecturalValidation.sourceRegistrationReady);
  document.documentElement.dataset.architecturalVerticalControlReady = String(architecturalVerticalControlReady);
  document.documentElement.dataset.pipeCenterlineOffsetReady = String(pipeCenterlineOffsetReady);
  document.documentElement.dataset.longBranchSourceTopologyReady = String(longBranchDrainage.longBranchSourceTopologyReady);
  document.documentElement.dataset.longBranchLowPointBindingReady = String(longBranchDrainage.longBranchLowPointBindingReady);
  document.documentElement.dataset.longBranchGradeDirectionReady = String(longBranchDrainage.longBranchGradeDirectionReady);
  document.documentElement.dataset.longBranchRelativeGradeProfilesReady = String(longBranchDrainage.longBranchRelativeGradeProfilesReady);
  document.documentElement.dataset.sideBranchSourceTopologyReady = String(sideBranchDrainage.sideBranchSourceTopologyReady);
  document.documentElement.dataset.sideBranchLowPointBindingReady = String(sideBranchDrainage.sideBranchLowPointBindingReady);
  document.documentElement.dataset.sideBranchLineGradeDirectionReady = String(sideBranchDrainage.sideBranchLineGradeDirectionReady);
  document.documentElement.dataset.sideBranchRelativeGradeProfilesReady = String(sideBranchDrainage.sideBranchRelativeGradeProfilesReady);
  document.documentElement.dataset.sideBranchArmOverDrainageReady = String(armOverDrainage.sideBranchArmOverDrainageReady);
  document.documentElement.dataset.crossMainSourceTopologyReady = String(crossMainDrainage.crossMainSourceTopologyReady);
  document.documentElement.dataset.crossMainHighPointBindingReady = String(crossMainDrainage.crossMainHighPointBindingReady);
  document.documentElement.dataset.crossMainLowPointBindingReady = String(crossMainDrainage.crossMainLowPointBindingReady);
  document.documentElement.dataset.crossMainRiserReturnReady = String(crossMainDrainage.crossMainRiserReturnReady);
  document.documentElement.dataset.crossMainGradeDirectionReady = String(crossMainDrainage.crossMainGradeDirectionReady);
  document.documentElement.dataset.crossMainRelativeGradeProfilesReady = String(crossMainDrainage.crossMainRelativeGradeProfilesReady);
  document.documentElement.dataset.upperHighPointAbsoluteZReady = String(crossMainDrainage.upperHighPointAbsoluteZReady);
  document.documentElement.dataset.cmkLineBindingReady = String(crossMainDrainage.cmkLineBindingReady);
  document.documentElement.dataset.cmkHighPointBindingReady = String(crossMainDrainage.cmkHighPointBindingReady);
  document.documentElement.dataset.cmkHighPointAbsoluteZReady = String(crossMainDrainage.cmkHighPointAbsoluteZReady);
  document.documentElement.dataset.centralBranchSourceTopologyReady = String(centralBranchDrainage.centralBranchSourceTopologyReady);
  document.documentElement.dataset.centralBranchFabricationLineBindingReady = String(centralBranchDrainage.centralBranchFabricationLineBindingReady);
  document.documentElement.dataset.centralBranchSeparatedCrossingReady = String(centralBranchDrainage.centralBranchSeparatedCrossingReady);
  document.documentElement.dataset.centralBranchGeneratedGradeDirectionReady = String(centralBranchDrainage.centralBranchGeneratedGradeDirectionReady);
  document.documentElement.dataset.centralBranchRelativeGradeProfilesReady = String(centralBranchDrainage.centralBranchRelativeGradeProfilesReady);
  document.documentElement.dataset.centralLoopDirectionReady = String(centralBranchDrainage.centralLoopDirectionReady);
  document.documentElement.dataset.selectedLoopHighPointAbsoluteZReady = String(centralBranchDrainage.selectedLoopHighPointAbsoluteZReady);
  document.documentElement.dataset.centralBranchArmOverDrainageReady = String(armOverDrainage.centralBranchArmOverDrainageReady);
  document.documentElement.dataset.armOverSourceTopologyReady = String(armOverDrainage.armOverSourceTopologyReady);
  document.documentElement.dataset.armOverTerminalSprinklerBindingReady = String(armOverDrainage.armOverTerminalSprinklerBindingReady);
  document.documentElement.dataset.armOverFabricationBindingReady = String(armOverDrainage.armOverFabricationBindingReady);
  document.documentElement.dataset.armOverCrossProjectMethodCalibrationReady = String(armOverDrainage.armOverCrossProjectMethodCalibrationReady);
  document.documentElement.dataset.armOverGeneratedGradeDirectionReady = String(armOverDrainage.armOverGeneratedGradeDirectionReady);
  document.documentElement.dataset.armOverRelativeGradeProfilesReady = String(armOverDrainage.armOverRelativeGradeProfilesReady);
  document.documentElement.dataset.allTwelveArmOverDrainageReady = String(armOverDrainage.allTwelveArmOverDrainageReady);
  document.documentElement.dataset.wholeFp20GradeDirectionReady = String(armOverDrainage.wholeFp20GradeDirectionReady);
  document.documentElement.dataset.boundedRidgeBranchGradeDirectionReady = String(ridgeGrade.boundedBranchGradeDirectionReady);
  document.documentElement.dataset.boundedRidgeBranchDrainCatchmentReady = String(ridgeGrade.boundedBranchDrainCatchmentReady);
  document.documentElement.dataset.boundedDeflectorGradeEnvelopeReady = String(ridgeGrade.boundedDeflectorGradeEnvelopeReady);
  document.documentElement.dataset.exactDeflectorElevationsReady = String(ridgeGrade.exactDeflectorElevationsReady);
  document.documentElement.dataset.exactPipeCenterlineZReady = String(ridgeGrade.exactPipeCenterlineZReady);
  document.documentElement.dataset.pipeVectorStatus = vectorAcceptance.status;
  document.documentElement.dataset.sourcePlanGraphStatus = planGraph.sourcePlanGraphReady ? 'passed' : 'blocked';
  document.documentElement.dataset.canonicalTopologyReady = String(canonicalTopology.canonicalTopologyReady);
  document.documentElement.dataset.sourceLoopsBoundByApprovedCalculations = String(canonicalTopology.metrics.canonicalCycleRank);
  document.documentElement.dataset.sourceLoopsAwaitingCalcBinding = '0';
  document.documentElement.dataset.primaryPipeSizeAssignmentReady = String(governedSkeleton.primaryPipeSizeAssignmentReady);
  document.documentElement.dataset.primaryPipeRoleAssignmentReady = String(governedSkeleton.primaryPipeRoleAssignmentReady);
  document.documentElement.dataset.wholeSystemVectorExtractionReady = String(governedSkeleton.wholeSystemVectorExtractionReady);
  document.documentElement.dataset.operationalReferenceExtractionReady = String(governedSkeleton.operationalReferenceExtractionReady);
  document.documentElement.dataset.supplySourceAnchorReady = String(governedSkeleton.supplySourceAnchorReady);
  document.documentElement.dataset.lowPointIntentReady = String(governedSkeleton.lowPointIntentReady);
  document.documentElement.dataset.drainIntentReady = String(governedSkeleton.drainIntentReady);
  document.documentElement.dataset.gradeMagnitudeReady = String(governedSkeleton.gradeMagnitudeReady);
  document.documentElement.dataset.hydraulicCalculationCorpusReady = String(governedSkeleton.hydraulicCalculationCorpusReady);
  document.documentElement.dataset.hydraulicNodeBindingReady = String(governedSkeleton.hydraulicNodeBindingReady);
  document.documentElement.dataset.route21HydraulicNodeBindingReady = String(hydraulicRoute21.route21HydraulicNodeBindingReady);
  document.documentElement.dataset.route21HydraulicFlowDirectionReady = String(hydraulicRoute21.route21HydraulicFlowDirectionReady);
  document.documentElement.dataset.route21ExplicitPlanPathReady = String(hydraulicRoute21.explicitPlanPathReady);
  document.documentElement.dataset.route22ExplicitPlanPathReady = String(hydraulicRoute22.explicitPlanPathReady);
  document.documentElement.dataset.route23ExplicitPlanPathReady = String(hydraulicRoute23.explicitPlanPathReady);
  document.documentElement.dataset.approvedRemoteAreaSetReady = String(hydraulicRouteSet.approvedRemoteAreaSetReady);
  document.documentElement.dataset.approvedRemoteAreaHydraulicFlowReady = String(hydraulicRouteSet.approvedRemoteAreaHydraulicFlowReady);
  document.documentElement.dataset.calculationEndpointElevationEvidenceReady = String(hydraulicRouteSet.calculationEndpointElevationEvidenceReady);
  document.documentElement.dataset.wholeFp20HydraulicNodeBindingReady = String(hydraulicRouteSet.wholeFp20HydraulicNodeBindingReady);
  document.documentElement.dataset.fieldDrainRouteResolved = String(governedSkeleton.fieldDrainRouteResolved);
  document.documentElement.dataset.pipeGraphStatus = armOverDrainage.properPipeLayoutReady ? 'passed' : 'blocked';
  document.documentElement.dataset.properPipeLayoutReady = String(armOverDrainage.properPipeLayoutReady);
  document.documentElement.dataset.branchGradeDirectionReady = String(armOverDrainage.wholeFp20GradeDirectionReady);
  document.documentElement.dataset.endpointElevationsReady = String(governedSkeleton.endpointElevationsReady);
  document.documentElement.dataset.drainDestinationReady = 'false';
  document.documentElement.dataset.fieldReleaseReady = String(governedSkeleton.fieldReleaseReady);
} catch (error) {
  status.textContent = `Proof blocked: ${error.message}`;
  document.documentElement.dataset.proofReady = 'false';
  throw error;
}
