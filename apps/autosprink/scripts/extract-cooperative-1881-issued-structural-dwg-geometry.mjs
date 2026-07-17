/**
 * Read-only, hash-bound extractor for Cooperative 1881 issued structural DWGs.
 *
 * Inputs: the exact S-190 roof framing plan plus S-201/S-202 elevations and
 * S-301/S-302/S-303 building sections from the active job source directory.
 * Outputs: a replayable JSON receipt and a source-only SVG of the S-190 native
 * DWG linework. Known limitation: issued design CAD is not supplier fabrication
 * evidence and this program never promotes framing, clearance, or release.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_SOURCE_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files/structural';
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-issued-structural-dwg-geometry.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-issued-structural-dwg-geometry.svg');
const EXPECTED_SHEETS = Object.freeze([
  { id: 'S-190', title: 'OVERALL ROOF FRAMING PLAN', sha256: '539C3A39BDC2995D2BF427C82F732768117D11E08654697AD722C9F6BD38D3E4' },
  { id: 'S-201', title: 'ELEVATIONS', sha256: 'F40BFA05B7F6887E9DE5704C98C42BEC96A08F59B20E6A627567505CAEC2F5D8' },
  { id: 'S-202', title: 'ELEVATIONS', sha256: '519CFEBB6CDD9DB84427AB7BC28F9CB1E5C2F9E25602A81E80C8C67E10085790' },
  { id: 'S-301', title: 'BUILDING SECTIONS', sha256: 'B175D43570EC9BCB7E413E1FC8020AC3855D243C94ED14BA0158659279D01ED5' },
  { id: 'S-302', title: 'BUILDING SECTIONS', sha256: 'CC87B484071D2FEABB6D0223C8ED807106EB7B322BAB713CD272F557AFC6ED56' },
  { id: 'S-303', title: 'BUILDING SECTIONS', sha256: '511A62E28262B5D64D2EDEDD3A1A36C932A8989D00581144EC3E8E80EC27C34C' },
]);
const ROOF_LINE_LAYERS = new Set(['S-BEAM', 'S-FNDN', 'S-GRID']);
const XML_ENTITIES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function issue(code, message, refs = []) {
  return { code, severity: 'blocking', message, refs };
}

function point(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) }
    : null;
}

function entityText(entity) {
  const value = entity?.text?.text ?? entity?.text ?? '';
  return String(value).replaceAll('\\P', ' ').replaceAll(/[{}]/g, '').trim();
}

function sourceSha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function countBy(values) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map())].sort((a, b) => a[0].localeCompare(b[0])));
}

function boundsFor(lines) {
  const points = lines.flatMap((line) => [line.startPoint, line.endPoint]).filter(Boolean);
  if (!points.length) return null;
  const xs = points.map((value) => value.x);
  const ys = points.map((value) => value.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);
}

export function summarizeIssuedStructuralEntities({ expectedSheet, sourcePath, bytes, sha256, parserStats, entities }) {
  const text = entities.filter((entity) => entity.type === 'TEXT' || entity.type === 'MTEXT')
    .map((entity) => ({
      handle: String(entity.handle), layer: entity.layer || null, text: entityText(entity),
      insertionPoint: point(entity.insertionPoint ?? entity.startPoint), textHeight: Number(entity.textHeight || 0) || null,
    })).filter((entity) => entity.text);
  const lines = entities.filter((entity) => entity.type === 'LINE').map((entity) => ({
    handle: String(entity.handle), layer: entity.layer || null,
    startPoint: point(entity.startPoint), endPoint: point(entity.endPoint),
  })).filter((entity) => entity.startPoint && entity.endPoint);
  const roofLinework = expectedSheet.id === 'S-190'
    ? lines.filter((line) => ROOF_LINE_LAYERS.has(line.layer)) : [];
  const structuralText = text.filter((entry) => entry.layer?.startsWith('S-'));
  const gridLabels = expectedSheet.id === 'S-190'
    ? structuralText.filter((entry) => entry.layer === 'S-GRID-IDEN') : [];
  const issues = [];
  if (sha256 !== expectedSheet.sha256) issues.push(issue('ISSUED_STRUCTURAL_DWG_SOURCE_HASH_MISMATCH', `${expectedSheet.id} source hash does not match the sealed active-project receipt.`, [sourcePath]));
  if (Number(parserStats?.unknownEntityCount || 0) !== 0) issues.push(issue('ISSUED_STRUCTURAL_DWG_UNKNOWN_ENTITIES', `${expectedSheet.id} contains unknown LibreDWG entities and cannot be used as complete geometry evidence.`, [sourcePath]));
  if (expectedSheet.id === 'S-190' && (!roofLinework.length || !gridLabels.length)) issues.push(issue('ISSUED_STRUCTURAL_ROOF_PLAN_CONTROL_UNRESOLVED', 'S-190 lacks the expected source linework or grid labels required for a native roof-plan observation.', [sourcePath]));
  return {
    sheetId: expectedSheet.id,
    expectedTitle: expectedSheet.title,
    source: {
      fileName: path.basename(sourcePath), byteLength: bytes.length, sha256,
      parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)', unknownEntityCount: Number(parserStats?.unknownEntityCount || 0),
    },
    entityCounts: countBy(entities.map((entity) => entity.type)),
    structuralText,
    planControls: expectedSheet.id === 'S-190' ? {
      gridLabels, roofLinework, roofLineworkBounds: boundsFor(roofLinework),
      note: 'These are native issued-design CAD observations. They are not member tags, member dimensions, supplier fabrication details, or sprinkler obstruction clearances.',
    } : null,
    sectionOrElevationControls: expectedSheet.id !== 'S-190' ? {
      text: structuralText,
      structuralLineCount: lines.filter((line) => line.layer?.startsWith('S-')).length,
      note: 'Text and line observations are retained separately from S-190. No cross-sheet member association is inferred by this extractor.',
    } : null,
    issues,
  };
}

export function renderRoofPlanSourceSvg(receipt) {
  const controls = receipt?.planControls;
  // Grid extents and title-area guide lines can sit well outside the actual
  // roof framing sheet body. Fit to the source framing/foundation linework so
  // the visual receipt shows the roof plan at inspectable scale.
  const displayLinework = controls?.roofLinework?.filter((line) => line.layer === 'S-BEAM' || line.layer === 'S-FNDN') || [];
  const bounds = boundsFor(displayLinework) || controls?.roofLineworkBounds;
  if (!bounds) throw new Error('ROOF_PLAN_SOURCE_VISUAL_UNAVAILABLE');
  const width = 1600;
  const height = 980;
  const pad = 54;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad - 70) / spanY);
  const x = (value) => pad + (value - bounds.minX) * scale;
  const y = (value) => height - pad - (value - bounds.minY) * scale;
  const colorForLayer = (layer) => ({ 'S-BEAM': '#22d3ee', 'S-FNDN': '#94a3b8', 'S-GRID': '#fbbf24' }[layer] || '#64748b');
  const linework = [...displayLinework, ...controls.roofLinework.filter((line) => line.layer === 'S-GRID')].map((line) => `<line x1="${x(line.startPoint.x).toFixed(2)}" y1="${y(line.startPoint.y).toFixed(2)}" x2="${x(line.endPoint.x).toFixed(2)}" y2="${y(line.endPoint.y).toFixed(2)}" stroke="${colorForLayer(line.layer)}" stroke-width="${line.layer === 'S-GRID' ? '1.6' : '0.9'}"/>`).join('');
  const labels = controls.gridLabels.filter((label) => label.insertionPoint
    && label.insertionPoint.x >= bounds.minX - 100 && label.insertionPoint.x <= bounds.maxX + 100
    && label.insertionPoint.y >= bounds.minY - 100 && label.insertionPoint.y <= bounds.maxY + 100).map((label) => label.insertionPoint
    ? `<text x="${x(label.insertionPoint.x).toFixed(2)}" y="${y(label.insertionPoint.y).toFixed(2)}" fill="#fde68a" font-family="Arial, sans-serif" font-size="11">${escapeXml(label.text)}</text>` : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 issued S-190 native DWG source geometry"><rect width="100%" height="100%" fill="#07111f"/><g>${linework}</g><g>${labels}</g><rect x="18" y="16" width="1564" height="40" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="42" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="17">COOPERATIVE 1881 — S-190 NATIVE ISSUED STRUCTURAL DWG SOURCE LINEWORK</text><text x="34" y="76" fill="#fbbf24" font-family="Arial, sans-serif" font-size="13">Source-only CAD receipt — no PDF overlay, no sprinkler, no fabricated member, no clearance or code claim</text><text x="34" y="${height - 18}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12">cyan S-BEAM · gray S-FNDN · amber S-GRID · source SHA-256 ${receipt.source.sha256}</text></svg>`;
}

async function readSheet(libredwg, sourceRoot, expectedSheet) {
  const names = fs.readdirSync(sourceRoot);
  const fileName = names.find((name) => name.includes(`Sheet - ${expectedSheet.id} -`) && name.toUpperCase().endsWith('.DWG'));
  if (!fileName) return { sheetId: expectedSheet.id, issues: [issue('ISSUED_STRUCTURAL_DWG_SOURCE_SHEET_MISSING', `${expectedSheet.id} was not found in the configured active-project structural CAD directory.`, [sourceRoot])] };
  const sourcePath = path.join(sourceRoot, fileName);
  const bytes = fs.readFileSync(sourcePath);
  const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try {
    const converted = libredwg.convertEx(raw);
    return summarizeIssuedStructuralEntities({ expectedSheet, sourcePath, bytes, sha256: sourceSha256(bytes), parserStats: converted.stats, entities: converted.database.entities });
  } finally {
    libredwg.dwg_free(raw);
  }
}

export async function extractCooperative1881IssuedStructuralDwgGeometry({ sourceRoot = process.env.HALOFIRE_1881_ISSUED_STRUCTURAL_ROOT || DEFAULT_SOURCE_ROOT } = {}) {
  const wasmRoot = path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const sheets = [];
  for (const expectedSheet of EXPECTED_SHEETS) sheets.push(await readSheet(libredwg, sourceRoot, expectedSheet));
  const issues = sheets.flatMap((sheet) => sheet.issues || []);
  const roofPlan = sheets.find((sheet) => sheet.sheetId === 'S-190');
  const artifact = {
    artifactType: 'halofire.cooperative-1881-issued-structural-dwg-geometry.v1',
    projectName: 'The Cooperative 1881 - Salt Lake City UT',
    sourceRoot, status: issues.length ? 'blocked' : 'passed', sheets, issues,
    claims: {
      issuedStructuralSourcesHashVerified: issues.every((entry) => entry.code !== 'ISSUED_STRUCTURAL_DWG_SOURCE_HASH_MISMATCH'),
      nativeRoofPlanSourceObserved: Boolean(roofPlan?.planControls?.roofLinework?.length && roofPlan?.planControls?.gridLabels?.length),
      elevationAndSectionSourcesObserved: sheets.filter((sheet) => sheet.sheetId !== 'S-190').every((sheet) => sheet.sectionOrElevationControls?.text?.length),
      exactPhysicalFramingPromoted: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false,
      fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false,
    },
    limitations: [
      'Issued structural design DWGs are not structural supplier/truss/lumber fabrication submittals.',
      'This receipt retains source geometry observations but does not infer a member tag, dressed dimensions, truss profile, connection, floor association, vertical datum, or cross-sheet member identity.',
      'No selected sprinkler, deflector criteria, NFPA obstruction analysis, pipe routing, hydraulic calculation, fabrication, employee, or VPS claim is cleared.',
    ],
  };
  return { artifact, svg: roofPlan?.planControls?.roofLinework?.length ? renderRoofPlanSourceSvg(roofPlan) : null };
}

async function main() {
  const { artifact, svg } = await extractCooperative1881IssuedStructuralDwgGeometry();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  if (svg) fs.writeFileSync(PROOF_PATH, svg);
  process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, claims: artifact.claims, issues: artifact.issues }, null, 2)}\n`);
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
