import {
  buildNewHopeProperPipeGraphCandidate,
  evaluateProperPitchedPipeGraph,
} from '../../../engine/proper-pitched-pipe-graph.js';
import { evaluateApprovedFp20PipeVectors } from '../../../engine/approved-fp20-pipe-vectors.js';

const calibrationUrl = '../../new-hope-truss-clearance-calibration.json';
const sourceUrl = '../../new-hope-truss-clearance-source.json';
const pipeVectorUrl = '../../new-hope-approved-fp20-pipe-vectors.json';
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
  const [response, sourceResponse, pipeVectorResponse] = await Promise.all([fetch(calibrationUrl), fetch(sourceUrl), fetch(pipeVectorUrl)]);
  if (!response.ok) throw new Error(`calibration fetch ${response.status}`);
  if (!sourceResponse.ok) throw new Error(`source fetch ${sourceResponse.status}`);
  if (!pipeVectorResponse.ok) throw new Error(`pipe vector fetch ${pipeVectorResponse.status}`);
  const [calibration, source, pipeVectors] = await Promise.all([response.json(), sourceResponse.json(), pipeVectorResponse.json()]);
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
  for (const segment of pipeVectors.pipeSegments) {
    const line = element('line', {
      class: `pipe-vector ${segment.strokeClass}`,
      x1: segment.fromPdfPt.x,
      y1: segment.fromPdfPt.y,
      x2: segment.toPdfPt.x,
      y2: segment.toPdfPt.y,
    });
    const title = element('title');
    title.textContent = `${segment.id}: ${segment.strokeClass}, ${(segment.lengthPdfPt / pipeVectors.planRegistration.pdfPtPerFt).toFixed(2)} ft visible`;
    line.append(title);
    pipeSvg.append(line);
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
  document.querySelector('#vector-proof-status').textContent = `PASS: ${vectorAcceptance.metrics.connectedPipeVectorCount}/${vectorAcceptance.metrics.pipeVectorCount} connected source vectors, ${vectorAcceptance.metrics.sprinklerCount} heads, ${vectorAcceptance.metrics.totalVisiblePipeLengthFt.toFixed(1)} visible ft`;
  document.querySelector('#size-proof-status').textContent = `PASS: ${vectorAcceptance.metrics.pipeSizeAnnotationCount} source diameter labels (1\u2033 through 4\u2033)`;
  const candidate = buildNewHopeProperPipeGraphCandidate(calibration, source);
  const acceptance = evaluateProperPitchedPipeGraph(candidate);
  document.querySelector('#graph-node-count').textContent = acceptance.metrics.nodeCount;
  document.querySelector('#graph-edge-count').textContent = acceptance.metrics.edgeCount;
  document.querySelector('#graph-connected-count').textContent = acceptance.metrics.connectedNodeCount;
  document.querySelector('#graph-blocker-count').textContent = acceptance.blockerCodes.length;
  const messages = new Map(acceptance.issues.map((entry) => [entry.code, entry.message]));
  const blockerRows = document.querySelector('#pipe-blocker-rows');
  for (const code of acceptance.blockerCodes) {
    const row = document.createElement('tr');
    row.innerHTML = `<td style="color:#fda4af">${code}</td><td>${messages.get(code)}</td>`;
    blockerRows.append(row);
  }
  document.querySelector('#machine-acceptance-boundary').textContent = `actualPdfUnderlays=true | fullApprovedVectorExtractionReady=${vectorAcceptance.vectorExtractionReady} | sourceTopologyConnected=${vectorAcceptance.sourceTopologyConnected} | pipeSizeAnnotationExtractionReady=${vectorAcceptance.pipeSizeAnnotationExtractionReady} | approvedPipeVectors=${vectorAcceptance.metrics.pipeVectorCount} | approvedSprinklers=${vectorAcceptance.metrics.sprinklerCount} | approvedPipeSizeAnnotations=${vectorAcceptance.metrics.pipeSizeAnnotationCount} | exactHeadXyReady=true | conditionalTrussClearanceReady=true | pipeGraphNodes=${acceptance.metrics.nodeCount} | pipeGraphEdges=${acceptance.metrics.edgeCount} | machineBlockerCodes=${acceptance.blockerCodes.length} | properPipeLayoutReady=${acceptance.properPipeLayoutReady} | branchGradeDirectionReady=false | endpointElevationsReady=false | drainDestinationReady=false | complianceReady=false | fabricationReady=false | fieldReleaseReady=${acceptance.fieldReleaseReady}`;
  document.documentElement.dataset.proofReady = 'true';
  document.documentElement.dataset.pipeVectorStatus = vectorAcceptance.status;
  document.documentElement.dataset.pipeGraphStatus = acceptance.status;
} catch (error) {
  status.textContent = `Proof blocked: ${error.message}`;
  document.documentElement.dataset.proofReady = 'false';
  throw error;
}
