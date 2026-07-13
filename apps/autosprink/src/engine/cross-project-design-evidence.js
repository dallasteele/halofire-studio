const SHA256 = /^[0-9a-f]{64}$/;

export const COMPLETED_PROJECT_CLAIMS = [
  'as_built_feedback_loop',
  'completed_output_to_fabrication',
  'manufacturer_family_trace',
  'multi_floor_completed_output',
  'pitched_roof_fabrication_spatial_mapping',
  'roof_structure_coordination',
  'source_to_completed_sprinkler_layout',
];

const REQUIRED_COMPLETED_PROJECT_ROLES = [
  'source_coordination',
  'field_output',
  'as_built_output',
  'fabrication',
];

function hasApprovalContract(roles) {
  return roles.has('approved_output') || (roles.has('final_ahj_submission') && roles.has('issued_permit'));
}

function normalizedFamilyKey(family) {
  return `${family?.manufacturer || ''}:${family?.family || ''}`.toLowerCase();
}

function validateDeclaredClaims(declaredClaims, supportedClaims, issues) {
  const declared = Array.isArray(declaredClaims) ? [...new Set(declaredClaims)] : [];
  for (const claim of declared) {
    if (!COMPLETED_PROJECT_CLAIMS.includes(claim)) issues.push(`claim_unknown:${claim}`);
    else if (!supportedClaims.has(claim)) issues.push(`claim_evidence_missing:${claim}`);
  }
  return declared.filter((claim) => supportedClaims.has(claim)).sort();
}

export function validateCrossProjectDesignSourceSet(sourceSet, referenceProjectId = 'dillon-residence') {
  const issues = [];
  if (!sourceSet || sourceSet.artifactType !== 'halofire.cross-project-design-source-set.v1') {
    return { status: 'blocked', issues: ['source_set_schema_invalid'] };
  }
  if (!sourceSet.projectId || sourceSet.projectId === referenceProjectId) issues.push('independent_project_missing');
  const files = Array.isArray(sourceSet.files) ? sourceSet.files : [];
  const phases = new Set(files.map((file) => file.phase));
  const views = new Set(files.filter((file) => file.phase === 'source_architecture').map((file) => file.view));
  for (const phase of sourceSet.requiredPhases || []) if (!phases.has(phase)) issues.push(`required_phase_missing:${phase}`);
  for (const view of sourceSet.requiredSourceViews || []) if (!views.has(view)) issues.push(`required_source_view_missing:${view}`);
  for (const file of files) {
    if (!file.path || !Number.isInteger(file.bytes) || file.bytes <= 0 || !SHA256.test(file.sha256 || '')) {
      issues.push(`invalid_file_binding:${file.sheet || 'unknown'}`);
    }
    if (['stamped_submittal', 'as_built'].includes(file.phase)
      && (!SHA256.test(file.contentSha256 || '') || !Number.isInteger(file.annotationCount) || file.annotationCount < 0)) {
      issues.push(`invalid_lifecycle_binding:${file.sheet || 'unknown'}:${file.phase}`);
    }
  }
  const submitted = new Map(files.filter((file) => file.phase === 'stamped_submittal').map((file) => [file.sheet, file]));
  const asBuilt = new Map(files.filter((file) => file.phase === 'as_built').map((file) => [file.sheet, file]));
  const pairedSheets = [...submitted.keys()].filter((sheet) => asBuilt.has(sheet));
  if (!pairedSheets.length) issues.push('submitted_to_as_built_pairs_missing');
  const fileChangedSheets = pairedSheets.filter((sheet) => submitted.get(sheet).sha256 !== asBuilt.get(sheet).sha256);
  const geometryChangedSheets = pairedSheets.filter((sheet) => submitted.get(sheet).contentSha256 !== asBuilt.get(sheet).contentSha256);
  const annotationChangedSheets = pairedSheets.filter((sheet) => submitted.get(sheet).annotationCount !== asBuilt.get(sheet).annotationCount);
  if (!fileChangedSheets.length || !annotationChangedSheets.length) issues.push('submitted_to_as_built_lifecycle_delta_unproven');
  const supportedClaims = new Set();
  if (phases.has('source_architecture') && phases.has('stamped_submittal') && phases.has('as_built')) {
    supportedClaims.add('source_to_completed_sprinkler_layout');
  }
  if (phases.has('as_built') && phases.has('fabrication')) supportedClaims.add('completed_output_to_fabrication');
  if (files.some((file) => file.view === 'manufacturer_sprinkler_cut_sheet') && phases.has('fabrication')) {
    supportedClaims.add('manufacturer_family_trace');
  }
  if (views.has('roof_plan') && views.has('building_section') && phases.has('as_built')) {
    supportedClaims.add('roof_structure_coordination');
  }
  if (fileChangedSheets.length && annotationChangedSheets.length) supportedClaims.add('as_built_feedback_loop');
  const verifiedClaims = validateDeclaredClaims(sourceSet.verifiedClaims, supportedClaims, issues);
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectId: sourceSet.projectId,
    fileCount: files.length,
    pairedSheets,
    fileChangedSheets,
    geometryChangedSheets,
    annotationChangedSheets,
    verifiedClaims,
    phases: [...phases].sort(),
    sourceViews: [...views].sort(),
    issues,
  };
}

