import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJSourceRcpRegistration, renderMitRiversideBuildingJSourceRcpViews, validateMitRiversideBuildingJSourceRcpEvidence, validateMitRiversideBuildingJSourceRcpRegistration, verifyMitRiversideBuildingJSourceRcpAdversarialLoop } from '../src/engine/mit-riverside-building-j-source-rcp-registration.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const headRegistration = read('mit-riverside-building-j-head-coordinate-registration.json');
const sourceRcpEvidence = read('mit-riverside-building-j-source-rcp-registration-evidence.json');
const dependencies = { headRegistration, sourceRcpEvidence };

describe('MIT Riverside Building J source RCP grid registration', () => {
  it('extracts the eight-by-five source grid and preserves the four-inch source discrepancy', async () => {
    expect(await validateMitRiversideBuildingJSourceRcpEvidence(sourceRcpEvidence)).toMatchObject({ status: 'passed', sourceRcpGridRegistrationReady: true, headSourceRcpXyRegistrationReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false });
    expect(sourceRcpEvidence.registration).toMatchObject({ repeatedTopBottomXLabels: ['J.A', 'J.C', 'J.E', 'J.G', 'J.H'], maximumRepeatedLabelResidualPt: 0, globalLinearScaleClaimed: false, piecewiseGridLabelMappingRequired: true, architecturalStructuralWidthDiscrepancyInches: 4 });
    expect(sourceRcpEvidence.registration.x.labels).toHaveLength(8);
    expect(sourceRcpEvidence.registration.y.labels).toHaveLength(5);
  });

  it('maps all 68 exact answer XY points onto source RCP page 105 without assigning planes or Z', async () => {
    const packet = await buildMitRiversideBuildingJSourceRcpRegistration(headRegistration, sourceRcpEvidence);
    expect(await validateMitRiversideBuildingJSourceRcpRegistration(packet, dependencies)).toMatchObject({ status: 'passed', sourceRcpGridRegistrationReady: true, headSourceRcpXyRegistrationReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false });
    expect(packet.heads).toHaveLength(68);
    expect(packet.heads.every((head) => head.sourceProtectionRegime === null && head.sourceProtectionPlaneId === null && head.ceilingHeightFt === null && head.zFt === null)).toBe(true);
  });

  it('binds eleven source O.T.S. labels but does not treat labels as whole-room plane assignments', () => {
    expect(sourceRcpEvidence.sourceRcpObservations).toMatchObject({ openToStructureLabel: 'O.T.S.', openToStructureLabelCount: 11, fixtureAndCeilingLayoutPresent: true, ceilingHeightIndicatorsPresent: true, individualProtectionRegimesAssigned: false });
    expect(sourceRcpEvidence.sourceRcpObservations.openToStructureLabelCentersPt).toHaveLength(11);
  });

  it('renders source RCP XY proof while explicitly refusing elevation and 3D claims', async () => {
    const packet = await buildMitRiversideBuildingJSourceRcpRegistration(headRegistration, sourceRcpEvidence);
    const views = renderMitRiversideBuildingJSourceRcpViews(packet);
    expect((views.topSvg.match(/<circle /g) || [])).toHaveLength(68);
    expect(views.topSvg).toContain('SOURCE RCP REGISTRATION');
    expect(views.elevationSvg).toContain('does not establish elevation');
    expect(views.model3dSvg).toContain('No PDF-to-3D head model yet');
  });

  it('rejects source, grid, discrepancy, mapping, plane, Z, geometry, compliance, and release attacks', async () => {
    const packet = await buildMitRiversideBuildingJSourceRcpRegistration(headRegistration, sourceRcpEvidence);
    const result = await verifyMitRiversideBuildingJSourceRcpAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 21, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(21);
  });
});
