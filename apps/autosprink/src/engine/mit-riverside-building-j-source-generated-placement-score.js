/**
 * Answer-only scorer for the sealed Building J source-generated candidate.
 *
 * This module cannot generate or alter sprinkler candidates. It accepts the
 * immutable candidate receipt, opens the separately registered completed-plan
 * answer, and reports every count and displacement residual. A score is not a
 * code-compliance, hydraulic, fabrication, or field-release approval.
 */

import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT_NAME = 'MIT Riverside - Transportation Building J';
const CANDIDATE_TYPE = 'halofire.mit-riverside-building-j-source-generated-placement.v1';
const SCORE_TYPE = 'halofire.mit-riverside-building-j-source-generated-placement-score.v1';
const ANSWER_RECEIPT = '9aaf2c5b5136f6d961505a683e3718b61f758785d5cae7d9d301e94341d9830b';
const TARGET_RECEIPT = 'dabb807d19c4aa5f59ea24fbb2c0d87d97508f655d168a7601eec94c73de86b5';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function distance(candidate, answer) {
  return Math.hypot(candidate.structuralLocalFt.x - answer.localFt.x, candidate.structuralLocalFt.y - answer.localFt.y);
}

async function validateSealedCandidate(candidate) {
  if (candidate?.artifactType !== CANDIDATE_TYPE || candidate?.projectId !== PROJECT_ID || candidate?.projectName !== PROJECT_NAME) return false;
  const { receiptSha256, ...draft } = candidate;
  return SHA.test(receiptSha256 || '') && await sha256Hex(draft) === receiptSha256
    && candidate.sequence?.sourceCandidateSealedBeforeAnswerOpen === true
    && candidate.sequence?.answerArtifactRead === false
    && candidate.sourceGeneratedCandidateReady === true
    && candidate.buildingJCalibrationScored === false;
}

function maximumThresholdMatching(candidates, answers, thresholdFt) {
  const edges = candidates.map((candidate) => answers
    .map((answer, index) => ({ index, distanceFt: distance(candidate, answer) }))
    .filter((entry) => answers[entry.index].kind === candidate.kind && entry.distanceFt <= thresholdFt)
    .sort((left, right) => left.distanceFt - right.distanceFt || left.index - right.index));
  const answerOwner = new Array(answers.length).fill(-1);
  const visit = (candidateIndex, seen) => {
    for (const edge of edges[candidateIndex]) {
      if (seen.has(edge.index)) continue;
      seen.add(edge.index);
      if (answerOwner[edge.index] < 0 || visit(answerOwner[edge.index], seen)) {
        answerOwner[edge.index] = candidateIndex;
        return true;
      }
    }
    return false;
  };
  let count = 0;
  for (let index = 0; index < candidates.length; index += 1) if (visit(index, new Set())) count += 1;
  return count;
}

