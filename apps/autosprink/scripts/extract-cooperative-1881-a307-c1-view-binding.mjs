/**
 * Bind A-121's explicit C1/A-307 reference to one native A-307 drawing title
 * and viewport. This captures source-view roof geometry and annotations only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_CAD_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files';
const A307 = 'arch/A-307 BUILDING SECTIONS.dwg';
const A307_SHA256 = '070F4766DB2FCD0D62E828AE70418BD205722FE9DC79EF95DDBDB61174B69162';
const COVERAGE_PATH = path.join(APP, 'src/data/cooperative-1881-a121-section-cut-coverage.json');
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-a307-c1-view-binding.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-a307-c1-view-binding.svg');
const EPSILON = 0.000001;

function issue(code, message, refs = []) { return { code, severity: 'blocking', message, refs }; }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
function round(value) { return Number(value.toFixed(6)); }
function point(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) } : null; }
function samePoint(left, right) { return Math.hypot(left.x - right.x, left.y - right.y) <= EPSILON; }
function plainText(value) { return String(value?.text?.text ?? value?.text ?? value ?? '').replace(/\\[A-Za-z][^;]*;/g, '').replaceAll('\\P', ' ').replaceAll(/[{}]/g, '').replace(/\s+/g, ' ').trim(); }
function inside(bounds, value) { return value.x >= bounds.minX - EPSILON && value.x <= bounds.maxX + EPSILON && value.y >= bounds.minY - EPSILON && value.y <= bounds.maxY + EPSILON; }

export function viewportModelBounds(viewport) {
  const target = point(viewport.targetPoint); const paperWidth = Number(viewport.width); const paperHeight = Number(viewport.height); const modelHeight = Number(viewport.viewHeight);
  if (!target || !Number.isFinite(paperWidth) || !Number.isFinite(paperHeight) || !Number.isFinite(modelHeight) || paperWidth <= 0 || paperHeight <= 0 || modelHeight <= 0) return null;
  const modelWidth = modelHeight * paperWidth / paperHeight;
  return { minX: round(target.x - modelWidth / 2), maxX: round(target.x + modelWidth / 2), minY: round(target.y - modelHeight / 2), maxY: round(target.y + modelHeight / 2), width: round(modelWidth), height: round(modelHeight) };
}

/** Bind an NCS drawing title to exactly one view above it using its layout geometry. */
export function titleViewportCandidates(title, viewports) {
  return viewports.filter((viewport) => {
    const center = point(viewport.viewportCenter); const titlePoint = point(title.insertionPoint);
    if (!center || !titlePoint || Number(viewport.height) <= 0 || Number(viewport.width) <= 0) return false;
    const viewBottom = center.y - Number(viewport.height) / 2; const viewLeft = center.x - Number(viewport.width) / 2;
    const verticalGap = viewBottom - titlePoint.y; const horizontalGap = viewLeft - titlePoint.x;
    return verticalGap >= 0.5 && verticalGap <= 1.2 && horizontalGap >= 0 && horizontalGap <= 2;
  });
}

function titleAttributes(insert, attributes) {
  const byTag = new Map(attributes.filter((attribute) => String(attribute.ownerBlockRecordSoftId) === String(insert.handle)).map((attribute) => [String(attribute.tag), plainText(attribute)]));
  return { detailReference: byTag.get('AC_DrawingNumber') || null, sheetReference: byTag.get('DUMMY_142') || null, drawingName: byTag.get('AC_DrawingName') || null, scaleText: byTag.get('AC_TextStyle_1') || null };
}

function parseElevation(text) {
  const match = /^([+-])(\d+)'-(\d+)(?: (\d+)\/(\d+))?"\d*\s+(ROOF EAVE|T\.O\. ROOF RIDGE)$/.exec(text);
  if (!match) return null;
  const inches = Number(match[3]) + (match[4] ? Number(match[4]) / Number(match[5]) : 0); const feet = Number(match[2]) + inches / 12;
  return { kind: match[6] === 'ROOF EAVE' ? 'roof-eave' : 'roof-ridge', elevationText: `${match[1]}${match[2]}'-${match[3]}${match[4] ? ` ${match[4]}/${match[5]}` : ''}"`, signedFeet: round((match[1] === '-' ? -1 : 1) * feet) };
}

function identityTransformed(insert, block) { const insertion = point(insert.insertionPoint); const base = point(block?.basePoint); return Boolean(insertion && base && samePoint(insertion, base) && Number(insert.rotationAngle || 0) === 0 && Number(insert.xScale || 1) === 1 && Number(insert.yScale || 1) === 1); }

