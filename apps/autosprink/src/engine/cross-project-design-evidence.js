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
  }
  const submitted = new Map(files.filter((file) => file.phase === 'stamped_submittal').map((file) => [file.sheet, file.sha256]));
  const asBuilt = new Map(files.filter((file) => file.phase === 'as_built').map((file) => [file.sheet, file.sha256]));
  const pairedSheets = [...submitted.keys()].filter((sheet) => asBuilt.has(sheet));
  if (!pairedSheets.length) issues.push('submitted_to_as_built_pairs_missing');
  const changedSheets = pairedSheets.filter((sheet) => submitted.get(sheet) !== asBuilt.get(sheet));
  if (!changedSheets.length) issues.push('submitted_to_as_built_delta_unproven');
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectId: sourceSet.projectId,
    fileCount: files.length,
    pairedSheets,
    changedSheets,
    phases: [...phases].sort(),
    sourceViews: [...views].sort(),
    issues,
  };
}
