import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isSimplePolygon, polygonArea, validateLevelFootprintPacket } from '../src/engine/source-bound-footprint.js';
import { buildBuildingFromPlans } from '../src/engine/building-from-plan.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/source-bound-footprints.cooperative-1881.json', import.meta.url), 'utf8'));
const levels = JSON.parse(fs.readFileSync(new URL('../src/data/plan-levels.cooperative-1881.json', import.meta.url), 'utf8'));
const underlays = JSON.parse(fs.readFileSync(new URL('../public/plan-underlays/cooperative-1881/manifest.json', import.meta.url), 'utf8'));
const studioHtml = fs.readFileSync(new URL('../autosprink.html', import.meta.url), 'utf8');

describe('Cooperative 1881 current per-level building geometry', () => {
  it('binds eight different architectural sheets and current A-201 elevations', async () => {
    const validation = await validateLevelFootprintPacket(packet);
    expect(validation.status).toBe('passed');
    expect(validation.geometryComplete).toBe(true);
    expect(levels.levels.map((entry) => entry.sheet)).toEqual(['A-101', 'A-102', 'A-103', 'A-104', 'A-105', 'A-106', 'A-107', 'A-108']);
    expect(levels.levels.map((entry) => entry.page)).toEqual([8, 11, 14, 17, 20, 23, 26, 29]);
    expect(levels.levels.map((entry) => entry.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71]);
    expect(new Set(levels.levels.map((entry) => entry.sourceBinding.renderedPageSha256)).size).toBe(8);
    expect(levels.elevationEvidenceReceiptSha256).toBe('2d0e71167beaa3315d611e3f9495d64b4c7ec849fcab60060b023beec76a34df');
  });

  it('uses simple source-bound polygons with matching areas instead of fallback rectangles or x8 replication', () => {
    for (const level of levels.levels) {
      expect(level.plan.sourceBoundGeometryStatus).toBe('passed');
      expect(level.plan.sourceBoundFootprintEvidenceReceiptSha256).toBe(packet.evidenceReceiptSha256);
      expect(isSimplePolygon(level.plan.footprintFt)).toBe(true);
      expect(polygonArea(level.plan.footprintFt)).toBeCloseTo(level.plan.footprintAreaSqft, 3);
      expect(level.plan.footprintMethod).not.toMatch(/fallback|x8/i);
    }
    expect(new Set(levels.levels.map((entry) => JSON.stringify(entry.plan.footprintFt))).size).toBe(8);
  });

  it('meets independent Level 3 and whole-building calibration controls without claiming sprinkler acceptance', () => {
    const level3 = levels.levels.find((entry) => entry.level === 3);
    expect(Math.abs(level3.plan.footprintAreaSqft - 22359.12) / 22359.12).toBeLessThan(0.005);
    const totalAreaSqft = levels.levels.reduce((sum, entry) => sum + entry.plan.footprintAreaSqft, 0);
    expect(Math.abs(totalAreaSqft - 170654) / 170654).toBeLessThan(0.05);
    expect(packet.claimStatus).toContain('not-sprinkler-code-compliance');
    const level8Calibration = packet.levels.find((entry) => entry.level === 8).derivation.submittedCalibrationBinding;
    expect(level8Calibration.sheetId).toBe('FP-8-R2');
    expect(level8Calibration.renderedPageSha256).toBe('2f20907cec537c92bff749f476d7c14712941421b367c2f6f4b428ccae2e6d20');
    expect(level8Calibration.approvalStatus).toBe('submittal-only-not-approved');
  });

  it('preserves each level own extracted walls and room evidence while replacing only the invalid footprint boundary', () => {
    expect(levels.levels.every((entry) => entry.plan.walls.length > 500)).toBe(true);
    expect(levels.levels.every((entry) => Array.isArray(entry.plan.rooms))).toBe(true);
    expect(levels.perLevelFootprintsVerified).toBe(true);
    expect(levels.verticalDatumsVerified).toBe(true);
  });

  it('extrudes the eight source-bound floors into one true-elevation 3D assembly', () => {
    const building = buildBuildingFromPlans(THREE, levels.levels, { mergeGeometries, wallMergeThreshold: 300 });
    expect(building.summary.levelCount).toBe(8);
    expect(building.root.userData.sourceBoundGeometryVerified).toBe(true);
    expect(building.summary.sourceBoundGeometry.verified).toBe(true);
    expect(building.summary.sourceBoundGeometry.levels.map((entry) => entry.sheetId)).toEqual(['A-101', 'A-102', 'A-103', 'A-104', 'A-105', 'A-106', 'A-107', 'A-108']);
    expect(building.summary.sourceBoundGeometry.levels.map((entry) => entry.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71]);
    expect(building.summary.sourceBoundGeometry.claimStatus).toContain('not-sprinkler-code-compliance');
  });

  it('binds every deployed underlay to the same current source and footprint receipt', () => {
    expect(underlays.sourcePdfSha256).toBe(levels.sourcePdfSha256);
    expect(underlays.footprintEvidenceReceiptSha256).toBe(levels.footprintEvidenceReceiptSha256);
    expect(underlays.sheets).toHaveLength(8);
    for (const sheet of underlays.sheets) {
      const level = levels.levels.find((entry) => entry.level === sheet.level);
      expect(sheet.sourcePdfSha256).toBe(level.plan.sourceBinding.sourcePdfSha256);
      expect(sheet.sourceRenderedPageSha256).toBe(level.plan.sourceBinding.renderedPageSha256);
      expect(sheet.footprintEvidenceReceiptSha256).toBe(level.plan.sourceBoundFootprintEvidenceReceiptSha256);
      expect(sheet.pngSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('surfaces geometry-only verification while keeping sprinkler compliance fail-closed', () => {
    expect(studioHtml).toContain('SOURCE-BOUND BUILDING GEOMETRY VERIFIED');
    expect(studioHtml).toContain('Sprinkler layout, code compliance, and approval remain separate and fail-closed.');
    expect(studioHtml).toContain('buildingGeometryVerified');
    expect(studioHtml).toContain('bakedBindingMatches');
  });
});