function roofSegmentsInViewport(database, bounds, issues) {
  const blocks = new Map(database.tables.BLOCK_RECORD.entries.map((block) => [String(block.name), block])); const segments = [];
  for (const insert of database.entities.filter((entity) => entity.type === 'INSERT' && /^Section Element_\d+_1$/.test(String(entity.name || '')) && String(entity.layer || '').includes('Roofs'))) {
    const block = blocks.get(String(insert.name));
    if (!identityTransformed(insert, block)) { issues.push(issue('A307_C1_ROOF_PROFILE_TRANSFORM_UNSUPPORTED', `${insert.name} uses a non-identity transform and is not emitted.`, [String(insert.handle), String(block?.handle || '')])); continue; }
    for (const entity of block.entities || []) {
      if (entity.type !== 'LINE' || !String(entity.layer || '').includes('Roofs')) continue;
      const start = point(entity.startPoint); const end = point(entity.endPoint);
      if (start && end && inside(bounds, start) && inside(bounds, end)) segments.push({ sourceBlockName: String(block.name), sourceBlockRecordHandle: String(block.handle), sourceInsertHandle: String(insert.handle), sourceLineHandle: String(entity.handle), layer: String(entity.layer), start: { x: round(start.x), y: round(start.y), z: round(start.z) }, end: { x: round(end.x), y: round(end.y), z: round(end.z) } });
    }
  }
  return segments;
}

function renderSvg(binding) {
  const segments = binding.roofProfileSegments; const annotations = binding.verticalDatumAnnotations; const points = segments.flatMap((segment) => [segment.start, segment.end]); const minX = Math.min(...points.map((value) => value.x)); const maxX = Math.max(...points.map((value) => value.x)); const minY = Math.min(...points.map((value) => value.y)); const maxY = Math.max(...points.map((value) => value.y)); const width = 1600; const height = 760; const view = { x: 24, y: 124, width: 1030, height: 598 }; const scale = Math.min((view.width - 72) / (maxX - minX), (view.height - 120) / (maxY - minY)); const originX = view.x + (view.width - (maxX - minX) * scale) / 2 - minX * scale; const originY = view.y + (view.height - (maxY - minY) * scale) / 2 + maxY * scale; const x = (value) => originX + value * scale; const y = (value) => originY - value * scale;
  const lines = segments.map((segment) => `<line x1="${x(segment.start.x).toFixed(2)}" y1="${y(segment.start.y).toFixed(2)}" x2="${x(segment.end.x).toFixed(2)}" y2="${y(segment.end.y).toFixed(2)}" stroke="#22d3ee" stroke-width="2"><title>${segment.sourceBlockName} / ${segment.sourceLineHandle}</title></line>`).join(''); const annotationText = annotations.map((annotation, index) => `<text x="1110" y="${335 + index * 28}" fill="#fbbf24" font-size="14" font-family="Arial">${annotation.elevationText} ${annotation.kind === 'roof-eave' ? 'ROOF EAVE' : 'T.O. ROOF RIDGE'}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 A-307 C1 source view binding"><rect width="100%" height="100%" fill="#07111f"/><rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" rx="10" fill="#0b1a2d" stroke="#334155"/><g>${lines}</g><rect x="18" y="16" width="1564" height="82" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="45" fill="#e2e8f0" font-size="18" font-family="Arial">COOPERATIVE 1881 — A-307 C1 NATIVE SECTION VIEW SOURCE BINDING</text><text x="34" y="70" fill="#fbbf24" font-size="13" font-family="Arial">A-121 C1/A-307 → native title → unique paper viewport → ${segments.length} viewport-local roof segments</text><text x="34" y="91" fill="#cbd5e1" font-size="12" font-family="Arial">Cyan lines are source-view roof profile geometry; they are not a reconstructed plan roof surface</text><text x="48" y="148" fill="#94a3b8" font-size="12" font-family="Arial">C1 / A-307 MODEL-SPACE VIEWPORT CONTENT · ${binding.drawingTitle.drawingName}</text><rect x="1082" y="124" width="494" height="598" rx="10" fill="#10243a" stroke="#334155"/><text x="1110" y="164" fill="#e2e8f0" font-size="18" font-family="Arial">SOURCE VIEW RECEIPT</text><text x="1110" y="207" fill="#22d3ee" font-size="26" font-family="Arial">C1 / A-307</text><text x="1110" y="231" fill="#cbd5e1" font-size="13" font-family="Arial">${binding.drawingTitle.drawingName}</text><text x="1110" y="262" fill="#94a3b8" font-size="13" font-family="Arial">${binding.drawingTitle.scaleText}</text><line x1="1110" y1="289" x2="1544" y2="289" stroke="#334155"/><text x="1110" y="317" fill="#f8fafc" font-size="14" font-family="Arial">Viewport-local elevation annotations</text>${annotationText}<line x1="1110" y1="415" x2="1544" y2="415" stroke="#334155"/><text x="1110" y="445" fill="#f8fafc" font-size="14" font-family="Arial">What this proves</text><text x="1110" y="470" fill="#cbd5e1" font-size="13" font-family="Arial">Source C1 view identity, geometry, and labels.</text><text x="1110" y="516" fill="#f8fafc" font-size="14" font-family="Arial">What stays blocked</text><text x="1110" y="541" fill="#fbbf24" font-size="13" font-family="Arial">profile-edge datum tie · slope direction</text><text x="1110" y="565" fill="#fbbf24" font-size="13" font-family="Arial">plan-region mapping · roof plane · 3D</text><text x="1110" y="589" fill="#fbbf24" font-size="13" font-family="Arial">members · heads · pipes · code · VPS</text><text x="34" y="746" fill="#94a3b8" font-size="12" font-family="Arial">The receipt rejects title/viewport ambiguity and emits only roof-layer linework fully inside the exact bound model-space viewport.</text></svg>`;
}

async function parseDwg(sourcePath) { const bytes = fs.readFileSync(sourcePath); const libredwg = await LibreDwg.create(`${path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/')}/`); const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG); try { const converted = libredwg.convertEx(raw); return { sha256: sha256(bytes), unknownEntityCount: Number(converted.stats.unknownEntityCount || 0), database: converted.database }; } finally { libredwg.dwg_free(raw); } }

