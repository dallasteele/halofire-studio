import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDillonStructuralRoofPacket } from '../src/engine/dillon-structural-roof-surfaces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src/data', name), 'utf8'));
const packet = await buildDillonStructuralRoofPacket(
  read('dillon-structural-framing-roof-source.json'),
  read('dillon-floor-by-floor-model.json'),
  read('submitted-sloped-ceiling-calibration.dillon.json'),
);
if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'src/data/dillon-structural-roof-surfaces.json'), `${JSON.stringify(packet)}\n`);
else process.stdout.write(`${JSON.stringify(packet)}\n`);
