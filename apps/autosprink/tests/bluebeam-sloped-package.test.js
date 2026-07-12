import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildBluebeamSlopedPackage } from '../src/engine/bluebeam-sloped-package.js';
import { generateSlopedCeilingLayout, verifySlopedCeilingLayoutParity } from '../src/engine/sloped-ceiling-layout.js';
import { buildSlopedCeilingModel3d, verifySlopedCeilingModel3d } from '../src/engine/sloped-ceiling-model3d.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const layoutRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })) }));
const modelRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', elevationDatum: region.elevationDatum ? { datumPointSubmittedPt: region.elevationDatum.datumPointSubmittedPt, projectElevationFt: region.elevationDatum.projectElevationFt, slopeDirection: region.elevationDatum.slopeDirection, sourceText: region.elevationDatum.sourceText } : null }));
const layout = generateSlopedCeilingLayout({ artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 13.5, regions: layoutRegions, maxAcrossSlopeSpanFt: 20, maxAlongSlopeSpanFt: 12 });
const parity = verifySlopedCeilingLayoutParity(layout, packet, 5);
const modelInput = { artifactType: 'halofire.sloped-ceiling-model3d-input.v1', printedScalePtPerFt: 13.5, regions: modelRegions, hydraulicDatumJoin: { projectDatumOffsetFt: 100, activeNodes: packet.hydraulicDatumJoin.activeNodes, protectedRegionHeadNodeMappingReady: false } };
const model3d = buildSlopedCeilingModel3d(layout, modelInput);
const model3dVerification = verifySlopedCeilingModel3d(model3d, layout, modelInput);

describe('Bluebeam-compatible sloped ceiling PDF package', () => {
  it('emits a two-page vector PDF with optional-content layers and sealed evidence', async () => {
    const result = buildBluebeamSlopedPackage({ artifactType: 'halofire.bluebeam-sloped-package-input.v1', packet, layout, parity, model3d, model3dVerification });
    expect(result.status).toBe('passed');
    expect(result.buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    expect(result.manifest).toMatchObject({ pageCount: 2, vector: true, bluebeamCompatiblePdfVersion: '1.7', complianceReady: false });
    const raw = result.buffer.toString('latin1');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_GEOMETRY)');
    expect(raw).toContain('/Type /OCG /Name (GENERATED_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (VERIFICATION_EVIDENCE)');
    expect(raw).toContain(packet.evidenceReceiptSha256);
    const doc = await getDocument({ data: new Uint8Array(result.buffer), disableWorker: true }).promise;
    expect(doc.numPages).toBe(2);
    const page1Text = (await (await doc.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ');
    const page2Text = (await (await doc.getPage(2)).getTextContent()).items.map((item) => item.str).join(' ');
    expect(page1Text).toContain('BLUEBEAM CALIBRATION DETAIL');
    expect(page1Text).toContain('NOT CODE COMPLIANCE');
    expect(page2Text).toContain('ABSOLUTE ELEVATION CALIBRATION');
    expect(page2Text).toContain('LOCAL ELEVATION + 100 FT = PROJECT ELEVATION');
    const replay = buildBluebeamSlopedPackage({ artifactType: 'halofire.bluebeam-sloped-package-input.v1', packet, layout, parity, model3d, model3dVerification });
    expect(replay.manifest.sha256).toBe(result.manifest.sha256);
    expect(replay.buffer.equals(result.buffer)).toBe(true);
  });

  it('fails closed if generated parity is not passed', () => {
    const blocked = buildBluebeamSlopedPackage({ artifactType: 'halofire.bluebeam-sloped-package-input.v1', packet, layout, parity: { ...parity, status: 'blocked' }, model3d, model3dVerification });
    expect(blocked.status).toBe('blocked');
    expect(blocked.issues[0].code).toBe('BLUEBEAM_PACKAGE_INPUT_INVALID');
  });
});
