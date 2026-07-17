/**
 * Register the explicit A-121 cutting-plane references over canonical A-121
 * roof regions. Coverage is source-plan geometry only: it does not select a
 * section view, infer a direction/elevation, or produce a roof plane.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { strictlyContainsPoint } from './extract-cooperative-1881-a121-slope-boundary-association.mjs';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_CAD_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files';
const A121 = 'arch/A-121 ROOF PLAN.dwg';
const A121_SHA256 = 'FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606';
const ASSOCIATION_PATH = path.join(APP, 'src/data/cooperative-1881-a121-slope-boundary-association.json');
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-a121-section-cut-coverage.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-a121-section-cut-coverage.svg');
const EPSILON = 0.000001;

function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
function round(value) { return Number(value.toFixed(6)); }
function point(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) } : null; }
function samePoint(left, right) { return Math.hypot(left.x - right.x, left.y - right.y) <= EPSILON; }
function plainText(value) { return String(value?.text?.text ?? value?.text ?? value ?? '').replace(/\\[A-Za-z][^;]*;/g, '').replaceAll('\\P', ' ').replaceAll(/[{}]/g, '').replace(/\s+/g, ' ').trim(); }

function cross(left, right) { return left.x * right.y - left.y * right.x; }
function subtract(left, right) { return { x: left.x - right.x, y: left.y - right.y }; }
function clampUnit(value) { return Math.max(0, Math.min(1, value)); }
function uniqueSorted(values) { return [...new Set(values.map((value) => round(clampUnit(value))))].sort((left, right) => left - right); }

/** Return every source-segment parameter that touches one polygon edge. */
export function edgeContactParameters(start, end, edgeStart, edgeEnd) {
  const direction = subtract(end, start); const edgeDirection = subtract(edgeEnd, edgeStart); const denominator = cross(direction, edgeDirection); const between = subtract(edgeStart, start);
  if (Math.abs(denominator) > EPSILON) {
    const alongSource = cross(between, edgeDirection) / denominator;
    const alongEdge = cross(between, direction) / denominator;
    return alongSource >= -EPSILON && alongSource <= 1 + EPSILON && alongEdge >= -EPSILON && alongEdge <= 1 + EPSILON ? [alongSource] : [];
  }
  if (Math.abs(cross(between, direction)) > EPSILON) return [];
  const lengthSquared = direction.x ** 2 + direction.y ** 2;
  if (lengthSquared <= EPSILON) return [];
  return [
    ((edgeStart.x - start.x) * direction.x + (edgeStart.y - start.y) * direction.y) / lengthSquared,
    ((edgeEnd.x - start.x) * direction.x + (edgeEnd.y - start.y) * direction.y) / lengthSquared,
  ].filter((value) => value >= -EPSILON && value <= 1 + EPSILON);
}

/**
 * A boundary touch does not constitute section coverage. The source segment
 * must have a non-zero interval inside the polygon. This prevents a cut that
 * merely kisses a roof edge from becoming an arbitrary roof-plane selection.
 */
export function classifySegmentPolygonContact(start, end, vertices) {
  const parameters = [0, 1];
  for (let index = 0; index < vertices.length; index += 1) parameters.push(...edgeContactParameters(start, end, vertices[index], vertices[(index + 1) % vertices.length]));
  const cuts = uniqueSorted(parameters); const insideIntervals = [];
  for (let index = 1; index < cuts.length; index += 1) {
    const from = cuts[index - 1]; const to = cuts[index];
    if (to - from <= EPSILON) continue;
    const middle = (from + to) / 2;
    const sample = { x: start.x + (end.x - start.x) * middle, y: start.y + (end.y - start.y) * middle };
    if (strictlyContainsPoint(vertices, sample)) insideIntervals.push({ from: round(from), to: round(to) });
  }
  if (insideIntervals.length) return { kind: 'interior', intervals: insideIntervals };
  return cuts.length > 2 || strictlyContainsPoint(vertices, start) || strictlyContainsPoint(vertices, end) ? { kind: 'boundary-only', intervals: [] } : { kind: 'none', intervals: [] };
}