export function validateCompletedProjectEvidenceSet(sourceSet, referenceProjectId = 'dillon-residence') {
  const issues = [];
  if (!sourceSet || sourceSet.artifactType !== 'halofire.completed-project-evidence-set.v1') {
    return { status: 'blocked', issues: ['completed_project_schema_invalid'] };
  }
  if (!sourceSet.projectId || sourceSet.projectId === referenceProjectId) issues.push('independent_project_missing');
  const files = Array.isArray(sourceSet.files) ? sourceSet.files : [];
  const excludedArtifacts = Array.isArray(sourceSet.excludedArtifacts) ? sourceSet.excludedArtifacts : [];
  const excludedHashes = new Set(excludedArtifacts.map((artifact) => artifact.sha256));
  const evidenceRoles = new Set(files.map((file) => file.evidenceRole));
  const declaredRequiredRoles = new Set(sourceSet.requiredEvidenceRoles || []);
  for (const role of REQUIRED_COMPLETED_PROJECT_ROLES) {
    if (!declaredRequiredRoles.has(role)) issues.push(`required_evidence_contract_drift:${role}`);
    if (!evidenceRoles.has(role)) issues.push(`required_evidence_role_missing:${role}`);
  }
  if (!hasApprovalContract(declaredRequiredRoles)) issues.push('required_evidence_contract_drift:approval_basis');
  if (!hasApprovalContract(evidenceRoles)) issues.push('required_evidence_role_missing:approval_basis');
  for (const file of files) {
    const label = file.sheet || file.levelId || file.view || 'unknown';
    if (!file.path || !file.evidenceRole || !file.view || !Number.isInteger(file.bytes) || file.bytes <= 0 || !SHA256.test(file.sha256 || '')) {
      issues.push(`invalid_file_binding:${label}`);
    }
    if (excludedHashes.has(file.sha256)) issues.push(`excluded_artifact_reintroduced:${label}`);
  }
  for (const artifact of excludedArtifacts) {
    if (!artifact.path || !artifact.reason || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0 || !SHA256.test(artifact.sha256 || '')) {
      issues.push(`invalid_excluded_artifact:${artifact.path || 'unknown'}`);
    }
  }

  const fabricationFiles = new Map(files
    .filter((file) => file.evidenceRole === 'fabrication' && file.levelId)
    .map((file) => [file.levelId, file]));
  const inventories = Array.isArray(sourceSet.fabricationInventories) ? sourceSet.fabricationInventories : [];
  const inventoryLevels = new Set();
  const inventoryFamilies = new Set();
  for (const inventory of inventories) {
    if (!inventory.levelId || inventoryLevels.has(inventory.levelId)) issues.push(`fabrication_inventory_level_invalid:${inventory.levelId || 'unknown'}`);
    inventoryLevels.add(inventory.levelId);
    const file = fabricationFiles.get(inventory.levelId);
    if (!file || file.sha256 !== inventory.fileSha256) issues.push(`fabrication_inventory_file_missing:${inventory.levelId || 'unknown'}`);
    if (!Number.isInteger(inventory.pipingRows) || inventory.pipingRows <= 0
      || !Number.isInteger(inventory.outletRows) || inventory.outletRows <= 0) {
      issues.push(`fabrication_inventory_counts_invalid:${inventory.levelId || 'unknown'}`);
    }
    for (const family of inventory.sprinklerFamilies || []) {
      if (!family.manufacturer || !family.family || !Number.isInteger(family.quantity) || family.quantity <= 0) {
        issues.push(`fabrication_family_invalid:${inventory.levelId || 'unknown'}`);
      } else {
        inventoryFamilies.add(normalizedFamilyKey(family));
      }
    }
  }
  for (const levelId of fabricationFiles.keys()) {
    if (!inventoryLevels.has(levelId)) issues.push(`fabrication_inventory_missing:${levelId}`);
  }

  const asBuiltFiles = files.filter((file) => file.evidenceRole === 'as_built_output');
  const asBuiltFamilies = new Set(asBuiltFiles.flatMap((file) => file.observedManufacturerFamilies || []).map(normalizedFamilyKey));
  const approvedHashes = new Set(files
    .filter((file) => ['approved_output', 'final_ahj_submission'].includes(file.evidenceRole))
    .map((file) => file.sha256));
  const fieldHashes = new Set(files.filter((file) => file.evidenceRole === 'field_output').map((file) => file.sha256));
  const asBuiltHashes = new Set(asBuiltFiles.map((file) => file.sha256));
  const completedLevels = new Set(asBuiltFiles.flatMap((file) => file.completedLevels || []));
  const supportedClaims = new Set();
  if (asBuiltFiles.length && fabricationFiles.size && inventories.length === fabricationFiles.size) {
    supportedClaims.add('completed_output_to_fabrication');
  }
  if ([...inventoryFamilies].some((family) => asBuiltFamilies.has(family))) supportedClaims.add('manufacturer_family_trace');
  if (files.some((file) => file.evidenceRole === 'source_coordination' && file.view === 'roof_framing') && asBuiltFiles.length) {
    supportedClaims.add('roof_structure_coordination');
  }
  const sourceViews = new Set(files.filter((file) => file.evidenceRole === 'source_coordination').map((file) => file.view));
  if (sourceViews.has('floor_plan') && sourceViews.has('reflected_ceiling_plan')
    && sourceViews.has('building_section') && asBuiltFiles.length) {
    supportedClaims.add('source_to_completed_sprinkler_layout');
  }
  if (approvedHashes.size && fieldHashes.size && asBuiltHashes.size
    && ![...approvedHashes].some((hash) => fieldHashes.has(hash) || asBuiltHashes.has(hash))
    && ![...fieldHashes].some((hash) => asBuiltHashes.has(hash))) {
    supportedClaims.add('as_built_feedback_loop');
  }
  const multiFloorVisualProof = asBuiltFiles.some((file) => {
    const markers = (file.visualVerification?.markers || []).map((marker) => marker.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const levels = file.completedLevels || [];
    const levelMarkerPresent = (level) => {
      const normalized = String(level).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const aliases = normalized === 'mezzanine' ? ['mezzanine', 'mezz'] : [normalized];
      return markers.some((marker) => aliases.some((alias) => marker.includes(alias)));
    };
    return levels.length >= 2
      && levels.every(levelMarkerPresent)
      && markers.some((marker) => marker.includes('crosssection'))
      && markers.some((marker) => marker.includes('3d'));
  });
  if (completedLevels.size >= 2 && multiFloorVisualProof) {
    supportedClaims.add('multi_floor_completed_output');
  }
  const verifiedClaims = validateDeclaredClaims(sourceSet.verifiedClaims, supportedClaims, issues);
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectId: sourceSet.projectId,
    fileCount: files.length,
    excludedArtifactCount: excludedArtifacts.length,
    evidenceRoles: [...evidenceRoles].sort(),
    fabricationLevels: [...inventoryLevels].sort(),
    fabricationPipingRows: inventories.reduce((sum, inventory) => sum + (inventory.pipingRows || 0), 0),
    fabricationOutletRows: inventories.reduce((sum, inventory) => sum + (inventory.outletRows || 0), 0),
    verifiedClaims,
    issues,
  };
}

