import fs from 'node:fs';
import path from 'node:path';
import {
  buildWinterGardenSourceSpecHazardPacket,
  validateWinterGardenSourceSpecHazardPacket,
} from '../src/engine/winter-garden-source-spec-hazard.js';

const sourceBuildingPath = path.resolve(process.cwd(), 'src/data/winter-garden-source-building-model.json');
const outputPath = path.resolve(process.cwd(), 'src/data/winter-garden-source-spec-hazard.json');
const sourceBuildingPacket = JSON.parse(fs.readFileSync(sourceBuildingPath, 'utf8'));
const packet = await buildWinterGardenSourceSpecHazardPacket({
  sourceBuildingPacket,
  operationalKnowledge: sourceBuildingPacket.operationalKnowledge,
});
const validation = await validateWinterGardenSourceSpecHazardPacket(packet, { sourceBuildingPacket });
if (validation.status !== 'passed') throw new Error(`Winter Garden source-spec hazard packet blocked: ${JSON.stringify(validation.issues)}`);
fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  receiptSha256: packet.receiptSha256,
  counts: validation.counts,
  sourceSpecGrounded: validation.sourceSpecGrounded,
  wholeBuildingHazardZoningComplete: validation.wholeBuildingHazardZoningComplete,
  complianceReady: validation.complianceReady,
}, null, 2));
