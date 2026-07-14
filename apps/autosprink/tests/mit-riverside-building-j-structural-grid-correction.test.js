import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJStructuralGridCorrection, renderMitRiversideBuildingJStructuralGridCorrection, validateMitRiversideBuildingJStructuralGridCorrection, verifyMitRiversideBuildingJStructuralGridCorrectionAdversarialLoop } from '../src/engine/mit-riverside-building-j-structural-grid-correction.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const rcp = read('mit-riverside-building-j-source-rcp-registration.json');
const audit = read('mit-riverside-building-j-cross-drawing-grid-audit.json');
const dependencies = { rcp, audit };
let packet;
beforeAll(async () => { packet = await buildMitRiversideBuildingJStructuralGridCorrection(rcp, audit); });

describe('MIT Riverside Building J structural grid correction', () => {
  it('piecewise-corrects all 68 RCP points onto the exact structural DWG grid', async () => {
    expect(await validateMitRiversideBuildingJStructuralGridCorrection(packet, dependencies)).toMatchObject({ status: 'passed', structuralRoofXyReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false });
    expect(packet.counts).toEqual({ total: 68, pendent: 15, upright: 53 });
    expect(packet.heads).toHaveLength(68);
  });
  it('preserves both coordinate frames and a nonzero localized correction', () => {
    expect(packet.grid).toMatchObject({ localizedJ2ConflictInches: 12 });
    expect(packet.maximumAbsoluteCorrectionFt).toBeGreaterThan(0.5);
    expect(packet.heads.some((head) => Math.abs(head.correctionDeltaFt.y) > 0.5)).toBe(true);
  });
  it('keeps every plane and Z assignment fail-closed', () => {
    expect(packet.heads.every((head) => head.sourceProtectionRegime === null && head.sourceProtectionPlaneId === null && head.zFt === null)).toBe(true);
    expect(packet).toMatchObject({ exactFloorFootprintReady: false, wholeRoofFaceTopologyReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });
  it('renders the corrected structural XY proof without false 3D claims', () => {
    const svg = renderMitRiversideBuildingJStructuralGridCorrection(packet);
    expect((svg.match(/<circle /g) || [])).toHaveLength(68);
    expect(svg).toContain('Structural XY only');
  });
  it('rejects all transform, coordinate, plane, Z, and release attacks', async () => {
    expect(await verifyMitRiversideBuildingJStructuralGridCorrectionAdversarialLoop(packet, dependencies)).toMatchObject({ status: 'passed', attemptedCases: 15, structuralRoofXyReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false });
  });
});
