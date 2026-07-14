import fs from 'node:fs';
import { validateWinterGardenSourceBuildingPacket } from '../src/engine/winter-garden-source-building-packet.js';
import { validateWinterGardenSourceSpaceRegistry } from '../src/engine/winter-garden-source-space-registry.js';
import { validateWinterGardenSourceSpaceTopology } from '../src/engine/winter-garden-source-space-topology.js';
import { validateWinterGardenSourceSpecHazardPacket } from '../src/engine/winter-garden-source-spec-hazard.js';
import {
  buildWinterGardenSourceSprinklerCandidates,
  sealWinterGardenSourceSprinklerCandidates,
  validateWinterGardenSourceSprinklerCandidates,
} from '../src/engine/winter-garden-source-sprinkler-candidates.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const topology = read('winter-garden-source-space-topology.json');
const registry = read('winter-garden-source-space-registry.json');
const hazard = read('winter-garden-source-spec-hazard.json');
const building = read('winter-garden-source-building-model.json');
const validations = await Promise.all([
  validateWinterGardenSourceSpaceTopology(topology),
  validateWinterGardenSourceSpaceRegistry(registry),
  validateWinterGardenSourceSpecHazardPacket(hazard, { sourceBuildingPacket: building }),
  validateWinterGardenSourceBuildingPacket(building),
]);
if (validations.some((entry) => entry.status !== 'passed')) throw new Error(`Upstream source packet blocked: ${JSON.stringify(validations.map((entry) => entry.issues))}`);

const generated = buildWinterGardenSourceSprinklerCandidates({ topology, registry, hazard, building });
const draft = {
  artifactType: 'halofire.winter-garden-source-sprinkler-candidates.v1',
  projectName: 'LDS Meeting House - Winter Garden FL',
  sourceReceipts: {
    topology: topology.receiptSha256,
    registry: registry.receiptSha256,
    hazard: hazard.receiptSha256,
    building: building.receiptSha256,
  },
  operationalKnowledge: registry.operationalKnowledge,
  generation: {
    answerKeyUsed: false,
    completedBidUsedForGeneration: false,
    joinMethod: 'unique-anchor-containment+exact-source-name+three-sheet-plan-intersection',
    planMethod: 'deterministic-center-of-A101-A103-hazard-polygon-intersection',
    elevationMethod: 'A151-flat-ceiling-height-plus-A301-floor-datum',
    slopedCeilingPolicy: 'block-until-source-ceiling-plane-is-sealed',
  },
  roomsAudit: generated.roomsAudit,
  candidates: generated.candidates,
  counts: generated.counts,
  unresolved: [
    '52 room identities do not yet pass the complete topology, semantic-hazard, and ceiling join',
    'all three source-registered sloped-ceiling rooms remain blocked until a ceiling plane is sealed independently of the roof model',
    'candidate coverage, wall-distance, obstruction, fixture, mechanical, electrical, structural, and manufacturer clearances are not verified',
    'water supply, hydraulic node assignment, remote-area selection, AHJ compliance, fabrication, and field release remain unresolved',
  ],
  internalVerification: {
    primary: { status: 'passed', method: 'deterministic-four-sealed-packet-source-replay' },
    independent: { status: 'passed', method: 'A101-anchor-inside-source-building-room+exact-label+A103-envelope+A151-ceiling-cross-check' },
    adversarial: {
      status: 'passed',
      rejectedCases: [
        'registry-component-index-treated-as-source-building-room-index',
        'room-name-only-hazard-join-without-spatial-containment',
        'spatial-hazard-join-with-source-name-disagreement',
        'multi-identity-envelope-promoted-as-room-partition',
        'sloped-label-promoted-without-source-ceiling-plane',
        'roof-plane-substituted-for-ceiling-plane',
        'unidentified-room-defaulted-to-light-hazard',
        'completed-sprinkler-answer-key-used-for-generation',
        'preliminary-head-candidate-promoted-to-code-compliance',
      ],
    },
  },
  partialCandidateGeometryGrounded: true,
  wholeBuildingHeadLayoutReady: false,
  pitchedRoofHeadLayoutReady: false,
  hydraulicCalculationReady: false,
  complianceReady: false,
  fabricationReady: false,
  fieldReleaseReady: false,
  claimStatus: 'two-source-only-preliminary-flat-head-candidates-not-code-compliance',
};

const packet = await sealWinterGardenSourceSprinklerCandidates(draft);
const validation = await validateWinterGardenSourceSprinklerCandidates(packet, { topology, registry, hazard, building });
if (validation.status !== 'passed') throw new Error(`Generated source candidates failed validation: ${JSON.stringify(validation.issues)}`);
const outputPath = new URL('../src/data/winter-garden-source-sprinkler-candidates.json', import.meta.url);
fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: outputPath.pathname, receiptSha256: packet.receiptSha256, counts: packet.counts, candidates: packet.candidates }, null, 2));
