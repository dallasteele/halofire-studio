import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { classifyMaterializedSourceDocument, classifyStructuralMemberEvidence, discoverMaterializedSourceEvidence } from '../src/engine/source-evidence-corpus.js';

const APP = path.resolve(import.meta.dirname, '..');
const rootPaths = process.env.HALOFIRE_CORPUS_ROOTS
  ? process.env.HALOFIRE_CORPUS_ROOTS.split(';').map((entry) => entry.trim()).filter(Boolean)
  : [
    'E:/ClaudeBot/data/halofire/bids/1881',
    'E:/ClaudeBot/data/halofire/golden/1881',
    'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents',
    'Y:/',
  ];
const candidates = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/registered-roof-framing.cooperative-1881.json'), 'utf8'));
const placement = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/roof-framing-placement.cooperative-1881.json'), 'utf8'));
const outputPath = path.join(APP, 'src/data/roof-framing-source-discovery.cooperative-1881.json');
const discovery = discoverMaterializedSourceEvidence({ roots: rootPaths, projectTokens: ['1881', 'cooperative'], maxFiles: 15_000 });

async function extractPdfText(document) {
  if (document.extension !== '.pdf') return { ...document, extractedTextStatus: 'not-pdf', extractedText: '' };
  try {
    const loaded = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(document.path)),
      useWorkerFetch: false,
      isEvalSupported: false,
      standardFontDataUrl: path.join(APP, 'node_modules/pdfjs-dist/standard_fonts/'),
    }).promise;
    const pages = [];
    for (let index = 1; index <= Math.min(loaded.numPages, 250); index += 1) {
      const content = await (await loaded.getPage(index)).getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    const extractedText = pages.join('\n');
    return { ...document, extractedTextStatus: 'passed', pageCount: loaded.numPages, extractedText, roles: classifyMaterializedSourceDocument({ ...document, extractedText }) };
  } catch (error) {
    return { ...document, extractedTextStatus: 'blocked', extractedText: '', extractedTextError: String(error.message || error) };
  }
}

const extractedDocuments = [];
for (const candidate of discovery.candidates) extractedDocuments.push(await extractPdfText(candidate));
const documentsByHash = new Map();
for (const document of extractedDocuments) {
  const existing = documentsByHash.get(document.sha256);
  documentsByHash.set(document.sha256, existing ? {
    ...existing,
    aliases: [...(existing.aliases || [existing.path]), document.path],
    roles: [...new Set([...existing.roles, ...document.roles])],
  } : { ...document, aliases: [document.path] });
}
const documents = [...documentsByHash.values()];
const roofBoundedIds = new Set(placement.boundedMembers.map((member) => member.id));
const memberEvidence = classifyStructuralMemberEvidence({
  members: [...candidates.beams, ...candidates.joists].filter((member) => roofBoundedIds.has(member.id) && member?.section?.status === 'source-bounded-dry-minimum-dressed-section'),
  documents,
});
const supplierMaterialized = documents.some((document) => document.roles.includes('structural-supplier-submittal'));
const issues = discovery.issues.filter((entry) => entry.code !== 'STRUCTURAL_SUPPLIER_SUBMITTAL_NOT_MATERIALIZED');
if (!supplierMaterialized) issues.push({ code: 'STRUCTURAL_SUPPLIER_SUBMITTAL_NOT_MATERIALIZED', severity: 'blocking', message: 'No candidate structural supplier/truss/lumber submittal is materialized in the scanned corpus.', refs: [] });
const output = {
  ...discovery,
  artifactType: 'halofire.cooperative-1881-roof-framing-source-discovery.v1',
  projectName: 'Cooperative 1881',
  sourceStructuralPdfSha256: candidates.source_structural_pdf_sha256,
  documents: documents.map(({ extractedText, ...document }) => ({ ...document, extractedTextSha256: extractedText ? crypto.createHash('sha256').update(extractedText).digest('hex') : null })),
  memberEvidence,
  status: issues.length ? 'blocked' : 'passed',
  issues,
  claims: {
    sourceDiscoveryComplete: discovery.scanComplete,
    structuralSupplierSubmittalMaterialized: supplierMaterialized,
    roofBoundedMemberCount: memberEvidence.witnesses.length,
    exactPhysicalFramingPromoted: false,
    obstructionClearanceVerified: false,
    codeComplianceReady: false,
    fabricationReady: false,
    employeeUseReady: false,
    vpsReleaseReady: false,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, status: output.status, counts: { files: output.scannedFileCount, candidates: output.candidates.length, boundedMembers: output.memberEvidence.witnesses.length, supplierCandidates: output.documents.filter((document) => document.roles.includes('structural-supplier-submittal')).length }, issues: output.issues }, null, 2));