function extractCuttingPlanes(database, issues) {
  const blocks = new Map(database.tables.BLOCK_RECORD.entries.map((block) => [String(block.name), block]));
  const inserts = database.entities.filter((entity) => entity.type === 'INSERT' && /^Cutting Plane_\d+_2$/.test(String(entity.name || ''))).sort((left, right) => String(left.name).localeCompare(String(right.name), undefined, { numeric: true }));
  const planes = [];
  for (const insert of inserts) {
    const name = String(insert.name); const block = blocks.get(name); const insertion = point(insert.insertionPoint); const base = point(block?.basePoint);
    if (!block || !insertion || !base || !samePoint(insertion, base) || Number(insert.rotationAngle || 0) !== 0 || Number(insert.xScale || 1) !== 1 || Number(insert.yScale || 1) !== 1) {
      issues.push(issue('A121_CUTTING_PLANE_TRANSFORM_UNSUPPORTED', `${name} is not an identity-transformed native cutting-plane block.`, [String(insert.handle), String(block?.handle || '')]));
      continue;
    }
    const lines = (block.entities || []).filter((entity) => entity.type === 'LINE').map((entity) => ({ handle: String(entity.handle), start: point(entity.startPoint), end: point(entity.endPoint) }))
      .filter((line) => line.start && line.end).map((line) => ({ ...line, lengthNative: Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) })).sort((left, right) => right.lengthNative - left.lengthNative);
    const texts = [...new Set((block.entities || []).filter((entity) => entity.type === 'TEXT' || entity.type === 'MTEXT').map(plainText).filter(Boolean))];
    const detailReference = texts.find((text) => /^[A-Z]\d+$/.test(text)); const sheetReference = texts.find((text) => /^[A-Z]-\d+[A-Za-z]?$/.test(text));
    if (!lines[0] || !detailReference || !sheetReference) {
      issues.push(issue('A121_CUTTING_PLANE_REFERENCE_UNRESOLVED', `${name} must carry a native line plus a detail and sheet reference.`, [String(insert.handle), String(block.handle)]));
      continue;
    }
    planes.push({
      id: `a121-${name.toLowerCase().replaceAll(' ', '-').replaceAll('_', '-')}`,
      sourceBlockName: name,
      sourceBlockRecordHandle: String(block.handle),
      sourceInsertHandle: String(insert.handle),
      detailReference, sheetReference,
      line: { handle: lines[0].handle, start: { x: round(lines[0].start.x), y: round(lines[0].start.y), z: round(lines[0].start.z) }, end: { x: round(lines[0].end.x), y: round(lines[0].end.y), z: round(lines[0].end.z) }, lengthNative: round(lines[0].lengthNative) },
    });
  }
  if (inserts.length !== 10) issues.push(issue('A121_CUTTING_PLANE_COUNT_DRIFT', 'A-121 must retain exactly ten native Cutting Plane_*_2 INSERT entities.', [String(inserts.length)]));
  return planes;
}

function coverageForRegion(region, planes) {
  const contacts = planes.map((plane) => ({ planeId: plane.id, detailReference: plane.detailReference, sheetReference: plane.sheetReference, contact: classifySegmentPolygonContact(plane.line.start, plane.line.end, region.vertices) }));
  return { canonicalRegionId: region.id, interiorCoverage: contacts.filter((entry) => entry.contact.kind === 'interior'), boundaryOnlyContacts: contacts.filter((entry) => entry.contact.kind === 'boundary-only') };
}

