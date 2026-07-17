import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRoofFramingClearancePreflight, classifyMaterializedSourceDocument, classifyStructuralMemberEvidence, discoverMaterializedSourceEvidence } from '../src/engine/source-evidence-corpus.js';

const tempRoots = [];
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-source-corpus-'));
  tempRoots.push(root);
  return root;
}
afterEach(() => {
  while (tempRoots.length) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('materialized structural source discovery', () => {
  it('hashes bounded project candidates and distinguishes their roles without fabricating proof', () => {
    const root = makeRoot();
    const supplier = path.join(root, '1881 roof truss supplier submittal.pdf');
    const shop = path.join(root, '1881 fire sprinkler shop drawings.pdf');
    fs.writeFileSync(supplier, 'supplier bytes');
    fs.writeFileSync(shop, 'shop bytes');
    const result = discoverMaterializedSourceEvidence({ roots: [root, path.join(root, 'missing')], projectTokens: ['1881'], maxFiles: 10 });
    expect(result.scanComplete).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((entry) => entry.path === supplier).roles).toContain('structural-supplier-submittal');
    expect(result.candidates.find((entry) => entry.path === shop).roles).toContain('sprinkler-shop-drawing');
    expect(result.missingRoots).toHaveLength(1);
    expect(result.candidates.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  });

  it('reports a bounded scan instead of silently treating an oversized corpus as complete', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '1881 structurals.pdf'), 'a');
    fs.writeFileSync(path.join(root, '1881 truss supplier.pdf'), 'b');
    const result = discoverMaterializedSourceEvidence({ roots: [root], projectTokens: ['1881'], maxFiles: 1 });
    expect(result.scanComplete).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('SOURCE_CORPUS_SCAN_BUDGET_EXHAUSTED');
  });

  it('does not promote issued plans or sprinkler drawings as exact fabrication evidence', () => {
    const result = classifyStructuralMemberEvidence({
      members: [{ id: 'J1', member: '2X10' }],
      documents: [
        { sha256: 'struct', roles: ['issued-structural-design'], extractedText: 'ROOF JOIST 2X10' },
        { sha256: 'shop', roles: ['sprinkler-shop-drawing'], extractedText: '2X10 obstruction shown' },
      ],
    });
    expect(result.physicalPromotionAllowed).toBe(false);
    expect(result.witnesses[0]).toMatchObject({ exactPhysicalPromotionAllowed: false, issuedDesignDocumentSha256: ['struct'], sprinklerShopDrawingDocumentSha256: ['shop'], supplierDocumentSha256: [] });
  });

  it('deduplicates copied source files by their content hash before member evidence is evaluated', () => {
    const result = classifyStructuralMemberEvidence({
      members: [{ id: 'J1', member: '2X10' }],
      documents: [
        { sha256: 'same-struct', roles: ['issued-structural-design'], extractedText: 'ROOF JOIST 2X10' },
        { sha256: 'same-struct', roles: ['issued-structural-design'], extractedText: 'ROOF JOIST 2X10' },
      ],
    });
    expect(result.witnesses[0].issuedDesignDocumentSha256).toEqual(['same-struct']);
  });

  it('can recover a cautiously classified supplier candidate from PDF text when a shared-drive filename is generic', () => {
    expect(classifyMaterializedSourceDocument({ path: 'E:/bid/1881/Attachment-14.pdf', extractedText: 'Engineered roof truss supplier submittal for 2X10 members.' }))
      .toContain('structural-supplier-submittal');
  });

  it('blocks automatic pipe routing when source-bounded roof framing lacks materialized supplier evidence', () => {
    const result = buildRoofFramingClearancePreflight({
      placement: { evaluationComplete: true, sourceStructuralPdfSha256: 'struct', roofEvidenceReceiptSha256: 'roof', counts: { skipped: 0 }, boundedMembers: [{ id: 'J1', member: '2X10', topEndpointsFt: [[1, 1, 10], [2, 1, 10]] }] },
      discovery: { sourceStructuralPdfSha256: 'struct', claims: { structuralSupplierSubmittalMaterialized: false }, memberEvidence: { witnesses: [{ memberId: 'J1', exactPhysicalPromotionAllowed: false }] } },
    });
    expect(result).toMatchObject({ status: 'blocked', automaticPipeRoutingAllowed: false, perHeadObstructionClearanceVerified: false, boundedMemberCount: 1 });
    expect(result.issues.map((entry) => entry.code)).toContain('ROOF_FRAMING_OBSTRUCTION_GEOMETRY_UNRESOLVED');
  });

  it('rejects an adversarial source hash or member-set substitution before routing can consume the preflight', () => {
    const result = buildRoofFramingClearancePreflight({
      placement: { evaluationComplete: true, sourceStructuralPdfSha256: 'struct-a', counts: { skipped: 0 }, boundedMembers: [{ id: 'J1' }] },
      discovery: { sourceStructuralPdfSha256: 'struct-b', claims: { structuralSupplierSubmittalMaterialized: true }, memberEvidence: { witnesses: [{ memberId: 'J2', exactPhysicalPromotionAllowed: false }] } },
    });
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['ROOF_FRAMING_DISCOVERY_SOURCE_HASH_MISMATCH', 'ROOF_FRAMING_DISCOVERY_MEMBER_SET_MISMATCH']));
  });
});
