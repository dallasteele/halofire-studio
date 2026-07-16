import fs from 'node:fs';

import { buildPolarisPitchedHydraulicNetwork } from '../src/engine/polaris-pitched-hydraulic-network.js';

const EXPECTED_UPSTREAM_HASHES = Object.freeze({
  fireLineCad: 'EE9B22E5235AC137882BDB680A0295AFF87C53D444ED939E28CDA0A7EAAB9C9A',
  sitePlan: '05580889F5D855EED5A54C76DE1CFB5371B984B52F1C2822DF6838ECE8C314EC',
  sourceCandidate: 'D31FCA25A97FCAE42950C8B489988BC6B3A683A34D4673ED07561BF686BF50F5',
});

const dataUrl = (name) => new URL(`../src/data/${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(dataUrl(name), 'utf8'));

export function assertPolarisReplayUpstreamHashes(previous) {
  const actualHashes = {
    fireLineCad: previous.sourceBoundary?.fireLineCad?.source?.sha256,
    sitePlan: previous.sourceBoundary?.fireLineRegistration?.sources?.sitePlan?.sha256,
    sourceCandidate: previous.sourceBoundary?.fireLineRegistration?.sources?.sprinklerCandidate?.sha256,
  };
  for (const [source, expectedHash] of Object.entries(EXPECTED_UPSTREAM_HASHES)) {
    if (actualHashes[source] !== expectedHash) {
      throw new Error(`POLARIS_REPLAY_UPSTREAM_HASH_INVALID:${source}`);
    }
  }
  return actualHashes;
}

export function replayPolarisPitchedHydraulicNetwork() {
  const previous = read('polaris-pitched-hydraulic-network.json');
  assertPolarisReplayUpstreamHashes(previous);

  return buildPolarisPitchedHydraulicNetwork({
    pipeCalibration: read('polaris-pitched-pipe-xyz-calibration.json'),
    atticReport: read('polaris-hydraulic-calcs-attic.json'),
    belowCeilingReport: read('polaris-hydraulic-calcs-below-ceiling.json'),
    fireLineEvidence: previous.sourceBoundary.fireLineCad,
    fireLineRegistration: previous.sourceBoundary.fireLineRegistration,
    sourceContinuityEvidence: read('polaris-pipe-layout-source-continuity.json'),
    drainageCodeBasis: read('polaris-wet-pipe-drainage-code-basis.json'),
    manufacturerDimensionSchedule: read('polaris-victaulic-primary-dimensions.json'),
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const outputPath = process.argv[2]
    ? new URL(process.argv[2], `file:///${process.cwd().replaceAll('\\', '/')}/`)
    : dataUrl('polaris-pitched-hydraulic-network.json');
  const packet = replayPolarisPitchedHydraulicNetwork();
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath: outputPath.pathname,
    receiptSha256: packet.receiptSha256,
    fittingJunctionMetrics: packet.fittingSemantics.sourceJunctionGraph.metrics,
    boundedSupplyTeeInterPieceAdjacencyReady: packet.claims.boundedSupplyTeeInterPieceAdjacencyReady,
    boundedInspectorTestDrainInterPieceAdjacencyReady:
      packet.claims.boundedInspectorTestDrainInterPieceAdjacencyReady,
    properPipeLayoutReady: packet.claims.properPipeLayoutReady,
  }, null, 2)}\n`);
}
