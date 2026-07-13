import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildOrthogonalGableBuildingModel } from '../src/engine/orthogonal-gable-building-model.js';
import { renderOrthogonalGableBuildingViews } from '../src/engine/orthogonal-gable-building-views.js';
import { sealWinterGardenSourceBuildingPacket } from '../src/engine/winter-garden-source-building-packet.js';
import { buildHaloFireOperationalKnowledgeReceipt } from '../src/engine/halofire-operational-knowledge.js';

const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const grid = readJson('winter-garden-grid-registration-gate.json');
const roomsGate = readJson('winter-garden-room-fusion-gate.json');
const roofAnalysis = readJson('winter-garden-roof-line-analysis.json');
const sourceSet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url), 'utf8'));
if (grid.answerKeyUsed !== false || roomsGate.answerKeyUsed !== false) throw new Error('Source-only proof was contaminated by the completed answer key.');
const sourceHashes = new Map(grid.sources.map((source) => [source.sheet, source.sha256]));
for (const binding of roomsGate.sourceBindings) {
  if (sourceHashes.has(binding.sheet) && sourceHashes.get(binding.sheet) !== binding.sha256) throw new Error(`${binding.sheet} proof binding drift`);
  sourceHashes.set(binding.sheet, binding.sha256);
}
for (const sheet of ['A201', 'A301']) {
  const binding = sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.sheet === sheet);
  if (!binding) throw new Error(`${sheet} source binding is missing.`);
  sourceHashes.set(sheet, binding.sha256);
}
const selected = roomsGate.candidates.find((candidate) => candidate.id === 'a103-inclusive-plus-a151-cut-collinear-bridge-3');
if (!selected || selected.roomCount !== 56) throw new Error('Promoted source-only room candidate is missing or drifted.');
if (roofAnalysis.skeleton?.status !== 'passed' || roofAnalysis.skeleton.crossGables?.length !== 4) throw new Error('A121 source roof skeleton is incomplete.');

const model = buildOrthogonalGableBuildingModel({
  footprintPlanFt: grid.exterior.polygonFt,
  roofSkeleton: roofAnalysis.skeleton,
  floorElevationFt: 100,
  wallTopElevationFt: 111 + (6 + 5 / 16) / 12,
  mainBearingElevationFt: 115 + 8 / 12,
  mainRidgeElevationFt: 125 + 11.5 / 12,
  lowRoofElevationFt: 113,
  pitchRiseIn: 4.5,
  pitchRunIn: 12,
  rooms: selected.rooms,
  features: roofAnalysis.skeleton.roofFeatures.slice(0, 1).map((feature) => ({
    id: 'steeple',
    kind: 'steeple',
    footprintPlanFt: [[feature.minX, feature.minY], [feature.maxX, feature.minY], [feature.maxX, feature.maxY], [feature.minX, feature.maxY]],
    baseElevationFt: 100,
    beamElevationFt: 128 + 8 / 12,
    topElevationFt: 155,
    sourcePlanFeatureId: feature.id,
  })),
  sourceRefs: [...sourceHashes.entries()].map(([sheet, sha256]) => `${sheet}:${sha256}`),
  unresolved: [
    'outer vestibule low-roof drainage slopes are unresolved; the proof renders their source 113-foot bearing datum plane',
    'roof penetration obstruction clearances remain a separate fail-closed coordination gate',
  ],
});
if (model.status !== 'passed' || model.verification.exactPitchReplay !== true) throw new Error(`Source building model blocked: ${JSON.stringify(model.issues)}`);
const views = renderOrthogonalGableBuildingViews(model);
if (views.status !== 'passed') throw new Error('Source building view render blocked.');
const sourcePacket = await sealWinterGardenSourceBuildingPacket({
  artifactType: 'halofire.winter-garden-source-building-packet.v1',
  projectName: 'LDS Meeting House - Winter Garden FL',
  sourceBindings: [...sourceHashes.entries()].map(([sheet, sha256]) => ({ sheet, sha256 })),
  generation: { answerKeyUsed: false, roomCandidateId: selected.id, method: 'A103-dimension-viewport+A151-registered-cut-walls+A121-vector-ridge-valleys+A201-A301-datums' },
  operationalKnowledge: buildHaloFireOperationalKnowledgeReceipt({
    sessionId: 'winter-garden-source-building-operational-knowledge-20260713',
    preflightQuery: 'Halo Fire operations knowledge must actively constrain Winter Garden source-spec hazard and sprinkler generation across estimating, design engineering, procurement, fabrication, field installation, approvals, change control, closeout, and internal adversarial verification',
    recallEpisodeIds: [140193, 140208, 139873, 140198, 140199, 139750, 139418, 136034],
    recalledWikiPages: [
      'decisions/halo-forge-stream-d-sprinkler-alpha-workflow-correction-loop-design-artifact-2026.md',
      'decisions/2026-05-15-halo-forge-stream-d-sprinkler-separate-design-issues-from-nfpa-ahj.md',
      'decisions/halo-forge-sprinkler-catalog-engineering-gate-2026-05-13.md',
    ],
    companyFlowEpisodeIds: [140193, 140208, 139873, 140198, 140199],
    companyFlowPages: [
      'halofire-master/COMPANY_OPERATIONS_FLOW.md',
      'halofire-master/00-Company/00_Company_Org.md',
      'halofire-master/05-Fabrication-Shop/05_Fabrication_Shop.md',
      'halofire-master/09-Finance-Admin/09_Finance_Admin.md',
    ],
  }),
  model,
  geometryGrounded: true,
  complianceReady: false,
  fabricationReady: false,
  claimStatus: model.claimStatus,
});
const sourcePacketPath = path.resolve(process.cwd(), 'src/data/winter-garden-source-building-model.json');
fs.writeFileSync(sourcePacketPath, JSON.stringify(sourcePacket, null, 2));

