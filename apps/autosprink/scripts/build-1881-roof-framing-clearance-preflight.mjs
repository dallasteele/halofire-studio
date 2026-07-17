import fs from 'node:fs';
import path from 'node:path';

import { buildRoofFramingClearancePreflight } from '../src/engine/source-evidence-corpus.js';

const APP = path.resolve(import.meta.dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(APP, 'src/data', name), 'utf8'));
const result = buildRoofFramingClearancePreflight({
  placement: read('roof-framing-placement.cooperative-1881.json'),
  discovery: read('roof-framing-source-discovery.cooperative-1881.json'),
});
const outputPath = path.join(APP, 'src/data/roof-framing-clearance-preflight.cooperative-1881.json');
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, status: result.status, boundedMemberCount: result.boundedMemberCount, issues: result.issues }, null, 2));
