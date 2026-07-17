import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dataRoot = path.resolve(import.meta.dirname, '../src/data');
const audit = JSON.parse(fs.readFileSync(path.join(dataRoot, 'exact-part-evidence/victaulic-vicflex-ab2/source-audit.json'), 'utf8'));
const registryText = fs.readFileSync(path.join(dataRoot, 'trusted-exact-part-receipts.json'), 'utf8');

describe('Victaulic VicFlex AB2 exact CAD source audit', () => {
  it('hash-binds all 15 manufacturer ASM bodies without topology gaps', () => {
    expect(audit.dwgIdentity.threeDSolidCount).toBe(15);
    expect(audit.decodedBodies).toHaveLength(15);
    expect(new Set(audit.decodedBodies.map((body) => body.handle)).size).toBe(15);
    expect(audit.decodedBodies.every((body) => body.sabBytes > 0 && /^[0-9A-F]{64}$/.test(body.sha256))).toBe(true);
    expect(audit.verification.dxfAcdsAudit).toBe('pass');
    expect(audit.verification.sabTopologyValidation).toBe('pass_15_of_15_zero_errors');
  });

  it('records the exact overall bound without confusing it with the nominal 24-inch configuration', () => {
    expect(audit.clientPurchaseEvidence).toMatchObject({
      productNumber: 'A240AB200N',
      model: 'VicFlex AB2 24-inch',
      quantity: 152,
      quoteVariantIdentityVerified: true,
      purchaseIdentityReady: true,
    });
    expect(audit.assemblyBoundsInches.overallX).toBe(28);
    expect(audit.assemblyBoundsInches.note).toMatch(/nominal 24-inch configuration is not the same/i);
    expect(audit.verification.quotePurchaseIdentityBinding).toBe('pass_A240AB200N_AB2_24in_qty152');
    expect(audit.verification.manufacturerDwgSkuVariantBinding).toMatch(/^blocked_/);
  });

  it('keeps threads neutral geometry Blender and fit fail-closed', () => {
    expect(audit.verification.threadStandardCompleteness).toMatch(/^blocked_/);
    expect(audit.verification.neutralMeshExport).toMatch(/^blocked_/);
    expect(audit.verification.blenderMcp).toMatch(/^blocked_/);
    expect(audit.verification.assemblyCollisionAndMatingFit).toMatch(/^pending_/);
    expect(audit.verification.trustedRegistryPromotion).toBe('blocked');
  });

  it('does not silently promote AB2 into the trusted exact-part registry', () => {
    expect(registryText).not.toMatch(/A240AB200N|VicFlex AB2/i);
  });
});
