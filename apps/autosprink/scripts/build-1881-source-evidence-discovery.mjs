import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { classifyMaterializedSourceDocument, classifyProjectIdentity, classifyStructuralMemberEvidence, discoverMaterializedSourceEvidence, mergeMaterializedSourceEvidenceDiscoveries } from '../src/engine/source-evidence-corpus.js';

const APP = path.resolve(import.meta.dirname, '..');
const REPOSITORY = path.resolve(APP, '..', '..');
const localRootPaths = process.env.HALOFIRE_CORPUS_ROOTS
  ? process.env.HALOFIRE_CORPUS_ROOTS.split(';').map((entry) => entry.trim()).filter(Boolean)
  : [
    'E:/ClaudeBot/data/halofire/bids/1881',
    'E:/ClaudeBot/data/halofire/golden/1881',
    'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents',
  ];
const sharedRootPaths = process.env.HALOFIRE_SHARED_CORPUS_ROOTS
  ? process.env.HALOFIRE_SHARED_CORPUS_ROOTS.split(';').map((entry) => entry.trim()).filter(Boolean)
  : [
    // The bid log identifies Kier Construction and the active-job corpus contains
    // the exact Cooperative 1881 project folder. Keep discovery project-scoped;
    // a contractor-wide or whole-drive crawl is neither deterministic nor complete.
    'Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT',
  ];
const sharedDirectoryOffset = Number.parseInt(process.env.HALOFIRE_SHARED_CORPUS_DIRECTORY_OFFSET || process.env.HALOFIRE_CORPUS_DIRECTORY_OFFSET || '0', 10);
const requestedSharedMaxDirectories = Number.parseInt(process.env.HALOFIRE_SHARED_CORPUS_MAX_DIRECTORIES || '300', 10);
const sharedMaxDirectories = Number.isFinite(requestedSharedMaxDirectories) ? Math.max(1, Math.min(requestedSharedMaxDirectories, 5_000)) : 300;
const sharedDirectoryFrontier = process.env.HALOFIRE_SHARED_CORPUS_DIRECTORY_FRONTIER_JSON
  ? JSON.parse(process.env.HALOFIRE_SHARED_CORPUS_DIRECTORY_FRONTIER_JSON)
  : null;
const candidates = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/registered-roof-framing.cooperative-1881.json'), 'utf8'));
const placement = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/roof-framing-placement.cooperative-1881.json'), 'utf8'));
const defaultOutputPath = path.join(APP, 'src/data/roof-framing-source-discovery.cooperative-1881.json');
const outputPath = process.env.HALOFIRE_SOURCE_DISCOVERY_OUTPUT_PATH
  ? path.resolve(process.env.HALOFIRE_SOURCE_DISCOVERY_OUTPUT_PATH)
  : defaultOutputPath;
if (outputPath !== REPOSITORY && !outputPath.startsWith(`${REPOSITORY}${path.sep}`)) {
  throw new Error('HALOFIRE_SOURCE_DISCOVERY_OUTPUT_PATH must stay inside the checked-out repository.');
}
const standardFontDataUrl = pathToFileURL(`${path.join(APP, 'node_modules/pdfjs-dist/standard_fonts')}${path.sep}`).href;
const requestedPdfTextPages = Number.parseInt(process.env.HALOFIRE_CORPUS_PDF_TEXT_MAX_PAGES || '4', 10);
const maxPdfTextPages = Number.isFinite(requestedPdfTextPages) ? Math.max(1, Math.min(requestedPdfTextPages, 250)) : 4;
const localDiscovery = discoverMaterializedSourceEvidence({ roots: localRootPaths, projectTokens: ['1881', 'cooperative'], maxFiles: 15_000, maxDirectories: 5_000 });
const projectIdentityTokens = ['1881', 'cooperative'];
const sharedDiscovery = discoverMaterializedSourceEvidence({ roots: sharedRootPaths, projectTokens: projectIdentityTokens, maxFiles: 15_000, maxDirectories: sharedMaxDirectories, directoryOffset: Number.isFinite(sharedDirectoryOffset) ? sharedDirectoryOffset : 0, directoryFrontier: sharedDirectoryFrontier, includeSupplierLeadsWithoutProjectToken: true });
const discovery = mergeMaterializedSourceEvidenceDiscoveries({ discoveries: { local: localDiscovery, shared: sharedDiscovery } });

function requiresCandidateTextExtraction(document) {
  if (document.roles?.includes('structural-supplier-submittal') || document.roles?.includes('issued-structural-design')) return true;
  // Generic files in a local issued bid set are not useful supplier leads.  Generic
  // files found in the scoped shared-drive window are scanned because suppliers
  // often upload them as "Attachment" or another non-descriptive filename.
  return document.scanScopes?.includes('shared') && document.roles?.includes('unclassified');
}

