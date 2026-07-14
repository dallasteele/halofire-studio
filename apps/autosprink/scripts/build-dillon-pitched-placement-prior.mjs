import fs from 'node:fs';
import { buildDillonPitchedPlacementPrior } from '../src/engine/dillon-pitched-placement-prior.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = await buildDillonPitchedPlacementPrior({
  calibration: read('submitted-sloped-ceiling-calibration.dillon.json'),
  winterGardenHeldOut: read('winter-garden-source-pitched-heldout.json'),
});
fs.writeFileSync(new URL('../src/data/dillon-pitched-placement-prior.json', import.meta.url), `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({ receiptSha256: packet.receiptSha256, learnedGeometry: packet.learnedGeometry, calibrationResult: packet.calibrationResult }, null, 2));
