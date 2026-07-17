/**
 * Capture native A-121 Roof_*_2 plan boundaries as evidence. This does not
 * assign a slope direction, roof elevation, framing member, sprinkler, or pipe.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_CAD_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files';
const A121 = 'arch/A-121 ROOF PLAN.dwg';
const A121_SHA256 = 'FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606';
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-a121-roof-face-boundaries.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-a121-roof-face-boundaries.svg');
const POINT_TOLERANCE = 0.01;
const XML = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
function numericPoint(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) } : null; }
function round(value) { return Number(value.toFixed(6)); }
function pointKey(point) { return `${Math.round(point.x / POINT_TOLERANCE)}:${Math.round(point.y / POINT_TOLERANCE)}`; }
function samePoint(left, right) { return Math.hypot(left.x - right.x, left.y - right.y) <= POINT_TOLERANCE; }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (character) => XML[character]); }

export function signedArea(vertices) {
  return vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0) / 2;
}

function normalizedVertices(vertices) {
  const points = vertices.map(numericPoint).filter(Boolean);
  if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();
  return points.map((point) => ({ x: round(point.x), y: round(point.y), z: round(point.z) }));
}

function closedPath(vertices) {
  const points = normalizedVertices(vertices);
  return points.length >= 3 && Math.abs(signedArea(points)) > POINT_TOLERANCE ? points : null;
}

function polylineSegments(entities) {
  const segments = [];
  for (const entity of entities.filter((entry) => entry.type === 'LWPOLYLINE')) {
    const vertices = normalizedVertices(entity.vertices || []);
    for (let index = 1; index < vertices.length; index += 1) segments.push({ handle: String(entity.handle), start: vertices[index - 1], end: vertices[index] });
    if ((entity.flag & 1) === 1 && vertices.length >= 3) segments.push({ handle: String(entity.handle), start: vertices.at(-1), end: vertices[0] });
  }
  return segments.filter((segment) => !samePoint(segment.start, segment.end));
}

export function closedPolylineLoops(entities) {
  const segments = polylineSegments(entities);
  const adjacency = new Map();
  for (const [index, segment] of segments.entries()) {
    for (const endpoint of [segment.start, segment.end]) {
      const key = pointKey(endpoint);
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(index);
    }
  }
  const unused = new Set(segments.map((_segment, index) => index));
  const loops = []; const issues = [];
  while (unused.size) {
    const startIndex = unused.values().next().value;
    const component = []; const stack = [startIndex]; unused.delete(startIndex);
    while (stack.length) {
      const index = stack.pop(); component.push(index);
      for (const endpoint of [segments[index].start, segments[index].end]) {
        for (const neighbor of adjacency.get(pointKey(endpoint)) || []) if (unused.delete(neighbor)) stack.push(neighbor);
      }
    }
    const componentSegments = component.map((index) => segments[index]);
    const degrees = new Map();
    for (const segment of componentSegments) for (const endpoint of [segment.start, segment.end]) {
      const key = pointKey(endpoint); degrees.set(key, (degrees.get(key) || 0) + 1);
    }
    const handles = [...new Set(componentSegments.map((segment) => segment.handle))].sort();
    if ([...degrees.values()].some((degree) => degree !== 2)) {
      issues.push(issue('A121_ROOF_POLYLINE_LOOP_OPEN_OR_BRANCHING', 'Roof block linework does not form exactly one closed non-branching loop.', handles));
      continue;
    }
    const ordered = []; let previousKey = null; let current = componentSegments[0].start;
    const remaining = new Set(component);
    while (remaining.size) {
      ordered.push(current);
      const nextIndex = [...remaining].find((index) => {
        const segment = segments[index];
        return pointKey(segment.start) === pointKey(current) || pointKey(segment.end) === pointKey(current);
      });
      if (nextIndex === undefined) break;
      remaining.delete(nextIndex);
      const segment = segments[nextIndex];
      const next = pointKey(segment.start) === pointKey(current) ? segment.end : segment.start;
      previousKey = pointKey(current); current = next;
      if (!remaining.size && pointKey(current) !== pointKey(ordered[0])) issues.push(issue('A121_ROOF_POLYLINE_LOOP_NOT_CLOSED', 'Roof block linework did not return to its source start point.', handles));
      if (previousKey === pointKey(current) && remaining.size) { issues.push(issue('A121_ROOF_POLYLINE_LOOP_DEGENERATE', 'Roof block linework has a degenerate segment.', handles)); break; }
    }
    const vertices = closedPath(ordered);
    if (!vertices) issues.push(issue('A121_ROOF_POLYLINE_LOOP_DEGENERATE', 'Roof block linework loop has fewer than three points or zero area.', handles));
    else loops.push({ source: 'LWPOLYLINE_LOOP', handles, vertices, areaNativeSq: round(Math.abs(signedArea(vertices))) });
  }
  return { loops, issues };
}

function hatchLoops(entities) {
  const loops = []; const issues = [];
  for (const hatch of entities.filter((entity) => entity.type === 'HATCH')) for (const boundaryPath of hatch.boundaryPaths || []) {
    const vertices = closedPath(boundaryPath.vertices || []);
    if (!boundaryPath.isClosed || !vertices) issues.push(issue('A121_ROOF_HATCH_BOUNDARY_INVALID', 'Roof block HATCH boundary is not a closed non-degenerate path.', [String(hatch.handle)]));
    else loops.push({ source: 'HATCH_BOUNDARY', handles: [String(hatch.handle)], vertices, areaNativeSq: round(Math.abs(signedArea(vertices))) });
  }
  return { loops, issues };
}

function sourceBlockBoundaries(block, instance) {
  const hatch = hatchLoops(block.entities || []);
  // A closed HATCH boundary is the authoritative source fill edge. Some
  // blocks also carry branching decorative roof-edge linework; do not let that
  // secondary representation invalidate a valid native closed boundary.
  const polyline = hatch.loops.length ? { loops: [], issues: [] } : closedPolylineLoops(block.entities || []);
  const issues = [...hatch.issues, ...polyline.issues];
  const boundaries = hatch.loops.length ? hatch.loops : polyline.loops;
  if (!boundaries.length) issues.push(issue('A121_ROOF_BLOCK_BOUNDARY_UNRESOLVED', `${block.name} has no closed native HATCH or LWPOLYLINE boundary.`, [String(instance.handle), String(block.handle)]));
  return { boundaries: boundaries.map((boundary, index) => ({ id: `${block.name}:${index + 1}`, roofBlockName: block.name, roofBlockRecordHandle: String(block.handle), roofBlockInsertHandle: String(instance.handle), layer: String(instance.layer || ''), ...boundary })), issues };
}

function renderSvg(boundaries) {
  const sourcePoints = boundaries.flatMap((boundary) => boundary.vertices); const sourceMinX = Math.min(...sourcePoints.map((point) => point.x)); const sourceMaxX = Math.max(...sourcePoints.map((point) => point.x)); const sourceMinY = Math.min(...sourcePoints.map((point) => point.y)); const sourceMaxY = Math.max(...sourcePoints.map((point) => point.y));
  // The roof stack is nearly four times taller than wide in native plan
  // coordinates. Rotate only the proof viewport so its closed source edges
  // can be inspected without changing any stored source coordinate.
  const rotateForProof = sourceMaxY - sourceMinY > sourceMaxX - sourceMinX;
  const proofPoint = (point) => rotateForProof ? { x: point.y, y: -point.x } : point;
  const points = sourcePoints.map(proofPoint); const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x)); const minY = Math.min(...points.map((point) => point.y)); const maxY = Math.max(...points.map((point) => point.y));
  const width = 1600; const height = 760; const plan = { x: 24, y: 124, width: 1030, height: 598 }; const scale = Math.min((plan.width - 64) / (maxX - minX), (plan.height - 64) / (maxY - minY)); const drawingWidth = (maxX - minX) * scale; const drawingHeight = (maxY - minY) * scale; const originX = plan.x + (plan.width - drawingWidth) / 2 - minX * scale; const originY = plan.y + (plan.height - drawingHeight) / 2 + maxY * scale; const x = (value) => originX + value * scale; const y = (value) => originY - value * scale;
  const palette = ['#22d3ee', '#a78bfa', '#fbbf24', '#fb7185', '#34d399', '#60a5fa'];
  const polygons = boundaries.map((boundary, index) => `<polygon points="${boundary.vertices.map(proofPoint).map((point) => `${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`).join(' ')}" fill="${palette[index % palette.length]}" fill-opacity=".22" stroke="${palette[index % palette.length]}" stroke-width="1.4"><title>${escapeXml(`${boundary.id} ${boundary.source} ${boundary.handles.join(', ')}`)}</title></polygon>`).join('');
  const hatchCount = boundaries.filter((boundary) => boundary.source === 'HATCH_BOUNDARY').length; const polylineCount = boundaries.length - hatchCount;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-121 source roof block boundaries"><rect width="100%" height="100%" fill="#07111f"/><rect x="${plan.x}" y="${plan.y}" width="${plan.width}" height="${plan.height}" rx="10" fill="#0b1a2d" stroke="#334155"/><g>${polygons}</g><rect x="18" y="16" width="1564" height="82" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="45" fill="#e2e8f0" font-size="18" font-family="Arial">COOPERATIVE 1881 — NATIVE A-121 ROOF BLOCK PLAN BOUNDARIES</text><text x="34" y="70" fill="#fbbf24" font-size="13" font-family="Arial">${boundaries.length} closed source boundaries · 30 named Roof_*_2 blocks · exact DWG handles retained in JSON</text><text x="34" y="91" fill="#cbd5e1" font-size="12" font-family="Arial">Plan-boundary evidence only — no slope direction, elevation, member, head, pipe, clearance, fabrication, code, employee, or VPS claim</text><text x="48" y="148" fill="#94a3b8" font-size="12" font-family="Arial">NATIVE PLAN VIEW${rotateForProof ? ' · ROTATED 90° FOR LEGIBILITY' : ''}</text><rect x="1082" y="124" width="494" height="598" rx="10" fill="#10243a" stroke="#334155"/><text x="1110" y="164" fill="#e2e8f0" font-size="18" font-family="Arial">SOURCE RECEIPT</text><text x="1110" y="207" fill="#22d3ee" font-size="26" font-family="Arial">30 / 30</text><text x="1110" y="230" fill="#cbd5e1" font-size="13" font-family="Arial">named Roof_*_2 block instances represented</text><text x="1110" y="278" fill="#fbbf24" font-size="26" font-family="Arial">${boundaries.length}</text><text x="1110" y="301" fill="#cbd5e1" font-size="13" font-family="Arial">closed boundaries: ${hatchCount} HATCH · ${polylineCount} edge loops</text><line x1="1110" y1="330" x2="1544" y2="330" stroke="#334155"/><text x="1110" y="365" fill="#f8fafc" font-size="14" font-family="Arial">What this proves</text><text x="1110" y="391" fill="#cbd5e1" font-size="13" font-family="Arial">Issued A-121 plan geometry and handles.</text><text x="1110" y="439" fill="#f8fafc" font-size="14" font-family="Arial">What stays blocked</text><text x="1110" y="465" fill="#fbbf24" font-size="13" font-family="Arial">roof planes · slope vectors · elevations</text><text x="1110" y="489" fill="#fbbf24" font-size="13" font-family="Arial">members · heads · pipes · clearances</text><text x="1110" y="513" fill="#fbbf24" font-size="13" font-family="Arial">fabrication · code · employee/VPS use</text><text x="1110" y="684" fill="#94a3b8" font-size="12" font-family="Arial">Color is only a visual discriminator.</text><text x="34" y="746" fill="#94a3b8" font-size="12" font-family="Arial">HATCH boundaries are preferred where native; closed roof-edge LWPOLYLINE loops are used only where no HATCH exists. Source coordinates are unchanged.</text></svg>`;
}

async function parseDwg(sourcePath) {
  const bytes = fs.readFileSync(sourcePath); const libredwg = await LibreDwg.create(`${path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/')}/`); const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try { const converted = libredwg.convertEx(raw); return { sha256: sha256(bytes), unknownEntityCount: Number(converted.stats.unknownEntityCount || 0), database: converted.database }; } finally { libredwg.dwg_free(raw); }
}

export async function extractCooperative1881A121RoofFaceBoundaries({ cadRoot = process.env.HALOFIRE_1881_CAD_ROOT || DEFAULT_CAD_ROOT } = {}) {
  const sourcePath = path.join(cadRoot, A121); const parsed = await parseDwg(sourcePath); const issues = [];
  if (parsed.sha256 !== A121_SHA256) issues.push(issue('A121_ROOF_BLOCK_SOURCE_HASH_MISMATCH', 'A-121 does not match its sealed source hash.', [A121_SHA256, parsed.sha256]));
  if (parsed.unknownEntityCount !== 0) issues.push(issue('A121_ROOF_BLOCK_DWG_UNKNOWN_ENTITY', 'A-121 contains unknown native DWG entities.', [String(parsed.unknownEntityCount)]));
  const blocks = parsed.database.tables.BLOCK_RECORD.entries.filter((block) => /^Roof_\d+_2$/.test(block.name));
  const inserts = parsed.database.entities.filter((entity) => entity.type === 'INSERT' && /^Roof_\d+_2$/.test(String(entity.name || '')));
  const instancesByName = new Map(inserts.map((insert) => [String(insert.name), insert]));
  if (blocks.length !== 30 || inserts.length !== 30) issues.push(issue('A121_ROOF_BLOCK_COUNT_DRIFT', 'A-121 must retain exactly thirty named Roof_*_2 block records and inserts.', [String(blocks.length), String(inserts.length)]));
  const boundaries = [];
  for (const block of blocks.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))) {
    const instance = instancesByName.get(block.name);
    if (!instance) { issues.push(issue('A121_ROOF_BLOCK_INSERT_MISSING', `${block.name} has no matching INSERT instance.`, [String(block.handle)])); continue; }
    const insertionPoint = numericPoint(instance.insertionPoint); const basePoint = numericPoint(block.basePoint);
    if (!insertionPoint || !basePoint || !samePoint(insertionPoint, basePoint) || Number(instance.rotationAngle || 0) !== 0 || Number(instance.xScale || 1) !== 1 || Number(instance.yScale || 1) !== 1) {
      issues.push(issue('A121_ROOF_BLOCK_TRANSFORM_UNSUPPORTED', `${block.name} requires a non-identity block transformation and is not emitted.`, [String(instance.handle), String(block.handle)])); continue;
    }
    const extracted = sourceBlockBoundaries(block, instance); boundaries.push(...extracted.boundaries); issues.push(...extracted.issues);
  }
  const artifact = {
    artifactType: 'halofire.cooperative-1881-a121-roof-face-boundaries.v1', projectName: 'The Cooperative 1881 - Salt Lake City UT', status: issues.length ? 'blocked' : 'passed',
    sources: { architectural: { fileName: path.basename(sourcePath), sha256: parsed.sha256, expectedSha256: A121_SHA256, parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: parsed.unknownEntityCount } },
    roofBlockRecordCount: blocks.length, roofBlockInsertCount: inserts.length, boundaries, issues,
    claims: { sourceRoofFaceBoundariesRegistered: Boolean(boundaries.length && !issues.length), roofSurfaceReconstructionReady: false, slopeDirectionReady: false, perMemberVerticalDatumReady: false, exactPhysicalFramingPromoted: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false },
    limitations: ['A source-bound plan boundary is not a roof plane, slope direction vector, or elevation.', 'No boundary is associated with a structural member, sprinkler, pipe, fitting, clearance, fabrication, code decision, employee workflow, or VPS release.']
  };
  return { artifact, svg: !issues.length && boundaries.length ? renderSvg(boundaries) : null };
}

async function main() { const { artifact, svg } = await extractCooperative1881A121RoofFaceBoundaries(); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, boundaryCount: artifact.boundaries.length, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