function validateProjectEvidence(sourceSet, referenceProjectId) {
  if (sourceSet?.artifactType === 'halofire.cross-project-design-source-set.v1') {
    return validateCrossProjectDesignSourceSet(sourceSet, referenceProjectId);
  }
  return validateCompletedProjectEvidenceSet(sourceSet, referenceProjectId);
}

export function validateCompletedProjectEvidencePortfolio(sourceSets, options = {}) {
  const {
    referenceProjectId = 'dillon-residence',
    minimumProjects = 2,
    minimumProjectsPerClaim = 2,
  } = options;
  const issues = [];
  const sets = Array.isArray(sourceSets) ? sourceSets : [];
  const results = sets.map((sourceSet) => validateProjectEvidence(sourceSet, referenceProjectId));
  const projectIds = results.map((result) => result.projectId).filter(Boolean);
  const uniqueProjectIds = new Set(projectIds);
  if (uniqueProjectIds.size < minimumProjects) issues.push(`completed_project_count_below_minimum:${uniqueProjectIds.size}/${minimumProjects}`);
  if (uniqueProjectIds.size !== projectIds.length) issues.push('completed_project_ids_not_unique');
  for (const result of results) {
    if (result.status !== 'passed') issues.push(`completed_project_evidence_blocked:${result.projectId || 'unknown'}`);
  }
  const claimCoverage = Object.fromEntries(COMPLETED_PROJECT_CLAIMS.map((claim) => {
    const projects = [...new Set(results
      .filter((result) => result.status === 'passed' && result.verifiedClaims?.includes(claim))
      .map((result) => result.projectId))];
    return [claim, projects];
  }));
  const featurePromotion = Object.fromEntries(COMPLETED_PROJECT_CLAIMS.map((claim) => [
    claim,
    {
      ready: claimCoverage[claim].length >= minimumProjectsPerClaim,
      projectCount: claimCoverage[claim].length,
      requiredProjectCount: minimumProjectsPerClaim,
      projects: claimCoverage[claim],
    },
  ]));
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectCount: uniqueProjectIds.size,
    projectIds: [...uniqueProjectIds].sort(),
    results,
    claimCoverage,
    featurePromotion,
    issues,
  };
}
