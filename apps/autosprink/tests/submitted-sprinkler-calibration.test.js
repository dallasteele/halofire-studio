import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  renderSubmittedCalibrationViews,
  sealSubmittedSprinklerCalibration,
  validateSubmittedSprinklerCalibration,
} from '../src/engine/submitted-sprinkler-calibration.js';
import { reconstructRoofPlanes } from '../src/engine/roof-geometry.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-fp8-calibration.cooperative-1881.json', import.meta.url), 'utf8'));
const levels = JSON.parse(fs.readFileSync(new URL('../src/data/plan-levels.cooperative-1881.json', import.meta.url), 'utf8'));
const roofInput = JSON.parse(fs.readFileSync(new URL('../src/data/roof-reconstruction.cooperative-1881.json', import.meta.url), 'utf8'));
const studioHtml = fs.readFileSync(new URL('../autosprink.html', import.meta.url), 'utf8');
const footprint = levels.levels.find((entry) => entry.level === 8).plan.footprintFt;

async function validate(input = packet) {
  const roofModel = await reconstructRoofPlanes(roofInput);
  return validateSubmittedSprinklerCalibration(input, { planFootprint: footprint, roofModel });
}

async function reseal(mutator) {
  const draft = structuredClone(packet);
  delete draft.evidenceReceiptSha256;
  mutator(draft);
  return sealSubmittedSprinklerCalibration(draft);
}

describe('Cooperative 1881 submitted FP-8 / DA-3 calibration', () => {
  it('registers both rotated FP-8 views to current A-108 and joins DA-3 elevations', async () => {
    const result = await validate();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ heads: 297, pipeSegments: 254, hydraulicNodes: 17, pitchedRoofNodes: 0 });
    expect(packet.viewRegistrations.map((entry) => entry.viewId)).toEqual(['south', 'north']);
    expect(packet.viewRegistrations.every((entry) => entry.controls.planXRmsResidualFt <= 0.2)).toBe(true);
    expect(packet.viewRegistrations.every((entry) => entry.controls.planYRmsResidualFt <= 0.2)).toBe(true);
    expect(packet.submittedElevationView.hydraulicNodes.map((entry) => entry.elevationFt)).toContain(89.416667);
    expect(packet.sourceBindings.find((entry) => entry.id === 'target-roof-A121').binding).toMatchObject({
      sourcePdfSha256: 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f',
      physicalPageNumber: 32,
      pageIndex: 31,
    });
  });

  it('proves the finished Level 8 reference is not a blind pitched-roof projection', async () => {
    const result = await validate();
    expect(result.status).toBe('passed');
    expect(result.protectionBasis.roofForm).toBe('source-bound-pitched-roof');
    expect(result.protectionBasis.submittedLevel8Mode).toBe('flat-ceiling-and-sky-balcony-reference');
    expect(result.protectionBasis.projectLevel8LayoutMayBeBlindlyProjectedToRoof).toBe(false);
    expect(result.protectionBasis.atticSprinklerRequirementEstablished).toBe(false);
    expect(result.roofRelations).toHaveLength(17);
    expect(new Set(result.roofRelations.map((entry) => entry.relation))).toEqual(new Set([
      'outside-pitched-roof-plane', 'sky-balcony-or-open-core',
    ]));
  });

  it('binds the repeated submitted non-combustible attic note without treating it as approval', async () => {
    const result = await validate();
    expect(result.status).toBe('passed');
    expect(packet.atticProtectionBasis.physicalPages).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(packet.atticProtectionBasis.pageBindings.map((entry) => entry.renderedPageSha256)).size).toBe(8);
    expect(packet.coverage.complete).toBe(false);
    expect(packet.claimStatus).toContain('not-code-compliance-or-approval');
    expect(result.complianceReady).toBe(false);
  });

  it('renders registered top and elevation reference views from the same sealed entities', async () => {
    const views = renderSubmittedCalibrationViews(await validate());
    expect(views.status).toBe('passed');
    expect((views.topSvg.match(/<line /g) || [])).toHaveLength(254);
    expect((views.topSvg.match(/data-head-id=/g) || [])).toHaveLength(297);
    expect((views.elevationSvg.match(/data-node-id=/g) || [])).toHaveLength(17);
    expect(views.topSvg).toContain('Submitted FP-8 registered top view');
    expect(views.elevationSvg).toContain('Submitted DA-3 registered elevation view');
    expect(studioHtml).toContain('hfShowSubmittedCalibrationViews');
    expect(studioHtml).toContain('SUBMITTED_LEVEL8_REFERENCE_NOT_PITCHED_ROOF_PROJECTION');
    expect(studioHtml).toContain("'roof-planes.rotate-sprinklers-to-roof-planes': () => hfShowSubmittedCalibrationViews()");
  });

  it('rejects receipt tampering, false grid registration, and substituted attic pages', async () => {
    const tampered = structuredClone(packet);
    tampered.submittedElevationView.hydraulicNodes[0].elevationFt += 10;
    expect((await validate(tampered)).issues.map((entry) => entry.code)).toContain('SUBMITTED_CALIBRATION_RECEIPT_MISMATCH');

    const badGrid = await reseal((draft) => { draft.viewRegistrations[1].controls.planXRmsResidualFt = 3; });
    expect((await validate(badGrid)).issues.map((entry) => entry.code)).toContain('SUBMITTED_VIEW_GRID_REGISTRATION_RESIDUAL');

    const substitutedPage = await reseal((draft) => {
      draft.atticProtectionBasis.pageBindings[1].renderedPageSha256 = draft.atticProtectionBasis.pageBindings[0].renderedPageSha256;
    });
    expect((await validate(substitutedPage)).issues.map((entry) => entry.code)).toContain('SUBMITTED_ATTIC_NOTE_PAGE_SUBSTITUTION');
  });

  it('rejects a malicious rewrite that moves a submitted ceiling node onto a pitched roof plane', async () => {
    const malicious = await reseal((draft) => {
      draft.submittedElevationView.hydraulicNodes[0].planPointFt = [100, 100];
    });
    const result = await validate(malicious);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('SUBMITTED_NODE_FALSELY_CLASSIFIED_NON_ROOF');
  });
});
