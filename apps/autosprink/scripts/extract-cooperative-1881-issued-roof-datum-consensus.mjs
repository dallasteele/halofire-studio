/**
 * Read-only cross-sheet roof-elevation datum receipt for Cooperative 1881.
 *
 * Inputs: sealed elevation/section DWGs and their prior native-DWG receipt.
 * Outputs: repeated source label/value pairs plus an eave/ridge consensus.
 * Limitation: a datum consensus is not a roof pitch, member association,
 * physical obstruction, sprinkler-clearance, fabrication, or release claim.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const APP = path.resolve(import.meta.dirname, '..');
const DEFAULT_SOURCE_ROOT = 'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files/structural';
const PREVIOUS_RECEIPT_PATH = path.join(APP, 'src/data/cooperative-1881-issued-structural-dwg-geometry.json');
const OUTPUT_PATH = path.join(APP, 'src/data/cooperative-1881-issued-roof-datum-consensus.json');
const PROOF_PATH = path.resolve(APP, '../../output/visual-proof/1881-issued-roof-datum-consensus.svg');
const TARGET_SHEETS = new Set(['S-201', 'S-202', 'S-301', 'S-302', 'S-303']);
const DATUM_LABELS = new Map([['9. ROOF EAVE', 'roof-eave'], ['10. T.O. ROOF RIDGE', 'roof-ridge']]);
const ELEVATION_VALUE = /^(\d+)'-(\d+)(?:\s+(\d+)\/(\d+))?"$/;
const XML_ENTITIES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function issue(code, message, refs = []) {
  return { code, severity: 'blocking', message, refs };
}

function sourceSha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function point(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: Number(value.x), y: Number(value.y), z: Number(value.z || 0) }
    : null;
}

function textFor(entity) {
  return String(entity?.text?.text ?? entity?.text ?? '').replaceAll('\\P', ' ').replaceAll(/[{}]/g, '').trim();
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);
}

export function parseElevationInches(text) {
  const match = ELEVATION_VALUE.exec(String(text || '').trim());
  if (!match) return null;
  const feet = Number(match[1]);
  const inches = Number(match[2]);
  const numerator = match[3] ? Number(match[3]) : 0;
  const denominator = match[4] ? Number(match[4]) : 1;
  if (!Number.isInteger(feet) || !Number.isInteger(inches) || inches >= 12 || numerator < 0 || denominator <= 0 || numerator >= denominator) return null;
  return feet * 12 + inches + numerator / denominator;
}

export function extractRoofDatumPairs({ sheetId, source, entities, maxPairDistance = 100, maxVerticalPairGap = 30 }) {
  const textEntities = entities.filter((entity) => entity.type === 'TEXT' || entity.type === 'MTEXT').map((entity) => ({
    handle: String(entity.handle), layer: entity.layer || null, text: textFor(entity), insertionPoint: point(entity.insertionPoint ?? entity.startPoint),
  })).filter((entity) => entity.text && entity.insertionPoint);
  const labels = textEntities.filter((entity) => DATUM_LABELS.has(entity.text));
  const values = textEntities.map((entity) => ({ ...entity, elevationInches: parseElevationInches(entity.text) })).filter((entity) => entity.elevationInches !== null);
  const pairs = [];
  const issues = [];
  for (const label of labels) {
    const candidates = values.map((value) => ({ value, verticalGap: label.insertionPoint.y - value.insertionPoint.y, distance: Math.hypot(value.insertionPoint.x - label.insertionPoint.x, value.insertionPoint.y - label.insertionPoint.y) }))
      .filter((candidate) => candidate.distance <= maxPairDistance && candidate.verticalGap > 0 && candidate.verticalGap <= maxVerticalPairGap)
      .sort((left, right) => left.distance - right.distance || left.value.handle.localeCompare(right.value.handle));
    if (!candidates.length) {
      issues.push(issue('ROOF_DATUM_VALUE_PAIR_UNRESOLVED', `${sheetId} ${label.text} has no nearby source elevation value.`, [source.sha256, label.handle]));
      continue;
    }
    const selected = candidates[0];
    pairs.push({
      kind: DATUM_LABELS.get(label.text), sheetId,
      source: { sha256: source.sha256, fileName: source.fileName, parser: source.parser, unknownEntityCount: source.unknownEntityCount },
      label: { handle: label.handle, text: label.text, insertionPoint: label.insertionPoint },
      value: { handle: selected.value.handle, text: selected.value.text, elevationInches: selected.value.elevationInches, insertionPoint: selected.value.insertionPoint },
      pairDistanceDrawingUnits: Number(selected.distance.toFixed(6)),
      labelToValueVerticalGapDrawingUnits: Number(selected.verticalGap.toFixed(6)),
    });
  }
  for (const kind of DATUM_LABELS.values()) {
    if (!pairs.some((pair) => pair.kind === kind)) issues.push(issue('ROOF_DATUM_LABEL_MISSING', `${sheetId} does not provide a complete ${kind} label/value pair.`, [source.sha256, sheetId]));
  }
  return { pairs, issues, elevationLinework: entities.filter((entity) => entity.type === 'LINE').map((entity) => ({ startPoint: point(entity.startPoint), endPoint: point(entity.endPoint), layer: entity.layer || null })).filter((line) => line.startPoint && line.endPoint) };
}

export function consensusForPairs(pairs) {
  const values = [...new Set(pairs.map((pair) => pair.value.elevationInches))];
  return values.length === 1 ? { elevationInches: values[0], observationCount: pairs.length } : null;
}

function boundsFor(lines) {
  const points = lines.flatMap((line) => [line.startPoint, line.endPoint]);
  if (!points.length) return null;
  return { minX: Math.min(...points.map((pointValue) => pointValue.x)), maxX: Math.max(...points.map((pointValue) => pointValue.x)), minY: Math.min(...points.map((pointValue) => pointValue.y)), maxY: Math.max(...points.map((pointValue) => pointValue.y)) };
}

export function renderRoofDatumConsensusSvg({ visualSheet, consensus }) {
  const bounds = boundsFor(visualSheet.elevationLinework);
  if (!bounds) throw new Error('ROOF_DATUM_SOURCE_VISUAL_UNAVAILABLE');
  const width = 1600; const height = 980; const pad = 64;
  const scale = Math.min((width - 2 * pad) / Math.max(1, bounds.maxX - bounds.minX), (height - 190) / Math.max(1, bounds.maxY - bounds.minY));
  const x = (value) => pad + (value - bounds.minX) * scale;
  const y = (value) => height - 96 - (value - bounds.minY) * scale;
  const lines = visualSheet.elevationLinework.map((line) => `<line x1="${x(line.startPoint.x).toFixed(2)}" y1="${y(line.startPoint.y).toFixed(2)}" x2="${x(line.endPoint.x).toFixed(2)}" y2="${y(line.endPoint.y).toFixed(2)}" stroke="#64748b" stroke-width="0.9"/>`).join('');
  const labels = visualSheet.pairs.map((pair) => {
    const sourceX = x(pair.label.insertionPoint.x);
    const sourceY = y(pair.label.insertionPoint.y);
    const targetY = sourceY + (pair.kind === 'roof-eave' ? 30 : -20);
    const color = pair.kind === 'roof-eave' ? '#fbbf24' : '#67e8f9';
    return `<line x1="${sourceX.toFixed(2)}" y1="${sourceY.toFixed(2)}" x2="${sourceX.toFixed(2)}" y2="${targetY.toFixed(2)}" stroke="${color}" stroke-width="1.4"/><text x="${sourceX.toFixed(2)}" y="${targetY.toFixed(2)}" text-anchor="middle" fill="${color}" font-family="Arial, sans-serif" font-size="12">${escapeXml(pair.label.text)} ${escapeXml(pair.value.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cooperative 1881 issued roof datum consensus"><rect width="100%" height="100%" fill="#07111f"/><g>${lines}</g><g>${labels}</g><rect x="18" y="16" width="1564" height="64" rx="8" fill="#10243a" stroke="#334155"/><text x="34" y="42" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="17">COOPERATIVE 1881 — S-201 NATIVE ELEVATION SOURCE + CROSS-SHEET ROOF DATUM CONSENSUS</text><text x="34" y="66" fill="#fbbf24" font-family="Arial, sans-serif" font-size="13">eave ${consensus.eave.elevationInches} in · ridge ${consensus.ridge.elevationInches} in · rise ${consensus.ridgeAboveEaveInches} in · no pitch/member/clearance claim</text><text x="34" y="${height - 22}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="12">native S-201 linework; amber eave and cyan ridge source label/value callouts; consensus requires matching observations in S-201/S-202/S-301/S-302/S-303</text></svg>`;
}

async function sourceSheet(libredwg, sourceRoot, receipt) {
  const sourcePath = path.join(sourceRoot, receipt.source.fileName);
  const bytes = fs.readFileSync(sourcePath);
  const sha256 = sourceSha256(bytes);
  if (sha256 !== receipt.source.sha256) return { sheetId: receipt.sheetId, issues: [issue('ROOF_DATUM_SOURCE_HASH_MISMATCH', `${receipt.sheetId} no longer matches its sealed native-DWG receipt.`, [sourcePath, receipt.source.sha256, sha256])] };
  const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  try {
    const converted = libredwg.convertEx(raw);
    if (Number(converted.stats.unknownEntityCount || 0) !== 0 || Number(receipt.source.unknownEntityCount || 0) !== 0) return { sheetId: receipt.sheetId, issues: [issue('ROOF_DATUM_DWG_PARSER_UNKNOWN_ENTITY', `${receipt.sheetId} has unknown native DWG entities.`, [sourcePath])] };
    const extracted = extractRoofDatumPairs({ sheetId: receipt.sheetId, source: receipt.source, entities: converted.database.entities });
    return { sheetId: receipt.sheetId, ...extracted };
  } finally {
    libredwg.dwg_free(raw);
  }
}

export async function extractCooperative1881IssuedRoofDatumConsensus({ sourceRoot = process.env.HALOFIRE_1881_ISSUED_STRUCTURAL_ROOT || DEFAULT_SOURCE_ROOT } = {}) {
  const receipt = JSON.parse(fs.readFileSync(PREVIOUS_RECEIPT_PATH, 'utf8'));
  const sourceReceipts = receipt.sheets.filter((sheet) => TARGET_SHEETS.has(sheet.sheetId));
  const issues = [];
  if (sourceReceipts.length !== TARGET_SHEETS.size || !sourceReceipts.every((sheet) => sheet.source?.sha256 && sheet.source?.unknownEntityCount === 0)) issues.push(issue('ROOF_DATUM_PREREQUISITE_RECEIPT_INVALID', 'The sealed native-DWG receipt does not contain every zero-unknown elevation/section source sheet.'));
  const wasmRoot = path.resolve(APP, 'node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const sheets = [];
  for (const sourceReceipt of sourceReceipts) sheets.push(await sourceSheet(libredwg, sourceRoot, sourceReceipt));
  issues.push(...sheets.flatMap((sheet) => sheet.issues || []));
  const allPairs = sheets.flatMap((sheet) => sheet.pairs || []);
  const eave = consensusForPairs(allPairs.filter((pair) => pair.kind === 'roof-eave'));
  const ridge = consensusForPairs(allPairs.filter((pair) => pair.kind === 'roof-ridge'));
  if (!eave) issues.push(issue('ROOF_EAVE_DATUM_CONSENSUS_FAILED', 'Roof-eave source values are missing or disagree across issued elevation/section sources.'));
  if (!ridge) issues.push(issue('ROOF_RIDGE_DATUM_CONSENSUS_FAILED', 'Roof-ridge source values are missing or disagree across issued elevation/section sources.'));
  const consensus = eave && ridge ? { eave, ridge, ridgeAboveEaveInches: Number((ridge.elevationInches - eave.elevationInches).toFixed(6)) } : null;
  const visualSheet = sheets.find((sheet) => sheet.sheetId === 'S-201');
  const artifact = {
    artifactType: 'halofire.cooperative-1881-issued-roof-datum-consensus.v1', projectName: receipt.projectName, sourceRoot,
    status: issues.length ? 'blocked' : 'passed', sheets: sheets.map(({ elevationLinework, ...sheet }) => sheet), consensus, issues,
    claims: {
      sourceDatumConsensusReady: Boolean(consensus), roofPitchReady: false, perMemberVerticalDatumReady: false,
      exactPhysicalFramingPromoted: false, automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false,
      fabricationReady: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false,
    },
    limitations: [
      'Roof-ridge-minus-eave vertical separation is source-observed only; a roof pitch needs an independently source-bound horizontal run.',
      'No emitted datum is associated with a particular S-190 member, roof face, section cut, or sprinkler.',
      'No physical framing, obstruction, clearance, fabrication, code, employee, or VPS release claim is cleared.',
    ],
  };
  return { artifact, svg: consensus && visualSheet?.elevationLinework?.length ? renderRoofDatumConsensusSvg({ visualSheet, consensus }) : null };
}

async function main() {
  const { artifact, svg } = await extractCooperative1881IssuedRoofDatumConsensus();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  if (svg) fs.writeFileSync(PROOF_PATH, svg);
  process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, proofPath: svg ? PROOF_PATH : null, status: artifact.status, consensus: artifact.consensus, issues: artifact.issues }, null, 2)}\n`);
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) await main();
