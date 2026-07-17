import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRoofFramingClearancePreflight, classifyMaterializedSourceDocument, classifyProjectIdentity, classifyStructuralMemberEvidence, discoverMaterializedSourceEvidence, mergeMaterializedSourceEvidenceDiscoveries } from '../src/engine/source-evidence-corpus.js';

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

  it('admits only supplier-named generic shared leads when explicitly enabled', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'Attachment-14.pdf'), 'not a supplier');
    fs.writeFileSync(path.join(root, 'Roof truss supplier package.pdf'), 'supplier lead');
    const defaultResult = discoverMaterializedSourceEvidence({ roots: [root], projectTokens: ['1881'], maxFiles: 10 });
    const leadResult = discoverMaterializedSourceEvidence({ roots: [root], projectTokens: ['1881'], maxFiles: 10, includeSupplierLeadsWithoutProjectToken: true });
    expect(defaultResult.candidates).toHaveLength(0);
    expect(leadResult.candidates).toHaveLength(1);
    expect(leadResult.candidates[0]).toMatchObject({ supplierLeadWithoutPathIdentity: true, projectTokenMatches: [] });
  });

  it('requires source path or text project identity before a generic supplier lead is project evidence', () => {
    expect(classifyProjectIdentity({ path: 'Y:/Shared/Attachment-14.pdf', extractedText: 'Roof truss supplier submittal — Cooperative 1881.', projectTokens: ['1881', 'cooperative'] }))
      .toMatchObject({ projectIdentified: true, projectIdentityStatus: 'text-token-match', pathTokenMatches: [], textTokenMatches: ['1881', 'cooperative'] });
    expect(classifyProjectIdentity({ path: 'Y:/Shared/Attachment-14.pdf', extractedText: 'Roof truss supplier submittal — unrelated project.', projectTokens: ['1881', 'cooperative'] }))
      .toMatchObject({ projectIdentified: false, projectIdentityStatus: 'unverified' });
  });

  it('also bounds empty cloud-directory traversal before a file can be encountered', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
    const result = discoverMaterializedSourceEvidence({ roots: [root], projectTokens: ['1881'], maxFiles: 10, maxDirectories: 2 });
    expect(result.scanComplete).toBe(false);
    expect(result.scannedDirectoryCount).toBe(2);
    expect(result.issues.map((entry) => entry.code)).toContain('SOURCE_CORPUS_SCAN_BUDGET_EXHAUSTED');
  });

  it('records an unreadable shared directory as a resumable blocker instead of crashing', () => {
    const root = makeRoot();
    const result = discoverMaterializedSourceEvidence({
      roots: [root],
      projectTokens: ['1881'],
      maxFiles: 10,
      directoryOffset: 7,
      readDirectory: () => { const error = new Error('Egnyte unavailable'); error.code = 'UNKNOWN'; throw error; },
    });
    expect(result).toMatchObject({ scanComplete: false, nextDirectoryOffset: 7, unreadableDirectories: [{ path: root, code: 'UNKNOWN' }] });
    expect(result.issues.map((entry) => entry.code)).toContain('SOURCE_CORPUS_DIRECTORY_UNREADABLE');
  });

  it('resumes a deterministic directory window without rescanning prior files as candidates', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '1881-root.pdf'), 'root');
    fs.mkdirSync(path.join(root, 'child'));
    fs.writeFileSync(path.join(root, 'child', '1881-truss-supplier.pdf'), 'child');
    const result = discoverMaterializedSourceEvidence({ roots: [root], projectTokens: ['1881'], maxFiles: 10, maxDirectories: 1, directoryOffset: 1 });
    expect(result.directoryOffset).toBe(1);
    expect(result.candidates.map((entry) => path.basename(entry.path))).toEqual(['1881-truss-supplier.pdf']);
    expect(result.nextDirectoryOffset).toBeNull();
  });

  it('keeps canonical local evidence while resuming an independent shared-drive window', () => {
    const local = makeRoot();
    const shared = makeRoot();
    fs.writeFileSync(path.join(local, '1881 structurals.pdf'), 'local');
    fs.mkdirSync(path.join(shared, 'child'));
    fs.writeFileSync(path.join(shared, 'child', '1881 truss supplier.pdf'), 'shared');
    const localDiscovery = discoverMaterializedSourceEvidence({ roots: [local], projectTokens: ['1881'], maxFiles: 10, maxDirectories: 10 });
    const resumedSharedDiscovery = discoverMaterializedSourceEvidence({ roots: [shared], projectTokens: ['1881'], maxFiles: 10, maxDirectories: 10, directoryOffset: 1 });
    const result = mergeMaterializedSourceEvidenceDiscoveries({ discoveries: { local: localDiscovery, shared: resumedSharedDiscovery } });
    expect(result.candidates.map((entry) => path.basename(entry.path)).sort()).toEqual(['1881 structurals.pdf', '1881 truss supplier.pdf']);
    expect(result.scanWindows.local.directoryOffset).toBe(0);
    expect(result.scanWindows.shared.directoryOffset).toBe(1);
    expect(result.candidates.find((entry) => entry.path.endsWith('1881 structurals.pdf')).scanScopes).toEqual(['local']);
    expect(result.candidates.find((entry) => entry.path.endsWith('1881 truss supplier.pdf')).scanScopes).toEqual(['shared']);
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

  it('does not mistake a structural plan mentioning suppliers for a supplier submittal', () => {
    expect(classifyMaterializedSourceDocument({ path: 'E:/bid/1881/structurals.pdf', extractedText: 'Structural drawings: lumber supplier shall verify all framing dimensions before ordering.' }))
      .not.toContain('structural-supplier-submittal');
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