async function extractPdfText(document) {
  if (document.extension !== '.pdf') return { ...document, extractedTextStatus: 'not-pdf', extractedText: '' };
  if (!requiresCandidateTextExtraction(document)) return { ...document, extractedTextStatus: 'not-requested', extractedText: '' };
  try {
    const loaded = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(document.path)),
      useWorkerFetch: false,
      isEvalSupported: false,
      standardFontDataUrl,
    }).promise;
    const extractedPageCount = Math.min(loaded.numPages, maxPdfTextPages);
    const pages = [];
    for (let index = 1; index <= extractedPageCount; index += 1) {
      const content = await (await loaded.getPage(index)).getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    const extractedText = pages.join('\n');
    return { ...document, extractedTextStatus: 'passed', pageCount: loaded.numPages, extractedPageCount, extractedTextComplete: extractedPageCount === loaded.numPages, extractedText, roles: classifyMaterializedSourceDocument({ ...document, extractedText }) };
  } catch (error) {
    return { ...document, extractedTextStatus: 'blocked', extractedText: '', extractedTextError: String(error.message || error) };
  }
}

const extractedDocuments = [];
for (const candidate of discovery.candidates) {
  const document = await extractPdfText(candidate);
  extractedDocuments.push({ ...document, ...classifyProjectIdentity({ ...document, projectTokens: projectIdentityTokens }) });
}
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
const projectIdentifiedDocuments = documents.filter((document) => document.projectIdentified === true);
const roofBoundedIds = new Set(placement.boundedMembers.map((member) => member.id));
const memberEvidence = classifyStructuralMemberEvidence({
  members: [...candidates.beams, ...candidates.joists].filter((member) => roofBoundedIds.has(member.id) && member?.section?.status === 'source-bounded-dry-minimum-dressed-section'),
  documents: projectIdentifiedDocuments,
});
const supplierMaterialized = projectIdentifiedDocuments.some((document) => document.roles.includes('structural-supplier-submittal'));
const issues = discovery.issues.filter((entry) => entry.code !== 'STRUCTURAL_SUPPLIER_SUBMITTAL_NOT_MATERIALIZED');
if (!supplierMaterialized) issues.push({ code: 'STRUCTURAL_SUPPLIER_SUBMITTAL_NOT_MATERIALIZED', severity: 'blocking', message: 'No candidate structural supplier/truss/lumber submittal is materialized in the scanned corpus.', refs: [] });
const unverifiedSupplierLeads = documents.filter((document) => document.supplierLeadWithoutPathIdentity && document.projectIdentified !== true);
if (unverifiedSupplierLeads.length) issues.push({ code: 'STRUCTURAL_SUPPLIER_LEAD_PROJECT_IDENTITY_UNVERIFIED', severity: 'blocking', message: 'Generic supplier lead(s) were found, but their extracted source text does not identify Cooperative 1881.', refs: unverifiedSupplierLeads.map((document) => document.sha256) });
const output = {
  ...discovery,
  artifactType: 'halofire.cooperative-1881-roof-framing-source-discovery.v2',
  projectName: 'Cooperative 1881',
  sourceStructuralPdfSha256: candidates.source_structural_pdf_sha256,
  extractionPolicy: {
    maxPdfTextPages,
    note: 'Discovery text is deliberately bounded. A truncated document can identify a candidate but cannot supply exact member dimensions, orientation, or vertical-datum proof.',
  },
  projectIdentity: {
    tokens: projectIdentityTokens,
    projectIdentifiedDocumentCount: projectIdentifiedDocuments.length,
    unverifiedSupplierLeadCount: unverifiedSupplierLeads.length,
    note: 'A generic supplier lead is not project evidence unless its path or bounded extracted source text identifies the project.',
  },
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
const scanWindowSummary = Object.fromEntries(Object.entries(output.scanWindows).map(([scope, window]) => [scope, {
  scanComplete: window.scanComplete,
  scannedRoots: window.scannedRoots,
  scannedFileCount: window.scannedFileCount,
  scannedDirectoryCount: window.scannedDirectoryCount,
  nextDirectoryOffset: window.nextDirectoryOffset,
  frontierEntries: Object.values(window.nextDirectoryFrontier || {}).reduce((count, frontier) => count + frontier.length, 0),
}]));
console.log(JSON.stringify({ outputPath, status: output.status, scanWindows: scanWindowSummary, counts: { files: output.scannedFileCount, directories: output.scannedDirectoryCount, candidates: output.candidates.length, boundedMembers: output.memberEvidence.witnesses.length, supplierCandidates: output.documents.filter((document) => document.roles.includes('structural-supplier-submittal')).length }, issues: output.issues }, null, 2));
