import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXTENSIONS = new Set(['.pdf', '.dwg', '.dxf', '.ifc', '.doc', '.docx', '.xls', '.xlsx']);

const roleForPath = (filePath) => {
  const value = filePath.toLowerCase().replaceAll('_', ' ');
  const roles = [];
  if (/(supplier|fabricator)|((truss|lumber|framing).{0,32}(submittal|supplier|manufacturer))/.test(value)) roles.push('structural-supplier-submittal');
  if (/(shop drawing|shop-drawing|sprinkler|fire protection|fire-protection)/.test(value)) roles.push('sprinkler-shop-drawing');
  if (/(structural|structurals|s-\d{3})/.test(value)) roles.push('issued-structural-design');
  return roles.length ? roles : ['unclassified'];
};

const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

function issue(code, message, refs = []) {
  return { code, severity: 'blocking', message, refs };
}

export function classifyMaterializedSourceDocument(document) {
  const pathRoles = roleForPath(document?.path || '');
  const text = String(document?.extractedText || '').toLowerCase();
  const roles = new Set(pathRoles.filter((role) => role !== 'unclassified'));
  if (/(supplier|fabricator).{0,48}(truss|lumber|framing)|(truss|lumber|framing).{0,48}(supplier|fabricator|submittal|manufacturer)/s.test(text)) roles.add('structural-supplier-submittal');
  if (/(structural drawings|structural general notes|\bs-\d{3}\b)/.test(text)) roles.add('issued-structural-design');
  if (/(fire sprinkler|sprinkler system|fire protection)/.test(text)) roles.add('sprinkler-shop-drawing');
  return roles.size ? [...roles].sort() : ['unclassified'];
}

/**
 * Bounded, deterministic discovery for materialized bid-corpus files.  It records
 * candidate evidence but intentionally does not infer a fabrication dimension from a
 * filename, a completed sprinkler shop drawing, or an issued structural plan.
 */
export function discoverMaterializedSourceEvidence(input) {
  const roots = Array.isArray(input?.roots) ? input.roots : [];
  const projectTokens = (Array.isArray(input?.projectTokens) ? input.projectTokens : [])
    .map((token) => String(token).trim().toLowerCase()).filter(Boolean);
  const extensions = new Set((input?.extensions || [...DEFAULT_EXTENSIONS]).map((extension) => String(extension).toLowerCase()));
  const maxFiles = Number.isInteger(input?.maxFiles) ? Math.max(1, Math.min(input.maxFiles, 50_000)) : 10_000;
  const candidates = [];
  const missingRoots = [];
  const scannedRoots = [];
  let scannedFileCount = 0;
  let budgetExhausted = false;

  for (const configuredRoot of roots) {
    const root = path.resolve(String(configuredRoot));
    if (!fs.existsSync(root)) {
      missingRoots.push(root);
      continue;
    }
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      missingRoots.push(root);
      continue;
    }
    scannedRoots.push(root);
    const pending = [root];
    while (pending.length && !budgetExhausted) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          pending.push(filePath);
          continue;
        }
        if (!entry.isFile()) continue;
        scannedFileCount += 1;
        if (scannedFileCount > maxFiles) {
          budgetExhausted = true;
          break;
        }
        const extension = path.extname(entry.name).toLowerCase();
        if (!extensions.has(extension)) continue;
        const normalizedPath = filePath.toLowerCase();
        const matchesProject = !projectTokens.length || projectTokens.some((token) => normalizedPath.includes(token));
        const roles = roleForPath(filePath);
        if (!matchesProject) continue;
        const statForFile = fs.statSync(filePath);
        candidates.push({
          path: filePath,
          relativeToRoot: path.relative(root, filePath).replaceAll('\\', '/'),
          extension,
          bytes: statForFile.size,
          sha256: sha256File(filePath),
          roles,
          projectTokenMatches: projectTokens.filter((token) => normalizedPath.includes(token)),
        });
      }
    }
  }
  candidates.sort((left, right) => left.path.localeCompare(right.path));
  const issues = [];
  if (!scannedRoots.length) issues.push(issue('SOURCE_CORPUS_ROOT_UNAVAILABLE', 'None of the configured corpus roots is materialized and readable.', missingRoots));
  if (budgetExhausted) issues.push(issue('SOURCE_CORPUS_SCAN_BUDGET_EXHAUSTED', `Discovery stopped after the ${maxFiles}-file budget; narrow the corpus root and rerun.`, scannedRoots));
  if (!candidates.some((entry) => entry.roles.includes('structural-supplier-submittal'))) {
    issues.push(issue('STRUCTURAL_SUPPLIER_SUBMITTAL_NOT_MATERIALIZED', 'No candidate structural supplier/truss/lumber submittal is materialized in the scanned corpus.'));
  }
  return {
    artifactType: 'halofire.materialized-source-evidence-discovery.v1',
    status: issues.length ? 'blocked' : 'passed',
    scanComplete: !budgetExhausted,
    scannedRoots,
    missingRoots,
    scannedFileCount,
    maxFiles,
    candidates,
    issues,
  };
}

