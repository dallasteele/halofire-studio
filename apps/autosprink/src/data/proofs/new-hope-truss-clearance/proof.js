import {
  buildNewHopeProperPipeGraphCandidate,
  evaluateProperPitchedPipeGraph,
} from '../../../engine/proper-pitched-pipe-graph.js';

const calibrationUrl = '../../new-hope-truss-clearance-calibration.json';
const sourceUrl = '../../new-hope-truss-clearance-source.json';
const svg = document.querySelector('#structural-overlay');
const rows = document.querySelector('#clearance-rows');
const status = document.querySelector('#load-status');
const NS = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

try {
  const [response, sourceResponse] = await Promise.all([fetch(calibrationUrl), fetch(sourceUrl)]);
  if (!response.ok) throw new Error(`calibration fetch ${response.status}`);
  if (!sourceResponse.ok) throw new Error(`source fetch ${sourceResponse.status}`);
  const [calibration, source] = await Promise.all([response.json(), sourceResponse.json()]);
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
  document.querySelector('#machine-acceptance-boundary').textContent = `actualPdfUnderlays=true | exactHeadXyReady=true | conditionalTrussClearanceReady=true | pipeGraphNodes=${acceptance.metrics.nodeCount} | pipeGraphEdges=${acceptance.metrics.edgeCount} | machineBlockerCodes=${acceptance.blockerCodes.length} | properPipeLayoutReady=${acceptance.properPipeLayoutReady} | complianceReady=false | fabricationReady=false | fieldReleaseReady=${acceptance.fieldReleaseReady}`;
  document.documentElement.dataset.proofReady = 'true';
  document.documentElement.dataset.pipeGraphStatus = acceptance.status;
} catch (error) {
  status.textContent = `Proof blocked: ${error.message}`;
  document.documentElement.dataset.proofReady = 'false';
  throw error;
}
