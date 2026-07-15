import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateApprovedFp20PipeVectors,
  pdfPointToRegisteredPlanFt,
} from '../src/engine/approved-fp20-pipe-vectors.js';

const evidence = JSON.parse(fs.readFileSync(new URL('../src/data/new-hope-approved-fp20-pipe-vectors.json', import.meta.url), 'utf8'));
const mutate = (callback) => {
  const copy = structuredClone(evidence);
  callback(copy);
  return copy;
};

describe('approved FP2.0 pipe-vector extraction', () => {
  it('closes the exact approved source at 67 routed vectors and 68 typed sprinklers', () => {
    const result = evaluateApprovedFp20PipeVectors(evidence);
    expect(result.status).toBe('passed');
    expect(result.vectorExtractionReady).toBe(true);
    expect(result.metrics).toMatchObject({
      pipeVectorCount: 67,
      sprinklerCount: 68,
      pipeClassCounts: { 'red-pipe': 40, 'black-pipe': 15, 'navy-arm-over': 12 },
      sprinklerClassCounts: { BB1: 58, SD1: 6, 'TY-FRB': 4 },
      maximumHeadToPipeDistancePdfPt: 1.466,
      connectedPipeVectorCount: 67,
      explicitMaskedTurnCount: 2,
    });
    expect(result.sourceTopologyConnected).toBe(true);
    expect(result.properPipeLayoutReady).toBe(false);
    expect(result.fieldReleaseReady).toBe(false);
  });

  it('registers source PDF coordinates into scaled plan feet', () => {
    expect(pdfPointToRegisteredPlanFt(evidence, { x: 1198.657, y: 798.45 })).toEqual({ xFt: 0, yFt: 30.375 });
    expect(pdfPointToRegisteredPlanFt(evidence, { x: 1288.65590909, y: 888.44890909 })).toEqual({ xFt: 10, yFt: 40.375 });
  });

  it('rejects the old red-only extraction because it drops black branches and arm-overs', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.pipeSegments = copy.pipeSegments.filter((segment) => segment.strokeClass === 'red-pipe');
    }));
    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'FP20_PIPE_CLASS_COUNT_MISMATCH',
      'FP20_HEAD_PIPE_PATH_MISSING',
    ]));
  });

  it('rejects source-hash drift and a fabricated head position', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.source.sha256 = '0'.repeat(64);
      copy.sprinklers[0].centerPdfPt = { x: 2500, y: 2000 };
    }));
    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'FP20_VECTOR_SOURCE_BINDING_INVALID',
      'FP20_HEAD_PIPE_PATH_MISSING',
    ]));
  });

  it('rejects a vector with a changed style, length, or missing white-mask twin', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.pipeSegments[0].strokeRgb = [0, 1, 0];
      copy.pipeSegments[0].lengthPdfPt += 3;
      copy.pipeSegments[0].whiteMaskTwin = false;
    }));
    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'FP20_PIPE_STYLE_SIGNATURE_INVALID',
      'FP20_PIPE_SEGMENT_LENGTH_INVALID',
    ]));
  });

  it('rejects a legend-count attack even when the total head count remains 68', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.sprinklers[0].symbolType = 'SD1';
      copy.sprinklers[0].symbolItemCount = 23;
    }));
    expect(result.blockerCodes).toContain('FP20_HEAD_CLASS_COUNT_MISMATCH');
  });

  it('rejects a missing masked turn instead of silently disconnecting an approved branch', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.topologyClosure.explicitMaskedTurnLinks.pop();
    }));
    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'FP20_TOPOLOGY_EXPLICIT_LINK_COUNT_INVALID',
      'FP20_SOURCE_TOPOLOGY_DISCONNECTED',
    ]));
    expect(result.sourceTopologyConnected).toBe(false);
  });

  it('rejects broad snapping even though a ten-point tolerance would make the page look connected', () => {
    const result = evaluateApprovedFp20PipeVectors(mutate((copy) => {
      copy.topologyClosure.automaticJoinTolerancePdfPt = 10;
    }));
    expect(result.blockerCodes).toContain('FP20_TOPOLOGY_TOLERANCE_INVALID');
    expect(result.vectorExtractionReady).toBe(false);
  });
});
