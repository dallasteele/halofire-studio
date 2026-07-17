/**
 * Register only exact native C1 story-marker level lines and roof-profile contacts.
 * A nearby profile is deliberately not a contact and cannot create a roof plane.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_CAD_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files';
const A307 = 'arch/A-307 BUILDING SECTIONS.dwg';
const A307_SHA256 = '070F4766DB2FCD0D62E828AE70418BD205722FE9DC79EF95DDBDB61174B69162';
const BINDING_PATH = path.join(APP, 'src/data/cooperative-1881-a307-c1-view-binding.json');
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-a307-c1-profile-datum-contact.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-a307-c1-profile-datum-contact.svg');
const EPSILON = 0.000001;

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
function round(value) { return Number(value.toFixed(6)); }
function point(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) } : null; }
function same(value, expected) { return Math.abs(value - expected) <= EPSILON; }
function samePoint(left, right) { return Boolean(left && right && Math.hypot(left.x - right.x, left.y - right.y) <= EPSILON); }
function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function hold(code, message, refs = []) { return { code, severity: 'hold', message, refs }; }
function inside(bounds, value) { return Boolean(value) && value.x >= bounds.minX - EPSILON && value.x <= bounds.maxX + EPSILON && value.y >= bounds.minY - EPSILON && value.y <= bounds.maxY + EPSILON; }

function cross(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a, b, p) { return Math.abs(cross(a, b, p)) <= EPSILON && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON; }

/** Exact closed-segment intersection, including a shared source endpoint. */
export function segmentsTouch(left, right) {
  const a = point(left.start); const b = point(left.end); const c = point(right.start); const d = point(right.end);
  if (!a || !b || !c || !d) return false;
  const abC = cross(a, b, c); const abD = cross(a, b, d); const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/**
 * The native story marker encodes one level label as [vertical line, level line,
 * circle, text]. This verifies that exact local sequence, rather than choosing a
 * geometrically nearest line elsewhere in the section.
 */
export function resolveNativeMarkerLevelLine(annotation, entities, bounds) {
  const index = entities.findIndex((entry) => String(entry.handle) === String(annotation.sourceHandle));
  if (index < 3) return { ok: false, reason: 'MARKER_TEXT_SEQUENCE_MISSING' };
  const vertical = entities[index - 3]; const line = entities[index - 2]; const circle = entities[index - 1];
  const label = point(annotation.sourcePoint); const start = point(line?.startPoint); const end = point(line?.endPoint);
  const structuralSequence = vertical?.type === 'LINE' && line?.type === 'LINE' && circle?.type === 'CIRCLE';
  const horizontal = start && end && same(start.y, end.y) && !same(start.x, end.x);
  const labelAnchor = label && (same(start.x, label.x) || same(end.x, label.x));
  // NCS offsets the vertical guide from the text anchor. The source-backed link
  // is the immediately preceding [vertical, level, circle, text] entity run;
  // requiring coincident guide/text X would reject that native drafting pattern.
  const verticalStart = point(vertical?.startPoint); const verticalEnd = point(vertical?.endPoint);
  const verticalGuide = verticalStart && verticalEnd && same(verticalStart.x, verticalEnd.x) && !same(verticalStart.y, verticalEnd.y);
  if (!structuralSequence || !horizontal || !labelAnchor || !verticalGuide || !inside(bounds, start) || !inside(bounds, end)) return { ok: false, reason: 'MARKER_LEVEL_LINE_SEQUENCE_UNVERIFIED' };
  return { ok: true, sourceLineHandle: String(line.handle), sourceCircleHandle: String(circle.handle), sourceVerticalGuideHandle: String(vertical.handle), start: { x: round(start.x), y: round(start.y), z: round(start.z) }, end: { x: round(end.x), y: round(end.y), z: round(end.z) } };
}

async function parseDwg(sourcePath) {
  const bytes = fs.readFileSync(sourcePath); const libredwg = await LibreDwg.create(`${path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/')}/`); const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try { const converted = libredwg.convertEx(raw); return { sha256: sha256(bytes), unknownEntityCount: Number(converted.stats.unknownEntityCount || 0), database: converted.database }; } finally { libredwg.dwg_free(raw); }
}

function renderSvg(receipt) {
  const profile = receipt.roofProfileSegments; const levels = receipt.datumBindings.filter((entry) => entry.levelLine).map((entry) => entry.levelLine); const points = profile.flatMap((entry) => [entry.start, entry.end]).concat(levels.flatMap((entry) => [entry.start, entry.end]));
  const minX = Math.min(...points.map((entry) => entry.x)); const maxX = Math.max(...points.map((entry) => entry.x)); const minY = Math.min(...points.map((entry) => entry.y)); const maxY = Math.max(...points.map((entry) => entry.y)); const width = 1600; const height = 760; const view = { x: 24, y: 124, width: 1030, height: 598 }; const scale = Math.min((view.width - 72) / (maxX - minX || 1), (view.height - 120) / (maxY - minY || 1)); const originX = view.x + (view.width - (maxX - minX) * scale) / 2 - minX * scale; const originY = view.y + (view.height - (maxY - minY) * scale) / 2 + maxY * scale; const x = (value) => originX + value * scale; const y = (value) => originY - value * scale;
  const profileLines = profile.map((entry) => `<line x1="${x(entry.start.x).toFixed(2)}" y1="${y(entry.start.y).toFixed(2)}" x2="${x(entry.end.x).toFixed(2)}" y2="${y(entry.end.y).toFixed(2)}" stroke="#22d3ee" stroke-width="2"><title>native roof profile ${entry.sourceLineHandle}</title></line>`).join('');
  const levelLines = receipt.datumBindings.map((entry) => entry.levelLine ? `<line x1="${x(entry.levelLine.start.x).toFixed(2)}" y1="${y(entry.levelLine.start.y).toFixed(2)}" x2="${x(entry.levelLine.end.x).toFixed(2)}" y2="${y(entry.levelLine.end.y).toFixed(2)}" stroke="#fbbf24" stroke-width="2" stroke-dasharray="7 5"><title>${entry.kind} native marker level ${entry.levelLine.sourceLineHandle}</title></line>` : '').join('');
  const rows = receipt.datumBindings.map((entry, index) => `<text x="1110" y="${337 + index * 76}" fill="#fbbf24" font-size="14" font-family="Arial">${entry.kind.toUpperCase()}</text><text x="1110" y="${359 + index * 76}" fill="#cbd5e1" font-size="12" font-family="Arial">${entry.elevationText} · level line ${entry.levelLine?.sourceLineHandle || 'unresolved'}</text><text x="1110" y="${379 + index * 76}" fill="#fb7185" font-size="12" font-family="Arial">${entry.profileContacts.length} exact profile contacts · hold</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-307 C1 profile datum contact receipt"><rect width="100%" height="100%" fill="#07111f"/><rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" rx="10" fill="#0b1a2d" stroke="#334155"/><g>${profileLines}${levelLines}</g><rect x="18" y="16" width="1564" height="82" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="45" fill="#e2e8f0" font-size="18" font-family="Arial">COOPERATIVE 1881 — A-307 C1 NATIVE DATUM-TO-PROFILE CONTACT RECEIPT</text><text x="34" y="70" fill="#fbbf24" font-size="13" font-family="Arial">Cyan = native roof profile · dashed amber = native story-marker level line · exact contact required</text><text x="34" y="91" fill="#cbd5e1" font-size="12" font-family="Arial">No dashed amber line touches a cyan profile edge; this is an evidence hold, not a reconstructed roof surface.</text><rect x="1082" y="124" width="494" height="598" rx="10" fill="#10243a" stroke="#334155"/><text x="1110" y="164" fill="#e2e8f0" font-size="18" font-family="Arial">CONTACT RECEIPT</text><text x="1110" y="207" fill="#fb7185" font-size="26" font-family="Arial">${receipt.counts.exactContacts} exact contacts</text><text x="1110" y="231" fill="#cbd5e1" font-size="13" font-family="Arial">out of ${receipt.counts.datums} native datum lines</text><line x1="1110" y1="289" x2="1544" y2="289" stroke="#334155"/>${rows}<line x1="1110" y1="536" x2="1544" y2="536" stroke="#334155"/><text x="1110" y="566" fill="#f8fafc" font-size="14" font-family="Arial">What stays blocked</text><text x="1110" y="591" fill="#fbbf24" font-size="13" font-family="Arial">roof plane · member placement · sprinkler heads</text><text x="1110" y="615" fill="#fbbf24" font-size="13" font-family="Arial">pipes · fabrication · code · employee/VPS use</text><text x="34" y="746" fill="#94a3b8" font-size="12" font-family="Arial">The receipt uses native entity sequence and closed-segment contact only; it does not choose the nearest roof profile.</text></svg>`;
}

export async function extractCooperative1881A307C1ProfileDatumContact({ cadRoot = process.env.HALOFIRE_1881_CAD_ROOT || DEFAULT_CAD_ROOT, binding = null } = {}) {
  const parent = binding || JSON.parse(fs.readFileSync(BINDING_PATH, 'utf8')); const parsed = await parseDwg(path.join(cadRoot, A307)); const issues = []; const holds = [];
  if (parsed.sha256 !== A307_SHA256) issues.push(issue('A307_C1_CONTACT_SOURCE_HASH_MISMATCH', 'A-307 source digest differs from the sealed C1 source.', [A307_SHA256, parsed.sha256]));
  if (parsed.unknownEntityCount !== 0) issues.push(issue('A307_C1_CONTACT_UNKNOWN_ENTITY', 'A-307 contains unknown native DWG entities.', [String(parsed.unknownEntityCount)]));
  if (parent.status !== 'passed' || parent.sources?.architectural?.sha256 !== A307_SHA256 || !parent.claims?.viewportLocalRoofProfileRegistered || !parent.claims?.viewportLocalRoofDatumAnnotationsRegistered) issues.push(issue('A307_C1_PARENT_BINDING_UNVERIFIED', 'The prior C1 source binding is not sealed and complete enough for contact evaluation.'));
  const markerName = `${String(parent.drawingTitle?.drawingName || '').toUpperCase()}_STORY_MARKER`; const marker = parsed.database.tables.BLOCK_RECORD.entries.find((entry) => String(entry.name) === markerName); if (!marker) issues.push(issue('A307_C1_STORY_MARKER_MISSING', 'The exact C1 story-marker block is absent.', [markerName]));
  const bounds = parent.viewport?.modelBounds; if (!bounds) issues.push(issue('A307_C1_CONTACT_VIEWPORT_BOUNDS_MISSING', 'The source-bound C1 model-space viewport bounds are missing.'));
  const annotations = (parent.verticalDatumAnnotations || []).filter((entry) => entry.kind === 'roof-eave' || entry.kind === 'roof-ridge'); const datumBindings = [];
  for (const annotation of annotations) {
    const resolved = marker && bounds ? resolveNativeMarkerLevelLine(annotation, marker.entities || [], bounds) : { ok: false, reason: 'MARKER_OR_VIEWPORT_UNAVAILABLE' };
    if (!resolved.ok) { issues.push(issue('A307_C1_DATUM_LEVEL_LINE_UNRESOLVED', 'A roof datum cannot be linked to an exact native marker level line.', [annotation.sourceHandle, resolved.reason])); datumBindings.push({ kind: annotation.kind, elevationText: annotation.elevationText, annotationSourceHandle: annotation.sourceHandle, levelLine: null, profileContacts: [] }); continue; }
    const levelLine = { sourceLineHandle: resolved.sourceLineHandle, sourceCircleHandle: resolved.sourceCircleHandle, sourceVerticalGuideHandle: resolved.sourceVerticalGuideHandle, start: resolved.start, end: resolved.end }; const profileContacts = (parent.roofProfileSegments || []).filter((entry) => segmentsTouch(levelLine, entry)).map((entry) => ({ sourceLineHandle: entry.sourceLineHandle, sourceBlockName: entry.sourceBlockName }));
    if (!profileContacts.length) holds.push(hold('A307_C1_DATUM_PROFILE_NO_EXACT_CONTACT', 'The native datum level line does not geometrically contact a native C1 roof-profile edge; proximity cannot promote a roof plane.', [annotation.sourceHandle, levelLine.sourceLineHandle]));
    datumBindings.push({ kind: annotation.kind, elevationText: annotation.elevationText, signedFeet: annotation.signedFeet, annotationSourceHandle: annotation.sourceHandle, levelLine, profileContacts });
  }
  if (datumBindings.length !== 2) issues.push(issue('A307_C1_ROOF_DATUM_COUNT_UNRESOLVED', 'C1 must provide exactly one eave and one ridge datum for this receipt.', [String(datumBindings.length)]));
  const exactContacts = datumBindings.reduce((count, entry) => count + entry.profileContacts.length, 0); const nativeDatumLevelLineRegistered = !issues.length && datumBindings.length === 2 && datumBindings.every((entry) => entry.levelLine); const exactDatumToProfileContactRegistered = nativeDatumLevelLineRegistered && datumBindings.every((entry) => entry.profileContacts.length > 0);
  const artifact = { artifactType: 'halofire.cooperative-1881-a307-c1-profile-datum-contact.v1', projectName: parent.projectName, status: issues.length ? 'blocked' : 'passed', sources: { architectural: { fileName: path.basename(A307), sha256: parsed.sha256, expectedSha256: A307_SHA256, parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: parsed.unknownEntityCount }, parentBinding: { fileName: path.basename(BINDING_PATH), sourceSha256: parent.sources?.architectural?.sha256 || null, artifactType: parent.artifactType || null } }, sourceView: { detailReference: parent.drawingTitle?.detailReference || null, sheetReference: parent.drawingTitle?.sheetReference || null, viewportSourceHandle: parent.viewport?.sourceHandle || null, storyMarkerName: markerName, storyMarkerSourceHandle: marker ? String(marker.handle) : null }, roofProfileSegments: parent.roofProfileSegments || [], datumBindings, counts: { datums: datumBindings.length, nativeLevelLines: datumBindings.filter((entry) => entry.levelLine).length, exactContacts }, holds, issues, claims: { nativeDatumLevelLineRegistered, exactDatumToProfileContactRegistered, profileEdgeToDatumBound: exactDatumToProfileContactRegistered, slopeDirectionReady: false, planRegionToSectionViewReady: false, roofSurfaceReconstructionReady: false, perMemberVerticalDatumReady: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false }, limitations: ['Exact contact is required; a level line that is merely near a roof profile does not establish an elevation-to-edge binding.', 'This receipt does not assign a section to any plural-covered plan region or derive a plan slope direction.', 'No roof surface, structural member, sprinkler, pipe, clearance, fabrication, code, employee-use, or VPS-release claim is made.'] };
  return { artifact, svg: !issues.length ? renderSvg(artifact) : null };
}

async function main() { const { artifact, svg } = await extractCooperative1881A307C1ProfileDatumContact(); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, counts: artifact.counts, holds: artifact.holds, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
