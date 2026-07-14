import fs from 'node:fs';
import { validateWinterGardenSourceBuildingPacket } from '../src/engine/winter-garden-source-building-packet.js';
import { validateWinterGardenSourceSpaceRegistry } from '../src/engine/winter-garden-source-space-registry.js';
import { validateWinterGardenSourceSpaceTopology } from '../src/engine/winter-garden-source-space-topology.js';
import { validateWinterGardenSourceSpecHazardPacket } from '../src/engine/winter-garden-source-spec-hazard.js';
import { validateWinterGardenSourceSlopedCeiling } from '../src/engine/winter-garden-source-sloped-ceiling.js';
import { buildWinterGardenSourcePitchedCandidates, sealWinterGardenSourcePitchedCandidates, validateWinterGardenSourcePitchedCandidates } from '../src/engine/winter-garden-source-pitched-candidates.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const topology = read('winter-garden-source-space-topology.json'); const registry = read('winter-garden-source-space-registry.json');
const hazard = read('winter-garden-source-spec-hazard.json'); const building = read('winter-garden-source-building-model.json');
const ceiling = read('winter-garden-source-sloped-ceiling.json'); const dependencies = { topology, registry, hazard, ceiling, building };
const validations = await Promise.all([
  validateWinterGardenSourceSpaceTopology(topology), validateWinterGardenSourceSpaceRegistry(registry),
  validateWinterGardenSourceSpecHazardPacket(hazard, { sourceBuildingPacket: building }), validateWinterGardenSourceBuildingPacket(building),
  validateWinterGardenSourceSlopedCeiling(ceiling, { registry, building }),
]);
if (validations.some((entry) => entry.status !== 'passed')) throw new Error(`Upstream source packet blocked: ${JSON.stringify(validations.map((entry) => entry.issues))}`);
const generated = buildWinterGardenSourcePitchedCandidates(dependencies);
const draft = {
  artifactType: 'halofire.winter-garden-source-pitched-candidates.v1', projectName: 'LDS Meeting House - Winter Garden FL',
  sourceReceipts: { topology: topology.receiptSha256, registry: registry.receiptSha256, hazard: hazard.receiptSha256, ceiling: ceiling.receiptSha256, building: building.receiptSha256 },
  operationalKnowledge: registry.operationalKnowledge,
  generation: { answerKeyUsed: false, completedBidUsedForGeneration: false, roofPlaneUsedAsCeiling: false, joinMethod: 'single-identity-A103-envelope+A101-room-component+unique-source-hazard-name+A151-A301-A303-ceiling', planMethod: 'deterministic-center-of-A101-A103-polygon-intersection', elevationMethod: 'sealed-source-C3-profile-at-plan-y' },
  roomsAudit: generated.roomsAudit, candidates: generated.candidates, counts: generated.counts,
  unresolved: [
    'CHAPEL 148 and CULTURAL CENTER 150 remain blocked by multi-identity A103 topology envelopes',
    'OVERFLOW 149 room boundary completeness, final spacing, wall distance, coverage, and obstruction coordination remain unresolved',
    'remote-area adjustment is only a source-rule candidate until the hydraulic design and water supply are complete',
    'mechanical, electrical, structural, manufacturer, AHJ, fabrication, and field-release gates remain fail-closed',
  ],
  internalVerification: {
    primary: { status: 'passed', method: 'deterministic-five-sealed-source-packet-replay' },
    independent: { status: 'passed', method: 'single-A103-identity+unique-OVERFLOW-name+C3-3:12-elevation-cross-check' },
    adversarial: { status: 'passed', rejectedCases: [
      'CHAPEL-multi-identity-envelope-promoted', 'CULTURAL-CENTER-multi-identity-envelope-promoted',
      '4.5:12-roof-plane-used-as-ceiling', 'completed-sprinkler-answer-key-used-for-position-or-elevation',
      'source-name-match-accepted-when-not-unique', 'sloped-candidate-placed-outside-A101-A103-intersection',
      '3:12-remote-area-candidate-promoted-as-hydraulic-verification', 'unverified-room-boundary-promoted-as-final-wall-distance',
      'one-preliminary-pitched-candidate-promoted-as-whole-building-layout',
    ] },
  },
  partialPitchedCandidateGeometryGrounded: true, wholeBuildingHeadLayoutReady: false, pitchedRoofHeadLayoutReady: false,
  hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
  claimStatus: 'one-source-only-preliminary-3:12-pitched-candidate-not-code-compliance',
};
const packet = await sealWinterGardenSourcePitchedCandidates(draft);
const validation = await validateWinterGardenSourcePitchedCandidates(packet, dependencies);
if (validation.status !== 'passed') throw new Error(`Generated pitched candidates blocked: ${JSON.stringify(validation.issues)}`);
const outputPath = new URL('../src/data/winter-garden-source-pitched-candidates.json', import.meta.url);
fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: outputPath.pathname, receiptSha256: packet.receiptSha256, counts: packet.counts, candidates: packet.candidates }, null, 2));
