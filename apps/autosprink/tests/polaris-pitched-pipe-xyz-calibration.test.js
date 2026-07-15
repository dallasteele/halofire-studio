import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import calibration from '../src/data/polaris-pitched-pipe-xyz-calibration.json';
import {
  evaluatePolarisPitchedPipeCalibration,
  verifyPolarisPitchedPipeAdversarialLoop,
} from '../src/engine/polaris-pitched-pipe-xyz-calibration.js';

describe('Polaris completed pitched-attic pipe XYZ calibration', () => {
  it('binds the native model, identical exported geometry, approved FP2, and as-built evidence', () => {
    expect(evaluatePolarisPitchedPipeCalibration(calibration)).toMatchObject({
      status: 'passed',
      exactSourcePipeXyzReady: true,
      sourceUnitConversionReady: true,
      approvedAndAsBuiltRegistrationReady: true,
      planDirectionReady: true,
      roofRelativePipeGradeGeometryReady: true,
      hydraulicFlowDirectionReady: false,
      drainageGradeSemanticsReady: false,
      drainDestinationReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    });
    expect(calibration.sources).toMatchObject({
      nativeCad: { archiveEntryCount: 6, typeCount: 157, nativeSpatialTypesReady: true },
      exportedDwg: { pipeGeometrySha256: '33CE1D1119D64BB349152C3AF83767313404C8ED3443F770A8BA123FBEAEA34A' },
    });
    expect(calibration.registration).toMatchObject({
      sourceUnits: 'inches',
      projectUnits: 'feet',
      architecturalOutlineVertices: 73,
      headCount: 158,
      headXyMaxResidualFt: 0.000000648,
      headLabelZMaxResidualInches: 0.24555,
    });
  });

  it('preserves the exact pipe sizes, plan directions, roof-relative grades, and vertical transitions', () => {
    expect(calibration.summary).toMatchObject({
      pipeCount: 186,
      headCount: 158,
      fittingCount: 98,
      distinctEndpointElevations: 119,
      nominalSizeCounts: { 1: 152, 1.25: 17, 1.5: 4, 2: 3, 2.5: 1, 3: 7, 4: 2 },
      geometryKindCounts: { 'level-run': 86, 'sloped-plan-run': 14, 'vertical-transition': 86 },
      planDirectionCounts: { 'north-south': 73, 'east-west': 20, diagonal: 7, 'vertical-transition': 86 },
    });
    const longMain = calibration.pipes.find((pipe) => pipe.id === 'pipe-3943');
    expect(longMain).toMatchObject({
      nominalSizeInches: 1.5,
      planDirection: 'east-west',
      geometryKind: 'sloped-plan-run',
      downhillDirection: 'start-to-end',
      gradeInPer10Ft: 0.312984,
    });
    expect(longMain.startFt.z).toBeCloseTo(14.105662, 6);
    expect(longMain.endFt.z).toBeCloseTo(13.655639, 6);
  });

  it('rejects source, registration, inventory, coordinate, size, direction, grade, and promotion attacks', () => {
    expect(verifyPolarisPitchedPipeAdversarialLoop(calibration)).toMatchObject({
      status: 'passed',
      attemptedCases: 13,
      falsePromotionRejected: true,
    });
  });

  it('keeps the generated artifact reproducible from the protected source paths', () => {
    const script = fs.readFileSync(new URL('../scripts/build-polaris-pitched-pipe-calibration.mjs', import.meta.url), 'utf8');
    expect(script).toContain("const DWG_SHA256 = '3B27B60D74C6058508789929AD0CA20DF490C28905828B5AC096183454154C2F'");
    expect(script).toContain("const NATIVE_CAD_SHA256 = '1224C1268B19FD4390FEEB0E7A563852AEC6B9B82EADE8452B3686EDD405D3F4'");
    expect(script).toContain('POLARIS_PIPE_RADIUS_UNMAPPED');
  });

  it('binds every visual proof image to the approved/as-built source and exact pipe model', () => {
    const proofRoot = new URL('../src/data/proofs/polaris-pitched-pipe-xyz/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');

    expect(proof).toMatchObject({
      approvedAndAsBuiltRenderedPixelsIdentical: true,
      planRegistration: {
        headSamples: 158,
        medianResidualPx: 0.279512,
        p95ResidualPx: 1.314084,
      },
      counts: {
        pipeCount: 186,
        headCount: 158,
        fittingCount: 98,
        distinctEndpointElevations: 119,
      },
      claims: {
        exactSourcePipeXyzReady: true,
        approvedAndAsBuiltRegistrationReady: true,
        roofRelativePipeGradeGeometryReady: true,
        hydraulicFlowDirectionReady: false,
        drainageGradeSemanticsReady: false,
        properPipeLayoutReady: false,
        fabricationReady: false,
        fieldReleaseReady: false,
      },
    });

    for (const [fileName, artifact] of Object.entries(proof.artifacts)) {
      const bytes = fs.readFileSync(new URL(fileName, proofRoot));
      expect(bytes.byteLength, fileName).toBe(artifact.bytes);
      expect(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), fileName).toBe(artifact.sha256);
    }

    expect(html).toContain('The underlay is the protected approved FP2 render');
    expect(html).toContain('exported AutoSPRINK DWG');
    expect(html).toContain('Hydraulic flow direction: HELD');
    expect(html).toContain('Drainage grade semantics: HELD');
    expect(html).toContain('approved-fp2-pipe-overlay.png');
    expect(html).toContain('pipe-model-3d.png');
  });
});
