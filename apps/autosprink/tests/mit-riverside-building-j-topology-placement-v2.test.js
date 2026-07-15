import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMitRiversideBuildingJTopologyPlacementV2,
  validateMitRiversideBuildingJTopologyPlacementV2,
  verifyMitRiversideBuildingJTopologyPlacementV2AdversarialLoop,
} from '../src/engine/mit-riverside-building-j-topology-placement-v2.js';
import {
  buildMitRiversideBuildingJTopologyPlacementV2Score,
  validateMitRiversideBuildingJTopologyPlacementV2Score,
  verifyMitRiversideBuildingJTopologyPlacementV2ScoreAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-topology-placement-v2-score.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const inputs = read('mit-riverside-building-j-source-placement-inputs.json');
const topology = read('mit-riverside-building-j-source-topology-inputs.json');
const candidate = read('mit-riverside-building-j-topology-placement-v2.json');
const answer = read('mit-riverside-building-j-head-coordinate-registration.json');
const targets = read('mit-riverside-building-j-ceiling-installation-envelope.json');
const score = read('mit-riverside-building-j-topology-placement-v2-score.json');

describe('MIT Riverside Building J topology-aware placement v2', () => {
  it('replays exactly 68 source-only candidates before the answer is opened', async () => {
    expect(await buildMitRiversideBuildingJTopologyPlacementV2(inputs, topology)).toEqual(candidate);
    expect(await validateMitRiversideBuildingJTopologyPlacementV2(candidate, inputs, topology)).toMatchObject({
      status: 'passed', sourceGeneratedCandidateReady: true, sourceGeneratedPlacementVerified: false, complianceReady: false,
    });
    expect(candidate.counts).toMatchObject({ total: 68, upright: 53, pendent: 15, mainOpenStructure: 36, membraneOpenStructure: 17 });
    expect(candidate.sequence).toMatchObject({ answerArtifactRead: false, completedLayoutRead: false, sourceCandidateSealedBeforeAnswerOpen: true });
    expect(candidate.heads.every((head) => head.headInstallationZFt === null && !head.obstructionClearanceVerified && !head.hydraulicNodeAssigned)).toBe(true);
  });

  it('binds real framing axes, O.T.S. room topology, and ceiling components', () => {
    expect(candidate.mainOpenStructureAudit).toMatchObject({ columns: 6, rows: 6 });
    expect(candidate.mainOpenStructureAudit.sourcePlacementAxisIds).toHaveLength(6);
    expect(candidate.membraneRoomAudit.map((entry) => [entry.roomId, entry.candidateIds.length])).toEqual([
      ['J100', 3], ['J104', 8], ['J105', 1], ['J106', 1], ['J107', 1], ['J108', 2], ['J110', 1],
    ]);
    expect(candidate.ceilingComponentAudit.map((entry) => entry.candidateIds.length)).toEqual([4, 3, 2, 6, 0]);
    expect(candidate.ceilingComponentAudit[3].method).toBe('source-strip-center-edge-anchor-and-12ft-run');
    expect(candidate.sourceTopologyReceiptSha256).toBe(topology.receiptSha256);
  });

  it('keeps answer and score artifacts out of the generator path', () => {
    const engine = fs.readFileSync(new URL('../src/engine/mit-riverside-building-j-topology-placement-v2.js', import.meta.url), 'utf8');
    const generator = fs.readFileSync(new URL('../scripts/build-mit-riverside-building-j-topology-placement-v2.mjs', import.meta.url), 'utf8');
    expect(`${engine}\n${generator}`).not.toMatch(/head-coordinate-registration|ceiling-installation-envelope|topology-placement-v2-score|approved-plan|as-built|answer-evidence/);
  });

  it('rejects all 20 generator provenance, geometry, and promotion attacks', async () => {
    const result = await verifyMitRiversideBuildingJTopologyPlacementV2AdversarialLoop(candidate, inputs, topology);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 20, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(20);
  });

  it('passes the unchanged answer-only count, kind, and 2-foot calibration policy', async () => {
    const candidateSnapshot = JSON.stringify(candidate);
    expect(await buildMitRiversideBuildingJTopologyPlacementV2Score(candidate, answer, targets)).toEqual(score);
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
    expect(await validateMitRiversideBuildingJTopologyPlacementV2Score(score, candidate, answer, targets)).toMatchObject({
      status: 'passed', buildingJCalibrationScored: true, sourceGeneratedPlacementVerified: true, complianceReady: false,
    });
    expect(score.counts).toMatchObject({ deltaTotal: 0, deltaUpright: 0, deltaPendent: 0 });
    expect(score.xyScore.thresholdMatches).toEqual([
      { thresholdFt: 1, matched: 53, answerRecallPct: 77.941 },
      { thresholdFt: 2, matched: 68, answerRecallPct: 100 },
      { thresholdFt: 4, matched: 68, answerRecallPct: 100 },
      { thresholdFt: 6, matched: 68, answerRecallPct: 100 },
    ]);
    expect(score.xyScore).toMatchObject({ meanDistanceFt: 0.711407, maximumDistanceFt: 1.902976, unmatchedGeneratedIds: [], unmatchedAnswerIds: [] });
    expect(score.acceptance).toMatchObject({ countParity: true, kindParity: true, xyWithin2FtAtLeast90Pct: true, noUnmatchedAnswer: true, accepted: true });
    expect(score).toMatchObject({ freshProjectPlacementVerified: false, obstructionClearancesVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects all 18 scorer mutation and false-promotion attacks', async () => {
    const result = await verifyMitRiversideBuildingJTopologyPlacementV2ScoreAdversarialLoop(score, candidate, answer, targets);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(18);
  });

  it('binds four browser-inspected views with the actual protected PDF underlay', () => {
    const proofUrl = new URL('../src/data/proofs/mit-riverside-building-j-topology-placement-v2/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofUrl), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofUrl))).digest('hex');
    expect(proof.visualReview).toMatchObject({ browserInspected: true, decodedImageCount: 4, consoleErrors: 0, normalZoomLayoutReadable: true, protectedUnderlaysVisiblyPresent: true, calibrationPassVisiblyDisclosed: true, remainingFailureBoundaryVisiblyDisclosed: true });
    expect(proof.claimBoundary).toMatchObject({ sourceGeneratedPlacementVerified: true, freshProjectPlacementVerified: false, obstructionClearancesVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    for (const section of ['roofPlan', 'rcp', 'elevation', 'model3d']) expect(digest(proof[section].file)).toBe(proof[section].sha256);
    const html = fs.readFileSync(new URL('index.html', proofUrl), 'utf8');
    expect(html).toContain('CALIBRATION GATE PASSED');
    expect(html).toContain('Actual protected architectural PDF underlay');
    expect(html).toContain('Fresh-project holdout, obstruction clearance, compliance, hydraulics, fabrication, and release remain blocked');
  });
});
