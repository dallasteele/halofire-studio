/**
 * Register explicit A-121 roof slope callout targets into the issued S-190
 * structural-plan coordinate space. This is evidence of source annotations,
 * not a reconstructed roof surface, member elevation, sprinkler layout, or
 * clearance decision.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_CAD_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files';
const A121 = 'arch/A-121 ROOF PLAN.dwg';
const S190 = 'structural/240069_1881 W North Temple_ST25-Sheet - S-190 - OVERALL ROOF FRAMING PLAN.dwg';
const A121_SHA256 = 'FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606';
const S190_SHA256 = '539C3A39BDC2995D2BF427C82F732768117D11E08654697AD722C9F6BD38D3E4';
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-roof-slope-registration.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-roof-slope-registration.svg');
const ROOF_LINE_LAYERS = new Set(['S-BEAM', 'S-FNDN', 'S-GRID']);
const XML = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
function point(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) } : null; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (character) => XML[character]); }

export function plainText(value) {
  return String(value?.text?.text ?? value?.text ?? value ?? '')
    .replace(/\\[A-Za-z][^;]*;/g, '').replaceAll('\\P', ' ').replaceAll(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function fitAxisTransform(pairs) {
  if (pairs.length < 3) return null;
  const meanSource = pairs.reduce((sum, pair) => sum + pair.source, 0) / pairs.length;
  const meanTarget = pairs.reduce((sum, pair) => sum + pair.target, 0) / pairs.length;
  const denominator = pairs.reduce((sum, pair) => sum + (pair.source - meanSource) ** 2, 0);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const scale = pairs.reduce((sum, pair) => sum + (pair.source - meanSource) * (pair.target - meanTarget), 0) / denominator;
  const offset = meanTarget - scale * meanSource;
  const residuals = pairs.map((pair) => ({ ...pair, residual: Number((pair.target - (scale * pair.source + offset)).toFixed(6)) }));
  return {
    scale: Number(scale.toFixed(12)), offset: Number(offset.toFixed(6)), pairCount: pairs.length,
    rmsResidual: Number(Math.sqrt(residuals.reduce((sum, pair) => sum + pair.residual ** 2, 0) / residuals.length).toFixed(6)),
    maxResidual: Number(Math.max(...residuals.map((pair) => Math.abs(pair.residual))).toFixed(6)), residuals,
  };
}

function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function groupedCoordinates(entries, coordinate) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.label)) groups.set(entry.label, []);
    groups.get(entry.label).push(entry);
  }
  return new Map([...groups.entries()].map(([label, group]) => [label, {
    coordinate: average(group.map((entry) => entry[coordinate])), handles: group.map((entry) => entry.handle), count: group.length,
  }]));
}

function architecturalGridControls(entities) {
  const inserts = new Map(entities.filter((entity) => entity.type === 'INSERT').map((entity) => [String(entity.handle), point(entity.insertionPoint)]));
  const attributes = entities.filter((entity) => entity.type === 'ATTRIB' && String(entity.layer || '').includes('Architectural Grids'))
    .map((entity) => ({ handle: String(entity.handle), label: plainText(entity), position: inserts.get(String(entity.ownerBlockRecordSoftId)) || null, ownerHandle: String(entity.ownerBlockRecordSoftId) }))
    .filter((entry) => entry.position && /^([A-Z]|\d+(?:\.\d+)?)$/.test(entry.label));
  const numeric = groupedCoordinates(attributes.filter((entry) => /^\d/.test(entry.label)), 'position');
  const letters = groupedCoordinates(attributes.filter((entry) => /^[A-Z]$/.test(entry.label)), 'position');
  for (const value of numeric.values()) value.coordinate = average(attributes.filter((entry) => value.handles.includes(entry.handle)).map((entry) => entry.position.y));
  for (const value of letters.values()) value.coordinate = average(attributes.filter((entry) => value.handles.includes(entry.handle)).map((entry) => entry.position.x));
  return { numeric, letters };
}

function structuralGridControls(entities) {
  const gridLines = entities.filter((entity) => entity.type === 'LINE' && entity.layer === 'S-GRID').map((entity) => ({ handle: String(entity.handle), startPoint: point(entity.startPoint), endPoint: point(entity.endPoint) })).filter((entry) => entry.startPoint && entry.endPoint);
  const vertical = [...new Map(gridLines.filter((line) => Math.abs(line.startPoint.x - line.endPoint.x) < 0.01).map((line) => [line.startPoint.x.toFixed(6), line])).values()];
  const horizontal = [...new Map(gridLines.filter((line) => Math.abs(line.startPoint.y - line.endPoint.y) < 0.01).map((line) => [line.startPoint.y.toFixed(6), line])).values()];
  const entries = entities.filter((entity) => (entity.type === 'TEXT' || entity.type === 'MTEXT') && entity.layer === 'S-GRID-IDEN')
    .map((entity) => ({ handle: String(entity.handle), label: plainText(entity), position: point(entity.insertionPoint ?? entity.startPoint) }))
    .filter((entry) => entry.position && /^([A-Z]|\d+(?:\.\d+)?)$/.test(entry.label));
  const closest = (value, lines, axis) => lines.map((line) => ({ line, distance: Math.abs(line.startPoint[axis] - value) })).sort((left, right) => left.distance - right.distance)[0] || null;
  const numericEntries = entries.filter((entry) => /^\d/.test(entry.label)).map((entry) => ({ ...entry, control: closest(entry.position.x, vertical, 'x') })).filter((entry) => entry.control && entry.control.distance <= 200);
  const letterEntries = entries.filter((entry) => /^[A-Z]$/.test(entry.label)).map((entry) => ({ ...entry, control: closest(entry.position.y, horizontal, 'y') })).filter((entry) => entry.control && entry.control.distance <= 200);
  const numeric = groupedCoordinates(numericEntries, 'position');
  const letters = groupedCoordinates(letterEntries, 'position');
  for (const value of numeric.values()) { const controls = numericEntries.filter((entry) => value.handles.includes(entry.handle)).map((entry) => entry.control.line); value.coordinate = average(controls.map((line) => line.startPoint.x)); value.gridLineHandles = controls.map((line) => line.handle); }
  for (const value of letters.values()) { const controls = letterEntries.filter((entry) => value.handles.includes(entry.handle)).map((entry) => entry.control.line); value.coordinate = average(controls.map((line) => line.startPoint.y)); value.gridLineHandles = controls.map((line) => line.handle); }
  return { numeric, letters };
}

function sharedPairs(architectural, structural) {
  return [...architectural.entries()].filter(([label]) => structural.has(label)).map(([label, source]) => ({ label, source: source.coordinate, target: structural.get(label).coordinate, architecturalHandles: source.handles, structuralHandles: structural.get(label).handles }));
}

export function extractSlopeCallouts(entities, transform, roofBounds, tolerance = 1) {
  const labels = entities.filter((entity) => entity.type === 'MTEXT').map((entity) => ({ handle: String(entity.handle), text: plainText(entity), point: point(entity.insertionPoint ?? entity.startPoint) }))
    .filter((entry) => entry.point && /^SLOPE (\d+)(?:\/(\d+))?" PER FOOT$/.test(entry.text));
  const leaders = entities.filter((entity) => entity.type === 'LEADER').map((entity) => ({ handle: String(entity.handle), vertices: (entity.vertices || []).map(point).filter(Boolean) })).filter((entry) => entry.vertices.length >= 2);
  const callouts = []; const issues = [];
  for (const label of labels) {
    const match = /^SLOPE (\d+)(?:\/(\d+))?" PER FOOT$/.exec(label.text);
    const candidates = leaders.map((leader) => ({ leader, firstDistance: distance(leader.vertices[0], label.point), lastDistance: distance(leader.vertices.at(-1), label.point) }))
      .filter((entry) => Math.min(entry.firstDistance, entry.lastDistance) <= tolerance).sort((left, right) => Math.min(left.firstDistance, left.lastDistance) - Math.min(right.firstDistance, right.lastDistance));
    if (candidates.length !== 1) { issues.push(issue(candidates.length ? 'A121_SLOPE_LEADER_AMBIGUOUS' : 'A121_SLOPE_LEADER_MISSING', `${label.handle} has ${candidates.length} matching leader(s).`, [label.handle])); continue; }
    const candidate = candidates[0]; const target = candidate.firstDistance > candidate.lastDistance ? candidate.leader.vertices[0] : candidate.leader.vertices.at(-1);
    const structuralPoint = { x: transform.x.scale * target.y + transform.x.offset, y: transform.y.scale * target.x + transform.y.offset, z: 0 };
    if (structuralPoint.x < roofBounds.minX || structuralPoint.x > roofBounds.maxX || structuralPoint.y < roofBounds.minY || structuralPoint.y > roofBounds.maxY) { issues.push(issue('A121_SLOPE_TARGET_OUTSIDE_S190_BOUNDS', `${label.handle} registers outside the S-190 roof-plan source bounds.`, [label.handle, candidate.leader.handle])); continue; }
    callouts.push({ label: { handle: label.handle, text: label.text, point: label.point }, leader: { handle: candidate.leader.handle, target }, inchesPerFoot: Number((Number(match[1]) / Number(match[2] || 1)).toFixed(6)), structuralPoint: { x: Number(structuralPoint.x.toFixed(6)), y: Number(structuralPoint.y.toFixed(6)), z: 0 } });
  }
  return { callouts, issues };
}

function boundsFor(lines) {
  const points = lines.flatMap((line) => [line.startPoint, line.endPoint]);
  return { minX: Math.min(...points.map((pointValue) => pointValue.x)), minY: Math.min(...points.map((pointValue) => pointValue.y)), maxX: Math.max(...points.map((pointValue) => pointValue.x)), maxY: Math.max(...points.map((pointValue) => pointValue.y)) };
}

function renderSvg({ lines, bounds, callouts, transform }) {
  const width = 1600; const height = 520; const pad = 56; const scale = Math.min((width - 2 * pad) / (bounds.maxX - bounds.minX), (height - 150) / (bounds.maxY - bounds.minY));
  const x = (value) => pad + (value - bounds.minX) * scale; const y = (value) => height - pad - (value - bounds.minY) * scale;
  const linework = lines.filter((line) => line.layer === 'S-BEAM' || line.layer === 'S-FNDN').map((line) => `<line x1="${x(line.startPoint.x).toFixed(2)}" y1="${y(line.startPoint.y).toFixed(2)}" x2="${x(line.endPoint.x).toFixed(2)}" y2="${y(line.endPoint.y).toFixed(2)}" stroke="${line.layer === 'S-BEAM' ? '#22d3ee' : '#64748b'}" stroke-width="0.9"/>`).join('');
  const colorForRate = (rate) => ({ 0.25: '#a78bfa', 0.5: '#fbbf24', 2: '#fb7185' }[rate] || '#f8fafc');
  const countForRate = (rate) => callouts.filter((callout) => callout.inchesPerFoot === rate).length;
  const markers = callouts.map((callout) => `<circle cx="${x(callout.structuralPoint.x).toFixed(2)}" cy="${y(callout.structuralPoint.y).toFixed(2)}" r="5" fill="${colorForRate(callout.inchesPerFoot)}" stroke="#fff" stroke-width="1"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-121 to S-190 roof slope registration"><rect width="100%" height="100%" fill="#07111f"/><g>${linework}</g><g>${markers}</g><rect x="18" y="16" width="1564" height="76" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="43" fill="#e2e8f0" font-size="17" font-family="Arial">COOPERATIVE 1881 — A-121 ROOF SLOPE CALLOUT TARGETS REGISTERED ON NATIVE S-190</text><text x="34" y="67" fill="#fbbf24" font-size="13" font-family="Arial">${callouts.length} explicit source callouts · grid residual x ${transform.x.maxResidual} / y ${transform.y.maxResidual} native units · no roof surface/member elevation/clearance claim</text><text x="34" y="88" fill="#cbd5e1" font-size="12" font-family="Arial"><tspan fill="#a78bfa">● ${countForRate(0.25)} at 1/4 in/ft</tspan><tspan dx="22" fill="#fbbf24">● ${countForRate(0.5)} at 1/2 in/ft</tspan><tspan dx="22" fill="#fb7185">● ${countForRate(2)} at 2 in/ft</tspan></text><text x="34" y="${height - 20}" fill="#94a3b8" font-size="12" font-family="Arial">cyan S-BEAM · gray S-FNDN · rate-colored A-121 targets only; full source handles and text remain in the JSON receipt</text></svg>`;
}

async function readDwg(libredwg, sourcePath, expectedSha256) {
  const bytes = fs.readFileSync(sourcePath); const actualSha256 = sha256(bytes); const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try { const converted = libredwg.convertEx(raw); return { fileName: path.basename(sourcePath), sha256: actualSha256, expectedSha256, parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: Number(converted.stats.unknownEntityCount || 0), entities: converted.database.entities }; } finally { libredwg.dwg_free(raw); }
}

export async function extractCooperative1881RoofSlopeRegistration({ cadRoot = process.env.HALOFIRE_1881_CAD_ROOT || DEFAULT_CAD_ROOT } = {}) {
  const libredwg = await LibreDwg.create(`${path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/')}/`);
  const architectural = await readDwg(libredwg, path.join(cadRoot, A121), A121_SHA256); const structural = await readDwg(libredwg, path.join(cadRoot, S190), S190_SHA256);
  const issues = [];
  for (const source of [architectural, structural]) { if (source.sha256 !== source.expectedSha256) issues.push(issue('ROOF_SLOPE_SOURCE_HASH_MISMATCH', `${source.fileName} does not match its sealed source hash.`, [source.expectedSha256, source.sha256])); if (source.unknownEntityCount !== 0) issues.push(issue('ROOF_SLOPE_DWG_UNKNOWN_ENTITY', `${source.fileName} has unknown native DWG entities.`, [source.fileName])); }
  const architecturalControls = architecturalGridControls(architectural.entities); const structuralControls = structuralGridControls(structural.entities);
  const numericPairs = sharedPairs(architecturalControls.numeric, structuralControls.numeric); const letterPairs = sharedPairs(architecturalControls.letters, structuralControls.letters);
  const transform = { x: fitAxisTransform(numericPairs), y: fitAxisTransform(letterPairs) };
  if (!transform.x || !transform.y) issues.push(issue('ROOF_SLOPE_GRID_REGISTRATION_INSUFFICIENT', 'A-121 and S-190 do not have enough shared, explicit grid identities for a two-axis registration.'));
  if (transform.x && transform.y && (transform.x.maxResidual > 2 || transform.y.maxResidual > 2)) issues.push(issue('ROOF_SLOPE_GRID_REGISTRATION_RESIDUAL_EXCESSIVE', 'The explicit shared-grid registration residual exceeds two native drawing units.', [String(transform.x.maxResidual), String(transform.y.maxResidual)]));
  const lines = structural.entities.filter((entity) => entity.type === 'LINE' && ROOF_LINE_LAYERS.has(entity.layer)).map((entity) => ({ handle: String(entity.handle), layer: entity.layer, startPoint: point(entity.startPoint), endPoint: point(entity.endPoint) })).filter((line) => line.startPoint && line.endPoint);
  const bounds = lines.length ? boundsFor(lines) : null; if (!bounds) issues.push(issue('S190_ROOF_LINEWORK_MISSING', 'S-190 roof-plan source linework is unavailable.'));
  const extracted = transform.x && transform.y && bounds ? extractSlopeCallouts(architectural.entities, transform, bounds) : { callouts: [], issues: [] }; issues.push(...extracted.issues); if (!extracted.callouts.length) issues.push(issue('A121_SLOPE_CALLOUTS_UNRESOLVED', 'No A-121 slope callout target could be registered into S-190 coordinates.'));
  const artifact = { artifactType: 'halofire.cooperative-1881-roof-slope-registration.v1', projectName: 'The Cooperative 1881 - Salt Lake City UT', cadRoot, status: issues.length ? 'blocked' : 'passed', sources: { architectural: { fileName: architectural.fileName, sha256: architectural.sha256, parser: architectural.parser, unknownEntityCount: architectural.unknownEntityCount }, structural: { fileName: structural.fileName, sha256: structural.sha256, parser: structural.parser, unknownEntityCount: structural.unknownEntityCount } }, gridRegistration: { numericPairs, letterPairs, transform }, callouts: extracted.callouts, issues, claims: { crossPlanGridRegistrationReady: Boolean(transform.x && transform.y && !issues.some((entry) => entry.code.includes('GRID_REGISTRATION'))), sourceSlopeCalloutsRegistered: Boolean(extracted.callouts.length && !issues.length), roofSurfaceReconstructionReady: false, perMemberVerticalDatumReady: false, exactPhysicalFramingPromoted: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false }, limitations: ['A slope callout leader identifies a source target location, not a roof-face boundary or a slope direction vector.', 'This registration does not infer roof surface geometry, member association, elevation, obstruction clearance, pipe route, fabrication, code, employee, or VPS release.'] };
  return { artifact, svg: !issues.length && bounds ? renderSvg({ lines, bounds, callouts: extracted.callouts, transform }) : null };
}

async function main() { const { artifact, svg } = await extractCooperative1881RoofSlopeRegistration(); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, calloutCount: artifact.callouts.length, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
