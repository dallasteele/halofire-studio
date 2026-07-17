import { buildNewHopeSystemBackboneEvidence } from '../../../engine/new-hope-system-backbone-evidence.js';

const urls = {
  registration: '../../new-hope-asbuilt-source-feed-riser-registration.json',
  operationalAnnotations: '../../new-hope-approved-fp20-operational-annotations.json',
  planGraph: '../../new-hope-approved-fp20-plan-graph.json',
  route21: '../../new-hope-approved-fp20-hydraulic-route-2-1.json',
  route22: '../../new-hope-approved-fp20-hydraulic-route-2-2.json',
  route23: '../../new-hope-approved-fp20-hydraulic-route-2-3.json',
  waterSupplyAndWetRiser: '../../new-hope-approved-water-supply-wet-riser-evidence.json',
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function svgNode(tag, attrs = {}, text = null) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== null) node.textContent = text;
  return node;
}

function addMarker(svg, component) {
  const { x, y } = component.pdfPt;
  const group = svgNode('g', { 'data-component-id': component.id });
  if (component.kind === 'wet-riser-plan-station') {
    group.append(svgNode('circle', { class: 'wet-riser', cx: x, cy: y, r: 8 }));
  } else if (component.kind === 'riser-plan-station' || component.kind === 'dry-system-source-outlet') {
    group.append(svgNode('circle', { class: 'riser', cx: x, cy: y, r: component.kind === 'riser-plan-station' ? 15 : 11 }));
  } else if (component.kind === 'low-point-tie-in') {
    group.append(svgNode('circle', { class: 'low', cx: x, cy: y, r: 18 }));
  } else if (component.kind === 'field-route-drum-drip-intent') {
    group.append(svgNode('circle', { class: 'field', cx: x, cy: y, r: 27 }));
  } else if (component.kind === 'inspectors-test') {
    group.append(svgNode('circle', { class: 'itd', cx: x, cy: y, r: 20 }));
  }
  const labels = {
    'nh-riser-plan-station': 'RISER',
    'nh-wet-riser-plan-station': 'WET RISER',
    'nh-node-118': 'NODE 118',
    'low-point-01': 'LP-01',
    'low-point-02': 'LP-02',
    'low-point-03': 'LP-03',
    'low-point-04': 'LP-04',
    'field-route-drum-drip-lower': 'FIELD ROUTE',
    'field-route-drum-drip-upper': 'FIELD ROUTE',
    'remote-inspectors-test': 'REMOTE I.T.',
  };
  const labelOffset = {
    'nh-riser-plan-station': { x: -90, y: -21 },
    'nh-wet-riser-plan-station': { x: -112, y: 45 },
    'nh-node-118': { x: 25, y: 17 },
  }[component.id] ?? { x: 23, y: -18 };
  group.append(svgNode('text', { class: 'tag', x: x + labelOffset.x, y: y + labelOffset.y }, labels[component.id] ?? component.id));
  svg.append(group);
}

function renderProof(result) {
  if (result.status !== 'passed') throw new Error(result.issues.map((entry) => entry.code).join(', '));
  const svg = document.querySelector('#plan-overlay');
  const riser = result.plan2d.components.find((component) => component.id === 'nh-riser-plan-station');
  const outlet = result.plan2d.components.find((component) => component.id === 'nh-node-118');
  svg.append(svgNode('line', { class: 'source-leg', x1: riser.pdfPt.x, y1: riser.pdfPt.y, x2: outlet.pdfPt.x, y2: outlet.pdfPt.y }));
  result.plan2d.components.forEach((component) => addMarker(svg, component));

  const chain = document.querySelector('#elevation-chain');
  for (const component of result.elevation2d.components) {
    const row = document.createElement('div');
    row.className = 'port';
    row.innerHTML = `<b>Node ${component.calculationNodeId}</b><em>${component.localElevationFt.toFixed(3)} ft AFF datum</em><small>${component.role.replaceAll('-', ' ')}</small>`;
    chain.append(row);
  }
  document.querySelector('#section-identities').innerHTML = `<b>Source section identities</b><br>${result.elevation2d.sectionIdentities.join('<br>')}`;
  document.querySelector('#supply-results').innerHTML = result.approvedWaterSupply.calculationAreas.map((area) => `<div><b>Area ${area.id}</b><span>${area.totalFlowGpm.toFixed(1)} gpm at ${area.totalPressurePsi.toFixed(1)} psi</span><em>+${area.safetyMarginPsi.toFixed(1)} psi margin</em></div>`).join('');
  document.querySelector('#pump-basis').textContent = `NO FIRE PUMP - completed approved configuration; minimum source margin ${result.pumpDecision.minimumSafetyMarginPsi.toFixed(1)} psi. A new quote still requires a current flow test.`;
  document.querySelector('#gate-copy').textContent = 'The historical pump decision and wet-riser identities pass. New-quote flow freshness, wet-network extraction, field-routed drains, and complete installation geometry remain blocked. Nothing on this page authorizes pricing, fabrication, permitting, or field installation.';
  document.querySelector('#gate-codes').textContent = result.systemDesignGate.blockers.join(' | ');

  const root = document.documentElement.dataset;
  root.proofReady = 'true';
  root.plan2dEvidenceReady = String(result.plan2dEvidenceReady);
  root.elevation2dEvidenceReady = String(result.elevation2dEvidenceReady);
  root.model3dSourceIntersectionEvidenceReady = String(result.model3dSourceIntersectionEvidenceReady);
  root.model3dInstallationReady = String(result.model3dInstallationReady);
  root.currentFlowTestReady = String(result.currentFlowTestReady);
  root.approvedDesignWaterSupplyReady = String(result.approvedDesignWaterSupplyReady);
  root.pumpDecisionReady = String(result.pumpDecisionReady);
  root.wetRiserAndDrainEvidenceReady = String(result.wetRiserAndDrainEvidenceReady);
  root.fieldDrainRoutesResolved = String(result.fieldDrainRoutesResolved);
  root.quoteReady = String(result.quoteReady);
  root.fieldReleaseReady = String(result.fieldReleaseReady);
  root.blockerCount = String(result.systemDesignGate.blockers.length);
}

export const proofPromise = Promise.all(Object.values(urls).map(fetchJson)).then(([
  registration,
  operationalAnnotations,
  planGraph,
  route21,
  route22,
  route23,
  waterSupplyAndWetRiser,
]) => buildNewHopeSystemBackboneEvidence({
  registration,
  operationalAnnotations,
  planGraph,
  hydraulicRoutes: [route21, route22, route23],
  waterSupplyAndWetRiser,
}));

proofPromise.then((result) => {
  renderProof(result);
  window.__NEW_HOPE_SYSTEM_BACKBONE_PROOF__ = result;
}).catch((error) => {
  document.documentElement.dataset.proofReady = 'false';
  document.querySelector('#gate-copy').textContent = `Proof rejected: ${error.message}`;
  throw error;
});
