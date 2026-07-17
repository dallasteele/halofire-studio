import { describe, expect, it } from 'vitest';
import capabilities from '../src/data/field-drain-source-capabilities.json';
import buildingJTrace from '../src/data/mit-riverside-building-j-hydraulic-riser-trace.json';
import newHopeAnnotations from '../src/data/new-hope-approved-fp20-operational-annotations.json';
import { evaluateFieldDrainSourceCapability } from '../src/engine/field-drain-source-capability.js';

const receipt = (projectId) => capabilities.receipts.find((entry) => entry.projectId === projectId);

describe('field drain source capability', () => {
  it('keeps each capability receipt bound to its existing project evidence', () => {
    const buildingJ = receipt('mit-riverside-building-j');
    const newHope = receipt('new-hope-community-church');

    expect(buildingJ.sourceDocuments.find((entry) => entry.id === 'approved-fp2').sha256)
      .toBe(buildingJTrace.sources.approved.sha256);
    expect(buildingJ.sourceDocuments.find((entry) => entry.id === 'transportation-hydraulics').sha256)
      .toBe(buildingJTrace.sources.transportationHydraulics.sha256);
    expect(newHope.sourceDocuments.find((entry) => entry.id === 'approved-fp20').sha256)
      .toBe(newHopeAnnotations.sources.find((entry) => entry.role === 'approved-plan').sha256);
    expect(newHope.drainEvidence.labels).toContain(newHopeAnnotations.lowPointAnchors[0].rawText);
    expect(newHopeAnnotations.fieldRouteDrainIntents.every((entry) => entry.routeStatus === 'field-resolution-required')).toBe(true);
  });

  it('blocks Building J because its own source corpus has no drain evidence', () => {
    const result = evaluateFieldDrainSourceCapability(receipt('mit-riverside-building-j'));

    expect(result.status).toBe('blocked');
    expect(result.routeGeometryReady).toBe(false);
    expect(result.crossProjectGeometryTransferAllowed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('FIELD_DRAIN_SOURCE_EVIDENCE_ABSENT');
  });

  it('preserves New Hope field-route intents without promoting an exact route', () => {
    const result = evaluateFieldDrainSourceCapability(receipt('new-hope-community-church'));

    expect(result.status).toBe('blocked');
    expect(result.routeGeometryReady).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('FIELD_DRAIN_ROUTE_FIELD_RESOLUTION_REQUIRED');
  });

  it('rejects cross-project geometry even when it is offered to a source-resolved receipt', () => {
    const sourceResolvedReceipt = structuredClone(receipt('new-hope-community-church'));
    sourceResolvedReceipt.drainEvidence.state = 'source-resolved';
    const candidate = {
      projectId: 'mit-riverside-building-j',
      sourceDocumentId: 'approved-fp20',
      sourceDigest: '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5',
      routeSegments: [
        {
          id: 'foreign-geometry',
          fromPdfPt: { x: 1, y: 1 },
          toPdfPt: { x: 2, y: 2 },
          sourceDigest: '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
        }
      ]
    };

    const result = evaluateFieldDrainSourceCapability(sourceResolvedReceipt, candidate);

    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('FIELD_DRAIN_CROSS_PROJECT_GEOMETRY_REJECTED');
  });

  it('rejects malformed source-resolved route evidence instead of treating a digest as geometry', () => {
    const sourceResolvedReceipt = structuredClone(receipt('new-hope-community-church'));
    sourceResolvedReceipt.drainEvidence.state = 'source-resolved';
    const result = evaluateFieldDrainSourceCapability(sourceResolvedReceipt, {
      projectId: 'new-hope-community-church',
      sourceDocumentId: 'approved-fp20',
      sourceDigest: 'not-a-digest',
      routeSegments: []
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'FIELD_DRAIN_CANDIDATE_SOURCE_DIGEST_INVALID',
      'FIELD_DRAIN_ROUTE_SEGMENTS_MISSING'
    ]));
  });
});
