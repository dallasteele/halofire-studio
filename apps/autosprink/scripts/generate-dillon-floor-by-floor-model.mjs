import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDillonFloorByFloorModel, validateDillonFloorByFloorModel } from '../src/engine/dillon-floor-by-floor-model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/data/dillon-dwg-source-geometry.json');
const outputPath = path.join(root, 'src/data/dillon-floor-by-floor-model.json');
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const model = await buildDillonFloorByFloorModel(source);
const validation = await validateDillonFloorByFloorModel(model, source);
if (validation.status !== 'passed') throw new Error(validation.issues.map((issue) => issue.code).join(', '));
await fs.writeFile(outputPath, `${JSON.stringify(model)}\n`);
console.log(JSON.stringify({ outputPath, receiptSha256: model.receiptSha256, counts: validation.counts }, null, 2));
