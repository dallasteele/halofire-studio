import fs from 'node:fs';
import path from 'node:path';
import { validateLevelFootprintPacket, polygonBounds } from '../src/engine/source-bound-footprint.js';
import { extractElevationDatums } from '../src/engine/elevation-datums.js';

const planPath = path.resolve(process.env.COOPERATIVE_1881_PLAN_LEVELS || 'src/data/plan-levels.cooperative-1881.json');
const footprintPath = path.resolve(process.env.COOPERATIVE_1881_FOOTPRINT_INPUT || 'src/data/source-bound-footprints.cooperative-1881.json');
const elevationPath = path.resolve(process.env.COOPERATIVE_1881_ELEVATION_INPUT || 'src/data/elevation-datums.cooperative-1881.json');
const packet = JSON.parse(fs.readFileSync(footprintPath, 'utf8'));
const validated = await validateLevelFootprintPacket(packet);
if (validated.status !== 'passed' || !validated.geometryComplete) throw new Error(`source-bound footprint packet not complete: ${validated.issues.map((entry) => entry.code).join(',')}`);
const elevationPacket = JSON.parse(fs.readFileSync(elevationPath, 'utf8'));
const elevations = await extractElevationDatums(elevationPacket, { expectedSourcePdfSha256: packet.sourcePdfSha256 });
if (elevations.status !== 'passed') throw new Error(`current elevation packet rejected: ${elevations.issues.map((entry) => entry.code).join(',')}`);
if (elevations.evidenceReceiptSha256 !== packet.elevationEvidenceReceiptSha256) throw new Error('footprint and elevation receipts disagree');

const data = JSON.parse(fs.readFileSync(planPath, 'utf8'));
if (!Array.isArray(data.levels) || data.levels.length !== packet.levels.length) throw new Error('plan-level count does not match footprint packet');
for (const level of data.levels) {
  const evidence = packet.levels.find((entry) => entry.level === level.level);
  if (!evidence || evidence.status !== 'passed') throw new Error(`missing passed footprint for level ${level.level}`);
  if (!level.plan || !Array.isArray(level.plan.walls) || !level.plan.walls.length) throw new Error(`level ${level.level} has no extracted source walls to preserve`);
  const bounds = polygonBounds(evidence.polygonPlanFt);
  level.elevationFt = evidence.elevationFt;
  level.elevationSource = 'SOURCE_BOUND_ARCHITECTURAL_ELEVATION_A-201';
  level.elevationEvidence = elevations.sourceBinding;
  level.elevationEvidenceReceiptSha256 = elevations.evidenceReceiptSha256;
  level.sourceBinding = evidence.sourceBinding;
  level.plan.footprintFt = evidence.polygonPlanFt;
  level.plan.footprintAreaSqft = evidence.areaSqft;
  level.plan.footprintBboxAreaSqft = bounds.widthFt * bounds.heightFt;
  level.plan.footprintAreaReliable = true;
  level.plan.footprintBboxFt = bounds;
  level.plan.footprintMethod = evidence.derivation.method;
  level.plan.sourceBinding = evidence.sourceBinding;
  level.plan.sourceBoundGeometryStatus = 'passed';
  level.plan.sourceBoundFootprintEvidenceReceiptSha256 = packet.evidenceReceiptSha256;
  level.plan.sourceBoundFootprintDerivation = evidence.derivation;
  level.plan.notes = {
    ...(level.plan.notes || {}),
    footprint: 'Current A-101 through A-108 source-bound exterior polygon. Simple-polygon, area-consistency, scale, grid/dimension, and immutable-receipt gates passed; sprinkler code compliance remains separate.',
  };
}
data.sourcePdfSha256 = packet.sourcePdfSha256;
data.generatedAt = new Date().toISOString();
data.generatedBy = `${data.generatedBy}; scripts/apply-source-bound-footprints.mjs`;
data.elevationEvidenceReceiptSha256 = elevations.evidenceReceiptSha256;
data.footprintEvidenceArtifact = 'src/data/source-bound-footprints.cooperative-1881.json';
data.footprintEvidenceReceiptSha256 = packet.evidenceReceiptSha256;
data.perLevelFootprintsVerified = true;
data.verticalDatumsVerified = true;
data.scaleNote = 'Each level binds its own current A-101 through A-108 page at the printed 3/32 inch equals 1 foot scale; no x8 geometry substitution.';
data.elevationNote = 'Floor elevations are bound to current A-201 physical page 61 and its immutable receipt.';
data.provenance = 'current Egnyte architectural sheets A-101 through A-108 plus A-201; source-bound geometry only, not sprinkler code compliance or approval';
fs.writeFileSync(planPath, JSON.stringify(data));
console.log(JSON.stringify({ planPath, levels: data.levels.map((level) => ({ level: level.level, sheet: level.sheet, areaSqft: level.plan.footprintAreaSqft, elevationFt: level.elevationFt, method: level.plan.footprintMethod })), footprintReceipt: packet.evidenceReceiptSha256, elevationReceipt: elevations.evidenceReceiptSha256 }, null, 2));
