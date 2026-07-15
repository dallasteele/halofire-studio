import {
  buildNewHopeProperPipeGraphCandidate,
  evaluateProperPitchedPipeGraph,
} from '../../../engine/proper-pitched-pipe-graph.js';
import { evaluateApprovedFp20PipeVectors } from '../../../engine/approved-fp20-pipe-vectors.js';
import { buildApprovedFp20PlanGraph } from '../../../engine/approved-fp20-plan-graph.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../../../engine/approved-fp20-governed-skeleton.js';
import { canonicalizeApprovedFp20Topology } from '../../../engine/approved-fp20-canonical-topology.js';

const calibrationUrl = '../../new-hope-truss-clearance-calibration.json';
const sourceUrl = '../../new-hope-truss-clearance-source.json';
const pipeVectorUrl = '../../new-hope-approved-fp20-pipe-vectors.json';
const planGraphUrl = '../../new-hope-approved-fp20-plan-graph.json';
const operationalAnnotationsUrl = '../../new-hope-approved-fp20-operational-annotations.json';
const svg = document.querySelector('#structural-overlay');
const pipeSvg = document.querySelector('#fp20-pipe-overlay');
const rows = document.querySelector('#clearance-rows');
const status = document.querySelector('#load-status');
const NS = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

try {
  const [response, sourceResponse, pipeVectorResponse, planGraphResponse, operationalResponse] = await Promise.all([fetch(calibrationUrl), fetch(sourceUrl), fetch(pipeVectorUrl), fetch(planGraphUrl), fetch(operationalAnnotationsUrl)]);
  if (!response.ok) throw new Error(`calibration fetch ${response.status}`);
  if (!sourceResponse.ok) throw new Error(`source fetch ${sourceResponse.status}`);
  if (!pipeVectorResponse.ok) throw new Error(`pipe vector fetch ${pipeVectorResponse.status}`);
  if (!planGraphResponse.ok) throw new Error(`plan graph fetch ${planGraphResponse.status}`);
  if (!operationalResponse.ok) throw new Error(`operational annotations fetch ${operationalResponse.status}`);
  const [calibration, source, pipeVectors, planGraph, operationalAnnotations] = await Promise.all([response.json(), sourceResponse.json(), pipeVectorResponse.json(), planGraphResponse.json(), operationalResponse.json()]);
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
  const remainingLayoutBlockers = [
    ...canonicalTopology.remainingTopologyBlockers,
    ...governedSkeleton.remainingLayoutBlockers.filter((entry) => entry.code !== 'FP20_CONNECTOR_CLUSTER_CANONICALIZATION_REQUIRED'),
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
  document.querySelector('#vector-proof-status').textContent = `PASS: ${vectorAcceptance.metrics.connectedPipeVectorCount}/${vectorAcceptance.metrics.pipeVectorCount} connected primary vectors, ${vectorAcceptance.metrics.sprinklerCount} heads`;
  document.querySelector('#plan-graph-status').textContent = `PASS: ${planGraph.metrics.nodeCount} nodes / ${planGraph.metrics.edgeCount} split edges / ${planGraph.metrics.connectedComponentCount} component`;
  document.querySelector('#size-proof-status').textContent = `PASS: ${governedSkeleton.metrics.assignedPrimarySegmentCount}/67 primary size + role assignments`;
  document.querySelector('#operations-proof-status').textContent = `PASS: ${governedSkeleton.metrics.operationalReferenceVectorCount} drain/test vectors + ${governedSkeleton.metrics.lowPointAnchorCount} low points`;
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
  document.querySelector('#machine-acceptance-boundary').textContent = `actualPdfUnderlays=true | primaryPipeVectorExtractionReady=${governedSkeleton.primaryPipeVectorExtractionReady} | wholeSystemVectorExtractionReady=${governedSkeleton.wholeSystemVectorExtractionReady} | sourceTopologyConnected=${vectorAcceptance.sourceTopologyConnected} | sourcePlanGraphReady=${planGraph.sourcePlanGraphReady} | canonicalTopologyReady=${canonicalTopology.canonicalTopologyReady} | canonicalNodes=${canonicalTopology.metrics.canonicalNodeCount} | canonicalEdges=${canonicalTopology.metrics.canonicalEdgeCount} | connectorOnlyCyclesRemoved=${canonicalTopology.metrics.artificialConnectorCycleCount} | sourceLoopsAwaitingCalcBinding=${canonicalTopology.metrics.canonicalCycleRank} | primaryPipeSizeAssignmentReady=${governedSkeleton.primaryPipeSizeAssignmentReady} | primaryPipeRoleAssignmentReady=${governedSkeleton.primaryPipeRoleAssignmentReady} | operationalReferenceExtractionReady=${governedSkeleton.operationalReferenceExtractionReady} | supplySourceAnchorReady=${governedSkeleton.supplySourceAnchorReady} | lowPointIntentReady=${governedSkeleton.lowPointIntentReady} | drainIntentReady=${governedSkeleton.drainIntentReady} | gradeMagnitudeReady=${governedSkeleton.gradeMagnitudeReady} | hydraulicCalculationCorpusReady=${governedSkeleton.hydraulicCalculationCorpusReady} | hydraulicNodeBindingReady=${governedSkeleton.hydraulicNodeBindingReady} | fieldDrainRouteResolved=${governedSkeleton.fieldDrainRouteResolved} | hydraulicFlowReady=${governedSkeleton.hydraulicFlowReady} | properPipeLayoutReady=${governedSkeleton.properPipeLayoutReady} | branchGradeDirectionReady=${governedSkeleton.gradeDirectionReady} | endpointElevationsReady=${governedSkeleton.endpointElevationsReady} | complianceReady=false | fabricationReady=${governedSkeleton.fabricationReady} | fieldReleaseReady=${governedSkeleton.fieldReleaseReady}`;
  document.documentElement.dataset.proofReady = 'true';
  document.documentElement.dataset.pipeVectorStatus = vectorAcceptance.status;
  document.documentElement.dataset.sourcePlanGraphStatus = planGraph.sourcePlanGraphReady ? 'passed' : 'blocked';
  document.documentElement.dataset.canonicalTopologyReady = String(canonicalTopology.canonicalTopologyReady);
  document.documentElement.dataset.sourceLoopsAwaitingCalcBinding = String(canonicalTopology.metrics.canonicalCycleRank);
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
  document.documentElement.dataset.fieldDrainRouteResolved = String(governedSkeleton.fieldDrainRouteResolved);
  document.documentElement.dataset.pipeGraphStatus = governedSkeleton.properPipeLayoutReady ? 'passed' : 'blocked';
  document.documentElement.dataset.properPipeLayoutReady = String(governedSkeleton.properPipeLayoutReady);
  document.documentElement.dataset.branchGradeDirectionReady = String(governedSkeleton.gradeDirectionReady);
  document.documentElement.dataset.endpointElevationsReady = String(governedSkeleton.endpointElevationsReady);
  document.documentElement.dataset.drainDestinationReady = 'false';
  document.documentElement.dataset.fieldReleaseReady = String(governedSkeleton.fieldReleaseReady);
} catch (error) {
  status.textContent = `Proof blocked: ${error.message}`;
  document.documentElement.dataset.proofReady = 'false';
  throw error;
}