export function classifyStructuralMemberEvidence(input) {
  const members = Array.isArray(input?.members) ? input.members : [];
  const rawDocuments = Array.isArray(input?.documents) ? input.documents : [];
  const documentByHash = new Map();
  for (const document of rawDocuments) {
    const key = String(document?.sha256 || '');
    if (!key) continue;
    const existing = documentByHash.get(key);
    documentByHash.set(key, existing ? {
      ...existing,
      roles: [...new Set([...(existing.roles || []), ...(document.roles || [])])],
      extractedText: existing.extractedText || document.extractedText || '',
    } : document);
  }
  const documents = [...documentByHash.values()];
  const witnesses = members.map((member) => {
    const tag = String(member?.member || '').trim();
    const matchingDocuments = tag ? documents.filter((document) => String(document?.extractedText || '').toUpperCase().includes(tag.toUpperCase())) : [];
    const supplierDocuments = matchingDocuments.filter((document) => document.roles?.includes('structural-supplier-submittal'));
    const issuedDesignDocuments = matchingDocuments.filter((document) => document.roles?.includes('issued-structural-design'));
    const sprinklerShopDrawingDocuments = matchingDocuments.filter((document) => document.roles?.includes('sprinkler-shop-drawing'));
    return {
      memberId: member?.id || null,
      memberTag: tag || null,
      matchingDocumentSha256: matchingDocuments.map((document) => document.sha256),
      supplierDocumentSha256: supplierDocuments.map((document) => document.sha256),
      issuedDesignDocumentSha256: issuedDesignDocuments.map((document) => document.sha256),
      sprinklerShopDrawingDocumentSha256: sprinklerShopDrawingDocuments.map((document) => document.sha256),
      exactPhysicalPromotionAllowed: false,
      promotionBlockedReason: supplierDocuments.length
        ? 'Supplier candidate found, but an exact member-level dressed-dimension, orientation, and vertical-datum extractor is still required.'
        : 'No materialized structural supplier/truss/lumber submittal contains this member tag; issued plans and sprinkler shop drawings are not fabrication proof.',
    };
  });
  return {
    witnesses,
    physicalPromotionAllowed: false,
    codeComplianceReady: false,
    fabricationReady: false,
    issues: [issue('STRUCTURAL_MEMBER_EVIDENCE_NOT_SUFFICIENT_FOR_PHYSICAL_PROMOTION', 'Discovery can locate source candidates, but it cannot turn plan labels into exact fabricated members.')],
  };
}

/**
 * Converts source-discovery findings into a routing/clearance input.  This is
 * deliberately a gate, not a clearance calculator: NFPA obstruction distances
 * require actual obstruction geometry and the selected sprinkler criteria.
 */
export function buildRoofFramingClearancePreflight(input) {
  const placement = input?.placement;
  const discovery = input?.discovery;
  const issues = [];
  const boundedMembers = Array.isArray(placement?.boundedMembers) ? placement.boundedMembers : [];
  const witnesses = Array.isArray(discovery?.memberEvidence?.witnesses) ? discovery.memberEvidence.witnesses : [];
  if (!placement?.evaluationComplete || placement?.counts?.skipped !== 0) {
    issues.push(issue('ROOF_FRAMING_PLACEMENT_ACCOUNTING_INCOMPLETE', 'Clearance preflight requires the zero-skip roof-framing placement artifact.'));
  }
  if (!placement?.sourceStructuralPdfSha256 || placement.sourceStructuralPdfSha256 !== discovery?.sourceStructuralPdfSha256) {
    issues.push(issue('ROOF_FRAMING_DISCOVERY_SOURCE_HASH_MISMATCH', 'Roof placement and source discovery do not bind the same structural PDF hash.'));
  }
  const boundedIds = new Set(boundedMembers.map((member) => member.id));
  const witnessIds = new Set(witnesses.map((witness) => witness.memberId));
  if (boundedIds.size !== witnessIds.size || [...boundedIds].some((id) => !witnessIds.has(id))) {
    issues.push(issue('ROOF_FRAMING_DISCOVERY_MEMBER_SET_MISMATCH', 'Every bounded roof-framing member requires a matching source-discovery witness.'));
  }
  if (witnesses.some((witness) => witness.exactPhysicalPromotionAllowed !== false)) {
    issues.push(issue('ROOF_FRAMING_DISCOVERY_FALSE_PHYSICAL_PROMOTION', 'A discovery witness may not clear physical framing without the separate exact-dimension extractor.'));
  }
  if (!discovery?.claims || discovery.claims.structuralSupplierSubmittalMaterialized !== true) {
    issues.push(issue('ROOF_FRAMING_OBSTRUCTION_GEOMETRY_UNRESOLVED', 'Automatic pipe/head clearance cannot use bounded roof framing until an exact supplier/truss/lumber source is materialized and extracted.'));
  }
  return {
    artifactType: 'halofire.roof-framing-clearance-preflight.v1',
    status: issues.length ? 'blocked' : 'passed',
    sourceStructuralPdfSha256: placement?.sourceStructuralPdfSha256 || null,
    roofEvidenceReceiptSha256: placement?.roofEvidenceReceiptSha256 || null,
    boundedMemberCount: boundedMembers.length,
    obstructionInventoryStatus: issues.length ? 'unresolved-source-bound-framing' : 'exact-source-bound-framing',
    automaticPipeRoutingAllowed: false,
    perHeadObstructionClearanceVerified: false,
    codeComplianceReady: false,
    fabricationReady: false,
    memberConstraints: boundedMembers.map((member) => ({
      memberId: member.id,
      memberTag: member.member,
      planCenterlineEndpointsFt: member.topEndpointsFt,
      state: 'source-bounded-not-physical',
      routingConstraint: 'do-not-claim-obstruction-clearance-until-exact-geometry-is-extracted',
    })),
    issues,
  };
}