const [iso, top, elevation, section] = await Promise.all([
  loadImage(Buffer.from(views.isometricSvg)),
  loadImage(Buffer.from(views.topSvg)),
  loadImage(path.join(OUT_DIR, 'wg-a201.png')),
  loadImage(path.join(OUT_DIR, 'wg-a301.png')),
]);
const width = 3000; const headerHeight = 220; const modelHeight = 920; const sourceHeight = 980;
const canvas = createCanvas(width, headerHeight + modelHeight + sourceHeight); const context = canvas.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#ffffff'; context.font = 'bold 48px sans-serif'; context.fillText('WINTER GARDEN · PDF → SCALED BUILDING + PITCHED ROOF', 55, 66);
context.fillStyle = '#a7f3d0'; context.font = '27px sans-serif'; context.fillText('A103 floor geometry · A121 ridge/valley skeleton · A201/A301 elevation datums · A151 room-wall registration', 55, 112);
context.fillStyle = '#fbbf24'; context.fillText('201 ft 8 in × 90 ft 8 in · floor 100-0 · wall 111-6 5/16 · low roof 113-0 · bearing 115-8 · ridge 125-11 1/2 · pitch 4.5:12', 55, 152);
context.fillStyle = '#fb7185'; context.fillText('SOURCE ARCHITECTURE ONLY · COMPLETED SPRINKLER ANSWER KEY NOT LOADED · NOT COMPLIANCE OR FABRICATION RELEASE', 55, 194);
context.drawImage(iso, 0, headerHeight, 1500, modelHeight);
context.drawImage(top, 1500, headerHeight, 1500, modelHeight);
context.drawImage(elevation, 0, headerHeight + modelHeight, 1500, sourceHeight);
context.drawImage(section, 1500, headerHeight + modelHeight, 1500, sourceHeight);
context.fillStyle = 'rgba(7,17,31,.88)'; context.fillRect(0, headerHeight + modelHeight, 1500, 74); context.fillRect(1500, headerHeight + modelHeight, 1500, 74);
context.fillStyle = '#ffffff'; context.font = 'bold 28px sans-serif'; context.fillText('A201 · BUILDING ELEVATIONS / VERTICAL SOURCE', 35, headerHeight + modelHeight + 46); context.fillText('A301 · BUILDING SECTIONS / PITCH + BEARING SOURCE', 1535, headerHeight + modelHeight + 46);

const imagePath = path.join(OUT_DIR, 'winter-garden-whole-building-3d-proof.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-whole-building-3d-proof.json');
fs.writeFileSync(imagePath, canvas.encodeSync('png'));
const manifest = {
  artifactType: 'halofire.winter-garden-source-building-3d-proof.v1',
  projectName: 'LDS Meeting House - Winter Garden FL',
  sourceBindings: [...sourceHashes.entries()].map(([sheet, sha256]) => ({ sheet, sha256 })),
  generationInputs: { roomCandidateId: selected.id, answerKeyUsed: false, floorPlan: 'A103', roofPlan: 'A121', reflectedCeilingPlan: 'A151', elevations: 'A201', sections: 'A301' },
  operationalKnowledge: sourcePacket.operationalKnowledge,
  counts: { rooms: model.rooms.length, exteriorEdges: model.walls.length, mainRoofPlanes: 2, crossGablePlanes: model.surfaces.filter((surface) => surface.kind === 'cross-gable-roof').length, lowRoofDatumPlanes: model.surfaces.filter((surface) => surface.kind === 'low-roof-datum-plane').length, totalRoofSurfaces: model.surfaces.length, verticalFeatures: model.features.length },
  datums: { floorElevationFt: model.floorElevationFt, wallTopElevationFt: model.wallTopElevationFt, mainRoof: model.mainRoof },
  verification: model.verification,
  unresolved: model.unresolved,
  geometryGrounded: true,
  complianceReady: false,
  fabricationReady: false,
  sourcePacketReceiptSha256: sourcePacket.receiptSha256,
  sourcePacketPath,
  imageSha256: sha256File(imagePath),
  claimStatus: model.claimStatus,
};
fs.writeFileSync(jsonPath, JSON.stringify({ ...manifest, model, views }, null, 2));
console.log(JSON.stringify({ imagePath, jsonPath, ...manifest }, null, 2));
