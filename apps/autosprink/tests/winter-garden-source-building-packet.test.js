import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sealWinterGardenSourceBuildingPacket,
  validateWinterGardenSourceBuildingPacket,
} from '../src/engine/winter-garden-source-building-packet.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-building-model.json', import.meta.url), 'utf8'));
const reseal = (draft) => sealWinterGardenSourceBuildingPacket(draft);
const issueCodes = (result) => result.issues.map((entry) => entry.code);

describe('validateWinterGardenSourceBuildingPacket', () => {
  it('accepts the sealed source-only floor, roof, elevation, and operational-knowledge packet', async () => {
    const result = await validateWinterGardenSourceBuildingPacket(packet);
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ rooms: 56, roofSurfaces: 11, pitchedRoofSurfaces: 10, verticalFeatures: 1 });
    expect(result.geometryGrounded).toBe(true);
    expect(result.operationalKnowledgeGrounded).toBe(true);
    expect(result.complianceReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('rejects receipt drift', async () => {
    const tampered = structuredClone(packet);
    tampered.model.floorElevationFt = 101;
    expect(issueCodes(await validateWinterGardenSourceBuildingPacket(tampered))).toContain('WG_SOURCE_BUILDING_RECEIPT_MISMATCH');
  });

  it('rejects a completed-bid answer key as a generation input', async () => {
    const tampered = structuredClone(packet);
    tampered.generation.answerKeyUsed = true;
    expect(issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)))).toContain('WG_SOURCE_BUILDING_ANSWER_KEY_LEAKAGE');
  });

  it('rejects source-sheet drift', async () => {
    const tampered = structuredClone(packet);
    tampered.sourceBindings = tampered.sourceBindings.filter((entry) => entry.sheet !== 'A301');
    expect(issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)))).toContain('WG_SOURCE_BUILDING_SOURCE_DRIFT');
  });

  it('rejects missing Halo Fire operational knowledge even with a valid receipt', async () => {
    const tampered = structuredClone(packet);
    tampered.operationalKnowledge.sources = tampered.operationalKnowledge.sources.filter((source) => !source.includes('Fabrication-Shop'));
    expect(issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)))).toContain('WG_SOURCE_BUILDING_OPERATIONAL_KNOWLEDGE_MISSING');
  });

  it('rejects missing internal adversarial-loop doctrine even with a valid receipt', async () => {
    const tampered = structuredClone(packet);
    tampered.operationalKnowledge.workflowGuardrails = tampered.operationalKnowledge.workflowGuardrails.filter((entry) => !entry.includes('adversarial'));
    expect(issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)))).toContain('WG_SOURCE_BUILDING_OPERATIONAL_KNOWLEDGE_MISSING');
  });

  it('rejects elevation and pitch drift', async () => {
    const tampered = structuredClone(packet);
    tampered.model.mainRoof.pitchRiseIn = 0;
    const codes = issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)));
    expect(codes).toContain('WG_SOURCE_BUILDING_ELEVATION_DRIFT');
  });

  it('rejects missing steeple and roof surfaces', async () => {
    const tampered = structuredClone(packet);
    tampered.model.features = [];
    tampered.model.surfaces = tampered.model.surfaces.filter((surface) => surface.kind !== 'cross-gable-roof').slice(0, 2);
    const codes = issueCodes(await validateWinterGardenSourceBuildingPacket(await reseal(tampered)));
    expect(codes).toContain('WG_SOURCE_BUILDING_STEEPLE_DRIFT');
    expect(codes).toContain('WG_SOURCE_BUILDING_ROOF_SURFACE_DRIFT');
  });
});
