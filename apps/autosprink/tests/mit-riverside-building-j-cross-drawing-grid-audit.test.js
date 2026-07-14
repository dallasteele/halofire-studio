import { beforeAll, describe, expect, it } from 'vitest';
import evidenceJson from '../src/data/mit-riverside-building-j-cross-drawing-grid-audit-evidence.json';
import auditJson from '../src/data/mit-riverside-building-j-cross-drawing-grid-audit.json';
import { buildMitRiversideBuildingJCrossDrawingGridAudit, renderMitRiversideBuildingJCrossDrawingGridAudit, sealMitRiversideBuildingJCrossDrawingGridAuditEvidence, validateMitRiversideBuildingJCrossDrawingGridAudit, validateMitRiversideBuildingJCrossDrawingGridAuditEvidence, verifyMitRiversideBuildingJCrossDrawingGridAuditAdversarialLoop } from '../src/engine/mit-riverside-building-j-cross-drawing-grid-audit.js';

let evidence; let audit;
beforeAll(async () => { evidence = await sealMitRiversideBuildingJCrossDrawingGridAuditEvidence(evidenceJson); audit = await buildMitRiversideBuildingJCrossDrawingGridAudit(evidence); });

describe('MIT Riverside Building J cross-drawing grid audit', () => {
  it('binds the exact structural DWG grid extraction with zero unknown entities', async () => {
    expect(await validateMitRiversideBuildingJCrossDrawingGridAuditEvidence(evidence)).toMatchObject({ status: 'passed', currentHeadStructuralRoofXyReady: false });
    expect(evidence.structuralRoofDwg).toMatchObject({ bytes: 701676, reader: '@mlightcad/libredwg-web 0.7.7', unknownEntityCount: 0 });
  });
  it('preserves the localized one-foot J.2 conflict instead of claiming a global fit', () => {
    expect(audit.conflict).toMatchObject({ localizedConflictLabel: 'J.2', localizedConflictInches: 12, oldClaimedGlobalYResidualPx: 0.655077, actualStructuralGlobalYResidualPx: 23.487062, priorGlobalStructuralAlignmentSuperseded: true });
  });
  it('keeps answer/RCP XY while blocking structural roof XY, planes, and Z', async () => {
    expect(await validateMitRiversideBuildingJCrossDrawingGridAudit(auditJson, evidence)).toMatchObject({ status: 'passed', answerRcpXyStillReady: true, currentHeadStructuralRoofXyReady: false, headPlaneAssignmentReady: false });
  });
  it('renders the discrepancy as visual evidence', () => {
    const svg = renderMitRiversideBuildingJCrossDrawingGridAudit(audit);
    expect(svg).toContain('J.2 differs by 12 in');
    expect(svg).toContain('23.487 px');
  });
  it('rejects all conflict erasure and false-promotion attacks', async () => {
    expect(await verifyMitRiversideBuildingJCrossDrawingGridAuditAdversarialLoop(audit, evidence)).toMatchObject({ status: 'passed', attemptedCases: 16, currentHeadStructuralRoofXyReady: false, headPlaneAssignmentReady: false });
  });
});