export async function extractCooperative1881A307C1ViewBinding({ cadRoot = process.env.HALOFIRE_1881_CAD_ROOT || DEFAULT_CAD_ROOT, sectionCoverage = null } = {}) {
  const parsed = await parseDwg(path.join(cadRoot, A307)); const coverage = sectionCoverage || JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8')); const issues = [];
  if (parsed.sha256 !== A307_SHA256) issues.push(issue('A307_C1_SOURCE_HASH_MISMATCH', 'A-307 does not match its sealed source hash.', [A307_SHA256, parsed.sha256])); if (parsed.unknownEntityCount !== 0) issues.push(issue('A307_C1_DWG_UNKNOWN_ENTITY', 'A-307 contains unknown native DWG entities.', [String(parsed.unknownEntityCount)]));
  const planReference = (coverage.cuttingPlanes || []).find((entry) => entry.detailReference === 'C1' && entry.sheetReference === 'A-307'); if (!planReference) issues.push(issue('A307_C1_PLAN_REFERENCE_MISSING', 'The preceding A-121 coverage receipt does not contain the explicit C1/A-307 plan reference.'));
  const attributes = parsed.database.entities.filter((entity) => entity.type === 'ATTRIB'); const titleInserts = parsed.database.entities.filter((entity) => entity.type === 'INSERT' && /^NCS Drawing Title/.test(String(entity.name || ''))).map((insert) => ({ ...insert, ...titleAttributes(insert, attributes) })); const targetTitle = titleInserts.find((entry) => entry.detailReference === 'C1' && entry.sheetReference === 'A-307'); if (!targetTitle) issues.push(issue('A307_C1_DRAWING_TITLE_MISSING', 'A-307 has no native drawing title with exact C1/A-307 attributes.'));
  const viewports = parsed.database.entities.filter((entity) => entity.type === 'VIEWPORT' && String(entity.layer || '') === 'NonPlottable_0' && Number(entity.viewHeight) > 100); const candidates = targetTitle ? titleViewportCandidates(targetTitle, viewports) : []; if (candidates.length !== 1) issues.push(issue('A307_C1_TITLE_VIEWPORT_AMBIGUOUS', 'C1/A-307 must have exactly one valid title-to-viewport paper-layout binding.', [String(candidates.length)])); const viewport = candidates[0]; const bounds = viewport ? viewportModelBounds(viewport) : null; if (!bounds) issues.push(issue('A307_C1_VIEWPORT_BOUNDS_UNRESOLVED', 'The bound C1/A-307 viewport has no usable model-space bounds.'));
  const roofProfileSegments = bounds ? roofSegmentsInViewport(parsed.database, bounds, issues) : []; if (!roofProfileSegments.length) issues.push(issue('A307_C1_ROOF_PROFILE_MISSING', 'No native roof-layer profile segments fall wholly inside the bound C1/A-307 viewport.'));
  const markerName = targetTitle?.drawingName ? `${targetTitle.drawingName.toUpperCase()}_STORY_MARKER` : null; const blocks = new Map(parsed.database.tables.BLOCK_RECORD.entries.map((block) => [String(block.name), block])); const markerInsert = markerName ? parsed.database.entities.find((entity) => entity.type === 'INSERT' && String(entity.name) === markerName) : null; const markerBlock = markerName ? blocks.get(markerName) : null; if (!identityTransformed(markerInsert, markerBlock)) issues.push(issue('A307_C1_STORY_MARKER_UNRESOLVED', 'The exact named story marker is missing or transformed.', [String(markerName)]));
  const verticalDatumAnnotations = markerBlock && bounds ? markerBlock.entities.filter((entity) => entity.type === 'MTEXT' || entity.type === 'TEXT').map((entity) => ({ entity, rawText: plainText(entity), sourcePoint: point(entity.insertionPoint ?? entity.startPoint) })).filter((entry) => entry.sourcePoint && inside(bounds, entry.sourcePoint)).map((entry) => ({ sourceHandle: String(entry.entity.handle), rawText: entry.rawText, sourcePoint: { x: round(entry.sourcePoint.x), y: round(entry.sourcePoint.y), z: round(entry.sourcePoint.z) }, ...parseElevation(entry.rawText) })).filter((entry) => entry.kind) : []; if (verticalDatumAnnotations.filter((entry) => entry.kind === 'roof-eave').length !== 1 || verticalDatumAnnotations.filter((entry) => entry.kind === 'roof-ridge').length !== 1) issues.push(issue('A307_C1_ROOF_DATUM_ANNOTATION_UNRESOLVED', 'The bound C1 viewport must contain exactly one eave and one ridge story-marker annotation.', verticalDatumAnnotations.map((entry) => entry.sourceHandle)));
  const artifact = { artifactType: 'halofire.cooperative-1881-a307-c1-view-binding.v1', projectName: coverage.projectName, status: issues.length ? 'blocked' : 'passed', sources: { architectural: { fileName: path.basename(A307), sha256: parsed.sha256, expectedSha256: A307_SHA256, parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: parsed.unknownEntityCount }, planCoverage: { fileName: path.basename(COVERAGE_PATH), a121SourceSha256: coverage.sources?.architectural?.sha256, planCutId: planReference?.id || null } }, planReference: planReference ? { id: planReference.id, detailReference: planReference.detailReference, sheetReference: planReference.sheetReference, sourceBlockRecordHandle: planReference.sourceBlockRecordHandle, sourceInsertHandle: planReference.sourceInsertHandle, sourceLineHandle: planReference.line.handle } : null, drawingTitle: targetTitle ? { sourceInsertHandle: String(targetTitle.handle), detailReference: targetTitle.detailReference, sheetReference: targetTitle.sheetReference, drawingName: targetTitle.drawingName, scaleText: targetTitle.scaleText, paperInsertionPoint: point(targetTitle.insertionPoint) } : null, viewport: viewport && bounds ? { sourceHandle: String(viewport.handle), paperCenter: point(viewport.viewportCenter), paperWidth: Number(viewport.width), paperHeight: Number(viewport.height), modelTarget: point(viewport.targetPoint), modelBounds: bounds } : null, roofProfileSegments, verticalDatumAnnotations, issues, claims: { planReferenceToNativeViewBound: Boolean(planReference && targetTitle && viewport && !issues.length), viewportLocalRoofProfileRegistered: Boolean(roofProfileSegments.length && !issues.length), viewportLocalRoofDatumAnnotationsRegistered: Boolean(verticalDatumAnnotations.length && !issues.length), profileEdgeToDatumBound: false, slopeDirectionReady: false, planRegionToSectionViewReady: false, roofSurfaceReconstructionReady: false, perMemberVerticalDatumReady: false, exactPhysicalFramingPromoted: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false }, limitations: ['The C1/A-307 binding proves only one source view and does not select it for any plural-covered plan region.', 'Eave/ridge annotations are not yet geometrically bound to a particular roof profile edge.', 'No profile direction is turned into a plan slope vector and no roof surface, member, sprinkler, pipe, clearance, fabrication, code, employee, or VPS claim is made.'] };
  return { artifact, svg: !issues.length ? renderSvg(artifact) : null };
}

async function main() { const { artifact, svg } = await extractCooperative1881A307C1ViewBinding(); fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`); if (svg) fs.writeFileSync(PROOF_PATH, svg); process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, roofProfileSegments: artifact.roofProfileSegments.length, verticalDatumAnnotations: artifact.verticalDatumAnnotations.length, issues: artifact.issues }, null, 2)}\n`); }
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