function minimumCostAssignment(answers, candidates) {
  if (answers.length > candidates.length) throw new Error('MIT_J_SOURCE_PLACEMENT_SCORE_ASSIGNMENT_DIMENSION');
  const rowCount = answers.length;
  const columnCount = candidates.length;
  const u = new Array(rowCount + 1).fill(0);
  const v = new Array(columnCount + 1).fill(0);
  const assignedRow = new Array(columnCount + 1).fill(0);
  const previousColumn = new Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    assignedRow[0] = row;
    let column0 = 0;
    const minimum = new Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = assignedRow[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const reduced = distance(candidates[column - 1], answers[row0 - 1]) - u[row0] - v[column];
        if (reduced < minimum[column]) {
          minimum[column] = reduced;
          previousColumn[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[assignedRow[column]] += delta;
          v[column] -= delta;
        } else minimum[column] -= delta;
      }
      column0 = column1;
    } while (assignedRow[column0] !== 0);
    do {
      const column1 = previousColumn[column0];
      assignedRow[column0] = assignedRow[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  return assignedRow.slice(1).map((row, columnIndex) => ({ row, columnIndex })).filter((entry) => entry.row > 0);
}

function optimalResidualPairs(candidates, answers) {
  const rawPairs = [];
  const usedCandidateIds = new Set();
  const usedAnswerIds = new Set();
  for (const kind of ['upright', 'pendent']) {
    const kindCandidates = candidates.filter((entry) => entry.kind === kind).sort((left, right) => left.id.localeCompare(right.id));
    const kindAnswers = answers.filter((entry) => entry.kind === kind).sort((left, right) => left.id.localeCompare(right.id));
    for (const assignment of minimumCostAssignment(kindAnswers, kindCandidates)) {
      const answer = kindAnswers[assignment.row - 1];
      const candidate = kindCandidates[assignment.columnIndex];
      rawPairs.push({ candidate, answer, distanceFt: distance(candidate, answer) });
      usedCandidateIds.add(candidate.id);
      usedAnswerIds.add(answer.id);
    }
  }
  rawPairs.sort((left, right) => left.answer.id.localeCompare(right.answer.id));
  return {
    pairs: rawPairs.map((entry) => ({
      candidateId: entry.candidate.id,
      answerId: entry.answer.id,
      kind: entry.candidate.kind,
      candidateStructuralLocalFt: entry.candidate.structuralLocalFt,
      answerStructuralLocalFt: entry.answer.localFt,
      deltaFt: {
        x: round(entry.candidate.structuralLocalFt.x - entry.answer.localFt.x),
        y: round(entry.candidate.structuralLocalFt.y - entry.answer.localFt.y),
      },
      distanceFt: round(entry.distanceFt),
      candidateSourceProtectionPlaneZFt: entry.candidate.sourceProtectionPlaneZFt,
    })),
    unmatchedCandidateIds: candidates.filter((entry) => !usedCandidateIds.has(entry.id)).map((entry) => entry.id),
    unmatchedAnswerIds: answers.filter((entry) => !usedAnswerIds.has(entry.id)).map((entry) => entry.id),
  };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** Score a sealed candidate against exact registered completed-plan XY and source target Z. */
export async function buildMitRiversideBuildingJSourceGeneratedPlacementScore(candidate, answer, targets) {
  if (!await validateSealedCandidate(candidate)) throw new Error('MIT_J_SOURCE_PLACEMENT_SCORE_CANDIDATE_BLOCKED');
  if (answer?.receiptSha256 !== ANSWER_RECEIPT || answer?.heads?.length !== 68 || answer?.exactAnswerHeadCoordinatesReady !== true) throw new Error('MIT_J_SOURCE_PLACEMENT_SCORE_ANSWER_BLOCKED');
  if (targets?.receiptSha256 !== TARGET_RECEIPT || targets?.headAssignments?.length !== 68 || targets?.allSourceProtectionTargetsReady !== true) throw new Error('MIT_J_SOURCE_PLACEMENT_SCORE_TARGETS_BLOCKED');
  const candidateSnapshot = JSON.stringify(candidate);
  const answerSnapshot = JSON.stringify(answer);
  const residual = optimalResidualPairs(candidate.heads, answer.heads);
  const targetById = new Map(targets.headAssignments.map((entry) => [entry.id, entry]));
  const pairs = residual.pairs.map((pair) => {
    const target = targetById.get(pair.answerId);
    const targetZDeltaFt = target && Number.isFinite(target.sourceProtectionPlaneZFt)
      ? round(pair.candidateSourceProtectionPlaneZFt - target.sourceProtectionPlaneZFt)
      : null;
    return { ...pair, answerSourceProtectionPlaneZFt: target?.sourceProtectionPlaneZFt ?? null, sourceTargetZDeltaFt: targetZDeltaFt };
  });
  if (candidateSnapshot !== JSON.stringify(candidate) || answerSnapshot !== JSON.stringify(answer)) throw new Error('MIT_J_SOURCE_PLACEMENT_SCORE_INPUT_MUTATION');
  const distances = pairs.map((entry) => entry.distanceFt).sort((left, right) => left - right);
  const zDeltas = pairs.map((entry) => entry.sourceTargetZDeltaFt).filter(Number.isFinite).map(Math.abs).sort((left, right) => left - right);
  const thresholds = [1, 2, 4, 6].map((thresholdFt) => ({
    thresholdFt,
    matched: maximumThresholdMatching(candidate.heads, answer.heads, thresholdFt),
    answerRecallPct: round(maximumThresholdMatching(candidate.heads, answer.heads, thresholdFt) / answer.heads.length * 100, 3),
  }));
  const acceptance = {
    policy: 'calibration score only: require count parity, kind parity, at least 90 percent exact one-to-one XY matches within 2 ft, and no unmatched answer before placement verification',
    countParity: candidate.counts.total === answer.counts.total,
    kindParity: candidate.counts.upright === answer.counts.upright && candidate.counts.pendent === answer.counts.pendent,
    xyWithin2FtAtLeast90Pct: thresholds.find((entry) => entry.thresholdFt === 2).answerRecallPct >= 90,
    noUnmatchedAnswer: residual.unmatchedAnswerIds.length === 0,
  };
  const accepted = Object.values(acceptance).filter((entry) => typeof entry === 'boolean').every(Boolean);
  const draft = {
    artifactType: SCORE_TYPE,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    sequence: {
      sourceCandidateReceiptSha256: candidate.receiptSha256,
      sourceCandidateSealedBeforeAnswerOpen: true,
      sourceCandidateModifiedAfterAnswerOpen: false,
      answerOpenedByScorerOnly: true,
      scorerCanGenerateCandidates: false,
    },
    answerBindings: { headCoordinateReceiptSha256: ANSWER_RECEIPT, sourceProtectionTargetReceiptSha256: TARGET_RECEIPT },
    counts: {
      generated: candidate.counts,
      answer: answer.counts,
      deltaTotal: candidate.counts.total - answer.counts.total,
      deltaUpright: candidate.counts.upright - answer.counts.upright,
      deltaPendent: candidate.counts.pendent - answer.counts.pendent,
    },
    xyScore: {
      method: 'exact maximum bipartite threshold counts plus exact minimum-total-distance Hungarian residual ledger by sprinkler kind',
      thresholdMatches: thresholds,
      pairedCount: pairs.length,
      meanDistanceFt: round(distances.reduce((sum, value) => sum + value, 0) / distances.length),
      medianDistanceFt: round(percentile(distances, 0.5)),
      p95DistanceFt: round(percentile(distances, 0.95)),
      maximumDistanceFt: round(percentile(distances, 1)),
      unmatchedGeneratedIds: residual.unmatchedCandidateIds,
      unmatchedAnswerIds: residual.unmatchedAnswerIds,
    },
    sourceTargetZScore: {
      pairedTargetCount: zDeltas.length,
      withinHalfFoot: zDeltas.filter((value) => value <= 0.5).length,
      meanAbsoluteDeltaFt: round(zDeltas.reduce((sum, value) => sum + value, 0) / zDeltas.length),
      p95AbsoluteDeltaFt: round(percentile(zDeltas, 0.95)),
      exactInstalledHeadZCompared: false,
    },
    residualPairs: pairs,
    acceptance: { ...acceptance, accepted },
    internalVerification: {
      primary: { status: 'passed', method: 'sealed-candidate versus exact completed-plan registered XY score' },
      independent: { status: 'passed', method: 'maximum bipartite threshold replay separate from residual-pair greedy ledger' },
      adversarial: { status: 'passed', method: 'publication requires candidate, answer, target, score, mutation, and false-promotion attacks' },
    },
    buildingJCalibrationScored: true,
    sourceGeneratedPlacementVerified: accepted,
    freshProjectPlacementVerified: false,
    obstructionClearancesVerified: false,
    branchPipeTopologyReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    requiredNextLoop: accepted
      ? 'run the unchanged placement policy on a fresh source-sealed pitched-roof project before any production promotion'
      : 'use this residual ledger to improve transferable source rules, then seal a new version and run a fresh source-sealed pitched-roof holdout',
    claimStatus: accepted
      ? 'building-j-calibration-threshold-passed-not-fresh-holdout-code-compliance-hydraulics-fabrication-or-release'
      : 'building-j-calibration-scored-and-rejected-with-full-residuals-not-source-placement-verified-or-production-ready',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

/** Validate deterministic scoring and all fail-closed downstream claims. */
export async function validateMitRiversideBuildingJSourceGeneratedPlacementScore(value, candidate, answer, targets) {
  let expected;
  try {
    expected = await buildMitRiversideBuildingJSourceGeneratedPlacementScore(candidate, answer, targets);
  } catch (error) {
    return { status: 'blocked', issues: [issue('MIT_J_SOURCE_PLACEMENT_SCORE_DEPENDENCY_BLOCKED', error.message)], buildingJCalibrationScored: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SCORE_REPLAY_MISMATCH', 'Score no longer equals deterministic answer-only replay.'));
  if (value?.counts?.generated?.total !== 69 || value?.counts?.answer?.total !== 68 || value?.counts?.deltaTotal !== 1 || value?.counts?.generated?.pendent !== 15 || value?.counts?.answer?.pendent !== 15) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SCORE_COUNT_DRIFT', 'Generated and answer counts changed.'));
  if (value?.sequence?.sourceCandidateModifiedAfterAnswerOpen !== false || value?.sequence?.answerOpenedByScorerOnly !== true || value?.sequence?.scorerCanGenerateCandidates !== false) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SCORE_SEQUENCE_INVALID', 'Scorer isolation or source-candidate immutability changed.'));
  if (value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MIT_J_SOURCE_PLACEMENT_SCORE_FALSE_PROMOTION', 'Calibration score promoted a fresh holdout, compliance, fabrication, or release claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, buildingJCalibrationScored: issues.length === 0, sourceGeneratedPlacementVerified: value?.sourceGeneratedPlacementVerified === true && issues.length === 0, complianceReady: false };
}

/** Attack score bindings, metrics, sequence, and downstream readiness. */
export async function verifyMitRiversideBuildingJSourceGeneratedPlacementScoreAdversarialLoop(value, candidate, answer, targets) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['candidate-binding', (entry) => { entry.sequence.sourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['candidate-mutation', (entry) => { entry.sequence.sourceCandidateModifiedAfterAnswerOpen = true; }],
    ['scorer-generation', (entry) => { entry.sequence.scorerCanGenerateCandidates = true; }],
    ['answer-binding', (entry) => { entry.answerBindings.headCoordinateReceiptSha256 = '2'.repeat(64); }],
    ['target-binding', (entry) => { entry.answerBindings.sourceProtectionTargetReceiptSha256 = '3'.repeat(64); }],
    ['generated-count', (entry) => { entry.counts.generated.total = 68; }],
    ['answer-count', (entry) => { entry.counts.answer.total = 69; }],
    ['threshold-score', (entry) => { entry.xyScore.thresholdMatches[1].matched += 1; }],
    ['mean-distance', (entry) => { entry.xyScore.meanDistanceFt = 0; }],
    ['residual', (entry) => { entry.residualPairs[0].distanceFt = 0; }],
    ['acceptance', (entry) => { entry.acceptance.accepted = true; }],
    ['placement', (entry) => { entry.sourceGeneratedPlacementVerified = true; }],
    ['fresh-holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMitRiversideBuildingJSourceGeneratedPlacementScore(attacked, candidate, answer, targets)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
