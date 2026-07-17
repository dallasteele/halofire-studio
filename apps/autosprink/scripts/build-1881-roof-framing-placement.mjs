import fs from 'node:fs';
import path from 'node:path';

import { reconstructRoofPlanes } from '../src/engine/roof-geometry.js';
import { evaluateSourceBoundRoofFraming } from '../src/engine/source-bound-roof-framing.js';

const candidatesPath = path.resolve('src/data/registered-roof-framing.cooperative-1881.json');
const roofPath = path.resolve('src/data/roof-reconstruction.cooperative-1881.json');
const outputPath = path.resolve('src/data/roof-framing-placement.cooperative-1881.json');
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const roofInput = JSON.parse(fs.readFileSync(roofPath, 'utf8'));

if (candidates.artifact_type !== 'halofire.registered-roof-framing-candidates.v1') {
  throw new Error('registered roof-framing candidate artifact type mismatch');
}
const architecturalBinding = roofInput.sourceBindings.find((entry) => entry.id === 'roof-plan-A121');
if (architecturalBinding?.binding?.sourcePdfSha256 !== candidates.source_architectural_pdf_sha256) {
  throw new Error('roof and structural registrations do not share the same architectural source hash');
}
const roofModel = await reconstructRoofPlanes(roofInput);
if (roofModel.status !== 'passed') throw new Error(`roof reconstruction is not passed: ${JSON.stringify(roofModel.issues)}`);
const result = evaluateSourceBoundRoofFraming({ roofModel, candidates });
if (!result.evaluationComplete || result.counts.skipped !== 0) {
  throw new Error(`framing accounting gate failed: ${JSON.stringify(result.counts)}`);
}
fs.writeFileSync(outputPath, `${JSON.stringify({
  ...result,
  projectName: roofModel.projectName,
  candidateArtifact: path.relative(process.cwd(), candidatesPath).replaceAll('\\', '/'),
  roofArtifact: path.relative(process.cwd(), roofPath).replaceAll('\\', '/'),
  claims: {
    everyCandidateAccounted: true,
    hiddenSkips: false,
    physicalFramingPromoted: result.counts.exactPhysicalPlacements > 0,
    boundedWoodPromotedAsPhysical: false,
    employeeUseReady: false,
    vpsReleaseReady: false,
  },
})}\n`);
console.log(JSON.stringify({ outputPath, status: result.status, counts: result.counts, issues: result.issues }, null, 2));

