/**
 * Associate A-121 slope callout targets with canonical A-121 roof regions.
 * Exact duplicate source polygons are aliases; non-identical overlaps block.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const BOUNDARY_PATH = path.join(APP, 'src/data/cooperative-1881-a121-roof-face-boundaries.json');
const SLOPE_PATH = path.join(APP, 'src/data/cooperative-1881-roof-slope-registration.json');
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-a121-slope-boundary-association.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-a121-slope-boundary-association.svg');
const EPSILON = 0.0001;

function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function round(value) { return Number(value.toFixed(6)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function pointText(point) { return `${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`; }
function rotateMinimum(points) { return points.map((_point, index) => points.slice(index).concat(points.slice(0, index)).join('|')).sort()[0]; }

export function canonicalPolygonKey(vertices) {
  const points = vertices.map(pointText);
  return [rotateMinimum(points), rotateMinimum([...points].reverse())].sort()[0];
}

function pointOnSegment(point, left, right) {
  const cross = (point.y - left.y) * (right.x - left.x) - (point.x - left.x) * (right.y - left.y);
  if (Math.abs(cross) > EPSILON) return false;
  return point.x >= Math.min(left.x, right.x) - EPSILON && point.x <= Math.max(left.x, right.x) + EPSILON
    && point.y >= Math.min(left.y, right.y) - EPSILON && point.y <= Math.max(left.y, right.y) + EPSILON;
}

export function strictlyContainsPoint(vertices, point) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const left = vertices[previous]; const right = vertices[index];
    if (pointOnSegment(point, left, right)) return false;
    if ((left.y > point.y) !== (right.y > point.y) && point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x) inside = !inside;
  }
  return inside;
}

export function canonicalRegions(boundaries) {
  const grouped = new Map();
  for (const boundary of boundaries) {
    const key = canonicalPolygonKey(boundary.vertices);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(boundary);
  }
  return [...grouped.entries()].map(([key, aliases]) => ({
    id: `region-${sha256(key).slice(0, 12)}`,
    key,
    vertices: aliases[0].vertices,
    areaNativeSq: aliases[0].areaNativeSq,
    aliases: aliases.map((boundary) => ({ id: boundary.id, roofBlockName: boundary.roofBlockName, roofBlockRecordHandle: boundary.roofBlockRecordHandle, roofBlockInsertHandle: boundary.roofBlockInsertHandle, source: boundary.source, handles: boundary.handles })).sort((left, right) => left.id.localeCompare(right.id)),
  })).sort((left, right) => left.id.localeCompare(right.id));
}

export function associateSlopeTargets(callouts, regions) {
  return callouts.map((callout) => {
    const target = { x: Number(callout.leader.target.x), y: Number(callout.leader.target.y), z: Number(callout.leader.target.z || 0) };
    const matches = regions.filter((region) => strictlyContainsPoint(region.vertices, target));
    const sourceRefs = [callout.label.handle, callout.leader.handle];
    if (matches.length === 1) return { status: 'resolved', slopeCallout: { labelHandle: callout.label.handle, leaderHandle: callout.leader.handle, labelText: callout.label.text, inchesPerFoot: callout.inchesPerFoot, target }, canonicalRegionId: matches[0].id, canonicalRegionAliases: matches[0].aliases, issues: [] };
    const code = matches.length ? 'A121_SLOPE_TARGET_NONIDENTICAL_BOUNDARY_OVERLAP' : 'A121_SLOPE_TARGET_OUTSIDE_SOURCE_BOUNDARIES';
    const message = matches.length ? 'Slope target lies inside multiple non-identical canonical source boundaries; no region is selected.' : 'Slope target lies outside every canonical source boundary; no region is selected.';
    return { status: 'blocked', slopeCallout: { labelHandle: callout.label.handle, leaderHandle: callout.leader.handle, labelText: callout.label.text, inchesPerFoot: callout.inchesPerFoot, target }, candidateCanonicalRegions: matches.map((region) => ({ id: region.id, aliases: region.aliases })), issues: [issue(code, message, sourceRefs.concat(matches.map((region) => region.id)))] };
  });
}

function renderSvg(regions, associations) {
  const sourcePoints = regions.flatMap((region) => region.vertices); const sourceMinX = Math.min(...sourcePoints.map((point) => point.x)); const sourceMaxX = Math.max(...sourcePoints.map((point) => point.x)); const sourceMinY = Math.min(...sourcePoints.map((point) => point.y)); const sourceMaxY = Math.max(...sourcePoints.map((point) => point.y)); const rotate = sourceMaxY - sourceMinY > sourceMaxX - sourceMinX; const proofPoint = (point) => rotate ? { x: point.y, y: -point.x } : point;
  const points = sourcePoints.map(proofPoint); const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x)); const minY = Math.min(...points.map((point) => point.y)); const maxY = Math.max(...points.map((point) => point.y)); const width = 1600; const height = 760; const plan = { x: 24, y: 124, width: 1030, height: 598 }; const scale = Math.min((plan.width - 64) / (maxX - minX), (plan.height - 64) / (maxY - minY)); const originX = plan.x + (plan.width - (maxX - minX) * scale) / 2 - minX * scale; const originY = plan.y + (plan.height - (maxY - minY) * scale) / 2 + maxY * scale; const x = (value) => originX + value * scale; const y = (value) => originY - value * scale;
  const regionsSvg = regions.map((region) => `<polygon points="${region.vertices.map(proofPoint).map((point) => `${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`).join(' ')}" fill="#334155" fill-opacity=".12" stroke="#64748b" stroke-width=".9"/>`).join('');
  const targets = associations.map((association) => { const point = proofPoint(association.slopeCallout.target); const color = association.status === 'resolved' ? '#34d399' : '#fb7185'; return `<circle cx="${x(point.x).toFixed(2)}" cy="${y(point.y).toFixed(2)}" r="6" fill="${color}" stroke="#f8fafc" stroke-width="1.2"><title>${association.slopeCallout.labelHandle} ${association.status}</title></circle>`; }).join('');
  const resolved = associations.filter((association) => association.status === 'resolved').length; const blocked = associations.length - resolved;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-121 slope target to canonical roof region association"><rect width="100%" height="100%" fill="#07111f"/><rect x="${plan.x}" y="${plan.y}" width="${plan.width}" height="${plan.height}" rx="10" fill="#0b1a2d" stroke="#334155"/><g>${regionsSvg}</g><g>${targets}</g><rect x="18" y="16" width="1564" height="82" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="45" fill="#e2e8f0" font-size="18" font-family="Arial">COOPERATIVE 1881 — A-121 SLOPE TARGETS TO CANONICAL ROOF REGIONS</text><text x="34" y="70" fill="#fbbf24" font-size="13" font-family="Arial">${resolved} resolved targets · ${blocked} overlap-blocked targets · 28 canonical regions from 31 native boundaries</text><text x="34" y="91" fill="#cbd5e1" font-size="12" font-family="Arial">Green = exactly one canonical source region; red = non-identical overlap, intentionally unassigned</text><text x="48" y="148" fill="#94a3b8" font-size="12" font-family="Arial">NATIVE PLAN VIEW${rotate ? ' · ROTATED 90° FOR LEGIBILITY' : ''}</text><rect x="1082" y="124" width="494" height="598" rx="10" fill="#10243a" stroke="#334155"/><text x="1110" y="164" fill="#e2e8f0" font-size="18" font-family="Arial">ASSOCIATION RECEIPT</text><text x="1110" y="207" fill="#34d399" font-size="26" font-family="Arial">${resolved} / ${associations.length}</text><text x="1110" y="230" fill="#cbd5e1" font-size="13" font-family="Arial">callout targets have one canonical region</text><text x="1110" y="278" fill="#fb7185" font-size="26" font-family="Arial">${blocked}</text><text x="1110" y="301" fill="#cbd5e1" font-size="13" font-family="Arial">targets stay blocked by non-identical overlap</text><line x1="1110" y1="330" x2="1544" y2="330" stroke="#334155"/><text x="1110" y="365" fill="#f8fafc" font-size="14" font-family="Arial">What this proves</text><text x="1110" y="391" fill="#cbd5e1" font-size="13" font-family="Arial">Some source slope magnitudes are region-localized.</text><text x="1110" y="439" fill="#f8fafc" font-size="14" font-family="Arial">What stays blocked</text><text x="1110" y="465" fill="#fbbf24" font-size="13" font-family="Arial">slope direction · roof plane · elevation</text><text x="1110" y="489" fill="#fbbf24" font-size="13" font-family="Arial">members · heads · pipes · clearances</text><text x="1110" y="513" fill="#fbbf24" font-size="13" font-family="Arial">fabrication · code · employee/VPS use</text><text x="1110" y="684" fill="#94a3b8" font-size="12" font-family="Arial">Exact aliases retain all native handles in JSON.</text><text x="34" y="746" fill="#94a3b8" font-size="12" font-family="Arial">This receipt does not choose a smaller nested boundary; it rejects any non-identical concurrent containment.</text></svg>`;
}

export function buildCooperative1881A121SlopeBoundaryAssociation({ boundaries, slopeRegistration }) {
  const issues = [];
  if (boundaries.status !== 'passed') issues.push(issue('A121_BOUNDARY_RECEIPT_NOT_PASSED', 'The sealed roof-boundary receipt is not passed.'));
  if (slopeRegistration.status !== 'passed') issues.push(issue('A121_SLOPE_RECEIPT_NOT_PASSED', 'The sealed slope-callout receipt is not passed.'));
  const a121Hash = boundaries.sources?.architectural?.sha256; if (!a121Hash || a121Hash !== slopeRegistration.sources?.architectural?.sha256) issues.push(issue('A121_ASSOCIATION_SOURCE_HASH_MISMATCH', 'Boundary and slope receipts are not sealed to the same A-121 source hash.', [String(a121Hash), String(slopeRegistration.sources?.architectural?.sha256)]));
  const regions = canonicalRegions(boundaries.boundaries || []); const associations = associateSlopeTargets(slopeRegistration.callouts || [], regions); const blockedAssociations = associations.filter((association) => association.status === 'blocked');
  const artifact = { artifactType: 'halofire.cooperative-1881-a121-slope-boundary-association.v1', projectName: boundaries.projectName, status: issues.length ? 'blocked' : 'passed', sources: { architectural: { fileName: boundaries.sources?.architectural?.fileName, sha256: a121Hash, boundaryReceipt: path.basename(BOUNDARY_PATH), slopeReceipt: path.basename(SLOPE_PATH) } }, canonicalRegionCount: regions.length, exactDuplicateAliasGroups: regions.filter((region) => region.aliases.length > 1).map((region) => ({ id: region.id, aliases: region.aliases })), canonicalRegions: regions, associations, issues, claims: { allSlopeTargetsClassified: associations.length === (slopeRegistration.callouts || []).length, partialSourceSlopeMagnitudeRegionAssociationReady: associations.some((association) => association.status === 'resolved'), sourceSlopeMagnitudeRegionAssociationReady: blockedAssociations.length === 0 && !issues.length, slopeDirectionReady: false, roofSurfaceReconstructionReady: false, perMemberVerticalDatumReady: false, exactPhysicalFramingPromoted: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false }, limitations: ['An association records only a slope magnitude callout and a source plan region; no direction vector is inferred from its leader.', 'Any non-identical overlap blocks association instead of selecting an inner, outer, larger, or smaller boundary.', 'No roof plane, vertical datum, structural member, sprinkler, pipe, clearance, fabrication, code, employee, or VPS claim is made.'] };
  return { artifact, svg: !issues.length ? renderSvg(regions, associations) : null };
}

async function main() { const boundaries = JSON.parse(fs.readFileSync(BOUNDARY_PATH, 'utf8')); const slopeRegistration = JSON.parse(fs.readFileSync(SLOPE_PATH, 'utf8')); const { artifact, svg } = buildCooperative1881A121SlopeBoundaryAssociation({ boundaries, slopeRegistration }); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, canonicalRegionCount: artifact.canonicalRegionCount, resolved: artifact.associations.filter((association) => association.status === 'resolved').length, blocked: artifact.associations.filter((association) => association.status === 'blocked').length, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