function renderSvg(regions, planes, coverage, targetCoverage) {
  const sourcePoints = regions.flatMap((region) => region.vertices); const minX = Math.min(...sourcePoints.map((value) => value.x)); const maxX = Math.max(...sourcePoints.map((value) => value.x)); const minY = Math.min(...sourcePoints.map((value) => value.y)); const maxY = Math.max(...sourcePoints.map((value) => value.y)); const rotate = maxY - minY > maxX - minX; const proofPoint = (value) => rotate ? { x: value.y, y: -value.x } : value;
  const points = sourcePoints.map(proofPoint); const proofMinX = Math.min(...points.map((value) => value.x)); const proofMaxX = Math.max(...points.map((value) => value.x)); const proofMinY = Math.min(...points.map((value) => value.y)); const proofMaxY = Math.max(...points.map((value) => value.y)); const width = 1600; const height = 760; const plan = { x: 24, y: 124, width: 1030, height: 598 }; const scale = Math.min((plan.width - 64) / (proofMaxX - proofMinX), (plan.height - 64) / (proofMaxY - proofMinY)); const originX = plan.x + (plan.width - (proofMaxX - proofMinX) * scale) / 2 - proofMinX * scale; const originY = plan.y + (plan.height - (proofMaxY - proofMinY) * scale) / 2 + proofMaxY * scale; const x = (value) => originX + value * scale; const y = (value) => originY - value * scale;
  const covered = new Set(coverage.filter((entry) => entry.interiorCoverage.length).map((entry) => entry.canonicalRegionId)); const polygons = regions.map((region) => `<polygon points="${region.vertices.map(proofPoint).map((value) => `${x(value.x).toFixed(2)},${y(value.y).toFixed(2)}`).join(' ')}" fill="${covered.has(region.id) ? '#22d3ee' : '#475569'}" fill-opacity="${covered.has(region.id) ? '.16' : '.08'}" stroke="#64748b" stroke-width=".8"/>`).join('');
  const palette = ['#fbbf24', '#fb7185', '#a78bfa', '#34d399', '#60a5fa', '#f97316', '#e879f9', '#2dd4bf', '#facc15', '#94a3b8']; const lines = planes.map((plane, index) => { const start = proofPoint(plane.line.start); const end = proofPoint(plane.line.end); return `<line x1="${x(start.x).toFixed(2)}" y1="${y(start.y).toFixed(2)}" x2="${x(end.x).toFixed(2)}" y2="${y(end.y).toFixed(2)}" stroke="${palette[index]}" stroke-width="2.2"><title>${plane.detailReference}/${plane.sheetReference}</title></line>`; }).join('');
  const selected = targetCoverage.filter((entry) => entry.status === 'blocked-non-unique').length; const withoutCoverage = targetCoverage.filter((entry) => entry.status === 'blocked-no-interior-coverage').length;
  const referenceLegend = planes.map((plane, index) => { const column = index < 5 ? 0 : 1; const row = index % 5; return `<text x="${1110 + column * 214}" y="${625 + row * 18}" fill="${palette[index]}" font-size="11" font-family="Arial">${plane.detailReference}/${plane.sheetReference}</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-121 cutting plane source coverage"><rect width="100%" height="100%" fill="#07111f"/><rect x="${plan.x}" y="${plan.y}" width="${plan.width}" height="${plan.height}" rx="10" fill="#0b1a2d" stroke="#334155"/><g>${polygons}</g><g>${lines}</g><rect x="18" y="16" width="1564" height="82" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="45" fill="#e2e8f0" font-size="18" font-family="Arial">COOPERATIVE 1881 — A-121 CUTTING-PLANE COVERAGE OF SOURCE ROOF REGIONS</text><text x="34" y="70" fill="#fbbf24" font-size="13" font-family="Arial">${planes.length} exact native cut references · ${regions.length} canonical regions · colored lines are source cuts, not roof directions</text><text x="34" y="91" fill="#cbd5e1" font-size="12" font-family="Arial">Cyan = region receives at least one non-zero interior cut interval; no one section is selected from plural coverage</text><text x="48" y="148" fill="#94a3b8" font-size="12" font-family="Arial">NATIVE PLAN VIEW${rotate ? ' · ROTATED 90° FOR LEGIBILITY' : ''}</text><rect x="1082" y="124" width="494" height="598" rx="10" fill="#10243a" stroke="#334155"/><text x="1110" y="164" fill="#e2e8f0" font-size="18" font-family="Arial">SOURCE COVERAGE RECEIPT</text><text x="1110" y="207" fill="#22d3ee" font-size="26" font-family="Arial">${targetCoverage.length}</text><text x="1110" y="230" fill="#cbd5e1" font-size="13" font-family="Arial">slope targets inspected after region association</text><text x="1110" y="278" fill="#fbbf24" font-size="26" font-family="Arial">${selected}</text><text x="1110" y="301" fill="#cbd5e1" font-size="13" font-family="Arial">resolved targets have plural cut coverage</text><text x="1110" y="349" fill="#fb7185" font-size="26" font-family="Arial">${withoutCoverage}</text><text x="1110" y="372" fill="#cbd5e1" font-size="13" font-family="Arial">resolved targets lack interior cut coverage</text><line x1="1110" y1="405" x2="1544" y2="405" stroke="#334155"/><text x="1110" y="440" fill="#f8fafc" font-size="14" font-family="Arial">What this proves</text><text x="1110" y="465" fill="#cbd5e1" font-size="13" font-family="Arial">Explicit plan-cut/view references cover source regions.</text><text x="1110" y="511" fill="#f8fafc" font-size="14" font-family="Arial">What remains blocked</text><text x="1110" y="536" fill="#fbbf24" font-size="13" font-family="Arial">section selection · slope direction · roof plane</text><text x="1110" y="560" fill="#fbbf24" font-size="13" font-family="Arial">elevation · members · heads · pipes · code</text><text x="1110" y="599" fill="#f8fafc" font-size="12" font-family="Arial">NATIVE REFERENCES</text>${referenceLegend}<text x="34" y="746" fill="#94a3b8" font-size="12" font-family="Arial">A boundary touch alone is excluded. This receipt requires a non-zero interior segment interval and never uses nearest-cut heuristics.</text></svg>`;
}

async function parseA121(sourcePath) {
  const bytes = fs.readFileSync(sourcePath); const libredwg = await LibreDwg.create(`${path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/')}/`); const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try { const converted = libredwg.convertEx(raw); return { sha256: sha256(bytes), unknownEntityCount: Number(converted.stats.unknownEntityCount || 0), database: converted.database }; } finally { libredwg.dwg_free(raw); }
}

export async function extractCooperative1881A121SectionCutCoverage({ cadRoot = process.env.HALOFIRE_1881_CAD_ROOT || DEFAULT_CAD_ROOT, association = null } = {}) {
  const parsed = await parseA121(path.join(cadRoot, A121)); const sourceAssociation = association || JSON.parse(fs.readFileSync(ASSOCIATION_PATH, 'utf8')); const issues = [];
  if (parsed.sha256 !== A121_SHA256) issues.push(issue('A121_CUTTING_PLANE_SOURCE_HASH_MISMATCH', 'A-121 does not match its sealed source hash.', [A121_SHA256, parsed.sha256]));
  if (parsed.unknownEntityCount !== 0) issues.push(issue('A121_CUTTING_PLANE_DWG_UNKNOWN_ENTITY', 'A-121 contains unknown native DWG entities.', [String(parsed.unknownEntityCount)]));
  if (sourceAssociation.status !== 'passed' || sourceAssociation.sources?.architectural?.sha256 !== parsed.sha256) issues.push(issue('A121_CUTTING_PLANE_ASSOCIATION_UNTRUSTED', 'The canonical region association is not passed or is not sealed to the same A-121 source.', [String(sourceAssociation.sources?.architectural?.sha256), parsed.sha256]));
  const planes = extractCuttingPlanes(parsed.database, issues); const regions = sourceAssociation.canonicalRegions || []; const coverage = regions.map((region) => coverageForRegion(region, planes)); const coverageByRegion = new Map(coverage.map((entry) => [entry.canonicalRegionId, entry]));
  const targetCoverage = (sourceAssociation.associations || []).map((entry) => {
    if (entry.status !== 'resolved') return { slopeLabelHandle: entry.slopeCallout.labelHandle, associationStatus: entry.status, status: 'blocked-region-association', sectionReferences: [], issues: entry.issues };
    const regionCoverage = coverageByRegion.get(entry.canonicalRegionId); const refs = (regionCoverage?.interiorCoverage || []).map((contact) => ({ planeId: contact.planeId, detailReference: contact.detailReference, sheetReference: contact.sheetReference }));
    const status = refs.length === 1 ? 'single-source-reference-only' : refs.length ? 'blocked-non-unique' : 'blocked-no-interior-coverage';
    const targetIssues = status === 'single-source-reference-only' ? [] : [issue(status === 'blocked-non-unique' ? 'A121_SLOPE_REGION_SECTION_REFERENCE_NON_UNIQUE' : 'A121_SLOPE_REGION_SECTION_REFERENCE_MISSING', status === 'blocked-non-unique' ? 'Multiple issued cutting-plane references cross the associated source region; no section is selected.' : 'No issued cutting-plane source segment crosses the associated source region interior.', [entry.slopeCallout.labelHandle, entry.canonicalRegionId, ...refs.map((ref) => ref.planeId)])];
    return { slopeLabelHandle: entry.slopeCallout.labelHandle, associationStatus: entry.status, canonicalRegionId: entry.canonicalRegionId, status, sectionReferences: refs, issues: targetIssues };
  });
  const artifact = { artifactType: 'halofire.cooperative-1881-a121-section-cut-coverage.v1', projectName: sourceAssociation.projectName, status: issues.length ? 'blocked' : 'passed', sources: { architectural: { fileName: path.basename(A121), sha256: parsed.sha256, expectedSha256: A121_SHA256, parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: parsed.unknownEntityCount }, canonicalRegionAssociation: { fileName: path.basename(ASSOCIATION_PATH), sourceSha256: sourceAssociation.sources?.architectural?.sha256 } }, cuttingPlanes: planes, canonicalRegionCoverage: coverage, slopeTargetSectionCoverage: targetCoverage, issues, claims: { sourceCuttingPlanesRegistered: Boolean(planes.length && !issues.length), canonicalRegionInteriorCoverageReady: Boolean(coverage.length && !issues.length), sourceSlopeRegionSectionCoverageReady: Boolean(targetCoverage.length && !issues.length), uniqueSectionReferenceReady: targetCoverage.filter((entry) => entry.associationStatus === 'resolved').every((entry) => entry.status === 'single-source-reference-only'), slopeDirectionReady: false, roofSurfaceReconstructionReady: false, perMemberVerticalDatumReady: false, exactPhysicalFramingPromoted: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false }, limitations: ['A cutting-plane line records a source plan cut and its view reference only; it does not identify a roof-face direction or a vertical datum.', 'Plural coverage is intentionally not reduced with nearest-line, source-sheet-name, area, or visual heuristics.', 'Blocked slope-region associations remain blocked and receive no section-coverage assignment.', 'No roof plane, structural member, sprinkler, pipe, clearance, fabrication, code, employee, or VPS claim is made.'] };
  return { artifact, svg: !issues.length ? renderSvg(regions, planes, coverage, targetCoverage) : null };
}

async function main() { const { artifact, svg } = await extractCooperative1881A121SectionCutCoverage(); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, cuttingPlaneCount: artifact.cuttingPlanes.length, targets: artifact.slopeTargetSectionCoverage.length, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
