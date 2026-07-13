const SHA256 = /^[0-9a-f]{64}$/;

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
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectId: sourceSet.projectId,
    fileCount: files.length,
    pairedSheets,
    fileChangedSheets,
    geometryChangedSheets,
    annotationChangedSheets,
    phases: [...phases].sort(),
    sourceViews: [...views].sort(),
    issues,
  };
}
