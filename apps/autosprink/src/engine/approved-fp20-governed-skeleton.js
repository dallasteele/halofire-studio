const EXPECTED_SOURCE_HASHES = Object.freeze({
  'approved-plan': '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5',
  'field-set': '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5',
  'as-built': 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B',
});

const EXPECTED_OPERATIONAL_INDICES = Object.freeze([
  3054, 3878, 3880, 3882, 3884, 3886, 3888, 3890, 3892,
  3896, 3898, 3900, 3902, 4834, 4835, 6610, 6620,
]);
const FORBIDDEN_DIMENSION_BASELINES = Object.freeze([4961, 4963]);
const CROSS_MAIN_IDS = new Set([
  'pipe-001', 'pipe-002', 'pipe-003', 'pipe-030', 'pipe-031',
  'pipe-058', 'pipe-059', 'pipe-060', 'pipe-061', 'pipe-062',
  'pipe-063', 'pipe-064', 'pipe-067',
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const finitePoint = (value) => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function expectedAssignment(segment, lineBinding) {
  if (lineBinding) return { nominalDiameterIn: lineBinding.nominalDiameterIn, systemRole: lineBinding.systemRole };
  if (segment.strokeClass === 'navy-arm-over') return { nominalDiameterIn: 1, systemRole: 'arm-over' };
  if (segment.strokeClass === 'black-pipe') return { nominalDiameterIn: 2, systemRole: 'branch-line' };
  if (CROSS_MAIN_IDS.has(segment.id)) {
    const nominalDiameterIn = segment.id === 'pipe-001' ? 4 : 3;
    return { nominalDiameterIn, systemRole: segment.id === 'pipe-001' ? 'source-feed' : 'cross-main' };
  }
  return { nominalDiameterIn: 2.5, systemRole: 'branch-line' };
}

function validateFabricationLineEvidence(annotations, issues) {
  const evidence = annotations?.fabricationLineEvidence;
  if (evidence?.artifactType !== 'halofire.approved-fp20-fabrication-line-evidence.v1'
    || evidence?.fieldSet?.sha256 !== EXPECTED_SOURCE_HASHES['field-set']
    || evidence?.asBuilt?.sha256 !== EXPECTED_SOURCE_HASHES['as-built']
    || evidence?.fabricationListing?.sha256 !== '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
    || evidence?.fabricationListing?.software !== 'AutoSPRINK 2023 v18.1.44.0'
    || evidence?.fabricationArchive?.sha256 !== 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9') {
    issues.push(issue('FP20_FABRICATION_LINE_SOURCE_INVALID', 'Field-set line names and fabricated main/branch identities must remain bound to the exact field set, as-built, AutoSPRINK listing, and FAB archive.'));
  }
  const cmk = evidence?.primaryLineBindings?.find((entry) => entry.lineName === 'CMK');
  if (cmk?.systemRole !== 'cross-main'
    || cmk?.nominalDiameterIn !== 2.5
    || JSON.stringify(cmk?.sourceSegmentIds) !== JSON.stringify(['pipe-004', 'pipe-005', 'pipe-006'])
    || JSON.stringify(cmk?.pieceIds) !== JSON.stringify(['CMK.01', 'CMK.02', 'CMK.03'])
    || cmk?.terminalCanonicalNodeId !== 'canonical-node-009'
    || cmk?.branchOutletCanonicalNodeId !== 'canonical-node-010'
    || cmk?.systemConnectionCanonicalNodeId !== 'canonical-node-007') {
    issues.push(issue('FP20_CMK_LINE_BINDING_INVALID', 'CMK.01-.03 must bind pipe-004/005/006 as one 2.5-inch cross main from the system connection to its capped high end and branch outlets.', 'CMK'));
  }
  const crossing = evidence?.separatedCrossings?.find((entry) => entry.canonicalNodeId === 'canonical-node-022');
  if (crossing?.crossMainSourceSegmentId !== 'pipe-062'
    || crossing?.branchLineSourceSegmentId !== 'pipe-013'
    || crossing?.branchPieceId !== 'BL48.02'
    || crossing?.branchPieceLength !== "21'-0"
    || crossing?.branchPieceOutletCount !== 0) {
    issues.push(issue('FP20_FABRICATION_CROSSING_SEPARATION_INVALID', 'BL48.02 must remain a continuous no-outlet branch piece crossing CMI at canonical-node-022 without becoming a false tee.', 'canonical-node-022'));
  }
  return new Map((evidence?.primaryLineBindings || []).flatMap((binding) => (binding.sourceSegmentIds || []).map((sourceSegmentId) => [sourceSegmentId, binding])));
}

function validateSources(annotations, issues) {
  const sources = Array.isArray(annotations?.sources) ? annotations.sources : [];
  const byRole = new Map(sources.map((source) => [source.role, source]));
  for (const [role, hash] of Object.entries(EXPECTED_SOURCE_HASHES)) {
    if (byRole.get(role)?.sha256 !== hash || byRole.get(role)?.sheet !== 'FP2.0') {
      issues.push(issue('FP20_OPERATIONAL_SOURCE_BINDING_INVALID', `Operational annotations must remain bound to the exact ${role} FP2.0 source.`, role));
    }
  }
  const invariant = annotations?.crossSourceCalloutInvariance;
  if (invariant?.sourceRoles?.length !== 3 || invariant?.preservedCalloutIds?.length !== 10) {
    issues.push(issue('FP20_CROSS_SOURCE_CALLOUT_INVARIANCE_MISSING', 'Approved, field-set, and as-built sources must preserve all ten governed callouts.'));
  }
}

function validateHydraulicCalculationCorpus(annotations, issues) {
  const report = annotations?.hydraulicCalculationSources?.calculationReport;
  const plates = annotations?.hydraulicCalculationSources?.closeoutCalcPlates;
  if (report?.sha256 !== 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719' || report?.pageCount !== 33 || report?.software !== 'AutoSPRINK 2023 v18.1.44.0') {
    issues.push(issue('FP20_HYDRAULIC_CALCULATION_SOURCE_INVALID', 'Hydraulic evidence must remain bound to the exact 33-page approved AutoSPRINK calculation report.'));
  }
  const fp20Areas = (report?.remoteAreas || []).filter((entry) => entry.sheet === 'FP2.0');
  if (JSON.stringify(fp20Areas.map((entry) => entry.id)) !== JSON.stringify(['2-1', '2-2', '2-3']) || fp20Areas.some((entry) => !entry.pipeTablePages?.length || !Number.isFinite(entry.systemDemandGpm) || !Number.isFinite(entry.baseOfRiserPsi))) {
    issues.push(issue('FP20_HYDRAULIC_REMOTE_AREA_SET_INVALID', 'FP2.0 calculation evidence must include remote areas 2-1, 2-2, and 2-3 with pipe-table pages, demand, and base-of-riser pressure.'));
  }
  if (plates?.sha256 !== 'E1C8F0184EF2470FFA7450B772EAEB13D0022A79E95573D29F753DDEF0AB14AF' || plates?.pageCount !== 2 || plates?.remoteAreaIds?.length !== 4) {
    issues.push(issue('FP20_HYDRAULIC_CALC_PLATES_INVALID', 'Closeout calculation plates must corroborate all four remote-area identities.'));
  }
}

function validatePrimaryAssignments(pipeEvidence, lineBindingBySegmentId, issues) {
  const segments = Array.isArray(pipeEvidence?.pipeSegments) ? pipeEvidence.pipeSegments : [];
  const assignments = segments.map((segment) => ({
    sourceSegmentId: segment.id,
    strokeClass: segment.strokeClass,
    ...expectedAssignment(segment, lineBindingBySegmentId.get(segment.id)),
    assignmentBasis: lineBindingBySegmentId.has(segment.id)
      ? `exact field-set line label plus AutoSPRINK fabrication listing and FAB archive; ${lineBindingBySegmentId.get(segment.id).lineName}`
      : `approved FP2.0 stroke class and diameter callout continuity; drawing index ${segment.drawingIndex}`,
  }));
  if (segments.length !== 67) issues.push(issue('FP20_PRIMARY_SEGMENT_COUNT_INVALID', 'The governed primary assignment requires all 67 source-extracted main, branch, and arm-over segments.'));
  if (assignments.some((entry) => ![1, 2, 2.5, 3, 4].includes(entry.nominalDiameterIn) || !entry.systemRole)) {
    issues.push(issue('FP20_PRIMARY_SIZE_ROLE_ASSIGNMENT_INCOMPLETE', 'Every primary source segment needs a nominal diameter and system role.'));
  }
  return assignments;
}

function validateOperationalReferences(annotations, issues) {
  const references = Array.isArray(annotations?.operationalReferenceVectors) ? annotations.operationalReferenceVectors : [];
  const actual = references.map((entry) => entry.drawingIndex).sort((a, b) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_OPERATIONAL_INDICES)) {
    issues.push(issue('FP20_OPERATIONAL_VECTOR_SET_INVALID', 'The operational layer must contain the exact 17 drain and inspector-test source vectors.'));
  }
  for (const reference of references) {
    if (!finitePoint(reference.fromPdfPt) || !finitePoint(reference.toPdfPt) || distance(reference.fromPdfPt, reference.toPdfPt) <= 0.5 || !['field-drain-reference', 'low-point-drain-reference', 'remote-inspectors-test'].includes(reference.systemRole)) {
      issues.push(issue('FP20_OPERATIONAL_VECTOR_INVALID', 'Every operational reference vector needs finite source geometry and a governed system role.', String(reference.drawingIndex)));
    }
    if (FORBIDDEN_DIMENSION_BASELINES.includes(reference.drawingIndex)) issues.push(issue('FP20_DIMENSION_BASELINE_PROMOTED_TO_PIPE', 'Dimension baselines 4961 and 4963 are not pipe routes.', String(reference.drawingIndex)));
  }
  if (JSON.stringify([...(annotations?.excludedNonPipeDrawingIndices || [])].sort((a, b) => a - b)) !== JSON.stringify(FORBIDDEN_DIMENSION_BASELINES)) {
    issues.push(issue('FP20_NON_PIPE_EXCLUSION_INVALID', 'The two central cyan dimension baselines must stay explicitly excluded from pipe geometry.'));
  }
  return references;
}

function validateOperationalFeatures(annotations, planGraph, issues) {
  const nodeIds = new Set((planGraph?.nodes || []).map((node) => node.id));
  const supply = annotations?.supplyAnchor;
  if (supply?.rawText !== 'SUPPLY FROM RISER ROOM' || !nodeIds.has(supply?.boundPrimaryNodeId) || !finitePoint(supply?.leaderTargetPdfPt)) {
    issues.push(issue('FP20_SUPPLY_ANCHOR_INVALID', 'The riser-room supply callout must bind to its source-proved primary graph node.'));
  }
  const lowPoints = Array.isArray(annotations?.lowPointAnchors) ? annotations.lowPointAnchors : [];
  if (lowPoints.length !== 4 || lowPoints.some((entry) => entry.rawText !== 'LOW POINT TIE IN DRAIN' || !entry.boundPrimaryNodeIds?.some((id) => nodeIds.has(id)))) {
    issues.push(issue('FP20_LOW_POINT_ANCHOR_SET_INVALID', 'All four source-proved low-point tie-in anchors must bind to primary graph nodes.'));
  }
  const drainIntents = Array.isArray(annotations?.fieldRouteDrainIntents) ? annotations.fieldRouteDrainIntents : [];
  if (drainIntents.length !== 2 || drainIntents.some((entry) => entry.routeStatus !== 'field-resolution-required' || entry.nominalDiameterIn !== 1 || !entry.rawText?.startsWith('FIELD ROUTE / LOCATE'))) {
    issues.push(issue('FP20_FIELD_DRAIN_INTENT_INVALID', 'Both one-inch drum-drip drains must preserve their source-required field-resolution status.'));
  }
  if (annotations?.remoteInspectorsTest?.rawText !== 'REMOTE INSPECTORS TEST' || annotations?.remoteInspectorsTest?.nominalDiameterIn !== 1) {
    issues.push(issue('FP20_INSPECTORS_TEST_INVALID', 'The remote inspector test must remain a source-bound one-inch operational route.'));
  }
  const grades = Array.isArray(annotations?.gradeRequirements) ? annotations.gradeRequirements : [];
  if (grades.length !== 2 || grades[0]?.riseInPer10Ft !== 0.5 || grades[1]?.riseInPer10Ft !== 0.25) {
    issues.push(issue('FP20_GRADE_MAGNITUDE_INVALID', 'Branch and cross-main grade magnitudes must match the approved dry-system note.'));
  }
}

export function evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, annotations) {
  const issues = [];
  if (annotations?.artifactType !== 'halofire.approved-fp20-operational-annotations.v1' || annotations?.projectId !== pipeEvidence?.projectId || annotations?.projectId !== planGraph?.projectId) {
    issues.push(issue('FP20_GOVERNED_SKELETON_IDENTITY_INVALID', 'Pipe vectors, plan graph, and operational annotations must identify the same project.'));
  }
  validateSources(annotations, issues);
  validateHydraulicCalculationCorpus(annotations, issues);
  const lineBindingBySegmentId = validateFabricationLineEvidence(annotations, issues);
  const primaryAssignments = validatePrimaryAssignments(pipeEvidence, lineBindingBySegmentId, issues);
  const operationalReferenceVectors = validateOperationalReferences(annotations, issues);
  validateOperationalFeatures(annotations, planGraph, issues);

  const fieldDrainRouteResolved = false;
  const gradeDirectionReady = false;
  const endpointElevationsReady = false;
  const remainingLayoutBlockers = [
    {
      code: 'FP20_CONNECTOR_CLUSTER_CANONICALIZATION_REQUIRED',
      message: 'Multi-segment source contacts must be contracted into canonical junctions before hydraulic flow is solved; pairwise connector triangles cannot become false flow cycles.',
    },
    {
      code: 'FP20_HYDRAULIC_FLOW_DIRECTION_UNRESOLVED',
      message: 'The approved AutoSPRINK calculation corpus is present; its pipe-table node routes and plan arrows still must bind to canonical graph edges.',
    },
    {
      code: 'FP20_GRADE_DIRECTION_UNRESOLVED',
      message: 'The approved note proves grade magnitude, but each branch and cross-main edge still needs a source-consistent high-to-low direction.',
    },
    {
      code: 'FP20_ENDPOINT_ELEVATION_UNRESOLVED',
      message: 'A102/A103/A201/A301 and the coordinated roof/RCP/section DWGs register the pitched building envelope; exact pipe centerline offsets and every non-calculated endpoint Z still must be source-bound before grade or pitched-roof routing can be accepted.',
    },
    {
      code: 'FP20_FIELD_DRAIN_ROUTE_UNRESOLVED',
      message: 'Two one-inch drum-drip runs remain field-resolution-required in the approved, field-set, and as-built drawings.',
    },
    {
      code: 'FP20_FITTING_IDENTITY_UNRESOLVED',
      message: 'Canonical junctions, transitions, endpoints, low-point tie-ins, drains, and the inspector test still need fitting identities.',
    },
  ];
  return {
    artifactType: 'halofire.approved-fp20-governed-skeleton-result.v1',
    projectId: annotations?.projectId,
    status: issues.length ? 'blocked' : 'passed',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    primaryAssignments,
    operationalReferenceVectors,
    remainingLayoutBlockers,
    metrics: {
      primarySegmentCount: primaryAssignments.length,
      assignedPrimarySegmentCount: primaryAssignments.filter((entry) => entry.systemRole && entry.nominalDiameterIn).length,
      operationalReferenceVectorCount: operationalReferenceVectors.length,
      lowPointAnchorCount: annotations?.lowPointAnchors?.length || 0,
      fieldDrainIntentCount: annotations?.fieldRouteDrainIntents?.length || 0,
      gradeRequirementCount: annotations?.gradeRequirements?.length || 0,
      fp20HydraulicRemoteAreaCount: annotations?.hydraulicCalculationSources?.calculationReport?.remoteAreas?.filter((entry) => entry.sheet === 'FP2.0').length || 0,
      fabricationLineBoundSegmentCount: lineBindingBySegmentId.size,
    },
    primaryPipeVectorExtractionReady: issues.length === 0 && primaryAssignments.length === 67,
    primaryPipeSizeAssignmentReady: issues.length === 0 && primaryAssignments.length === 67,
    primaryPipeRoleAssignmentReady: issues.length === 0 && primaryAssignments.length === 67,
    operationalReferenceExtractionReady: issues.length === 0 && operationalReferenceVectors.length === 17,
    supplySourceAnchorReady: issues.length === 0,
    lowPointIntentReady: issues.length === 0,
    drainIntentReady: issues.length === 0,
    gradeMagnitudeReady: issues.length === 0,
    hydraulicCalculationCorpusReady: issues.length === 0,
    fabricationLineRoleBindingReady: issues.length === 0 && lineBindingBySegmentId.size === 3,
    separatedCrossingEvidenceReady: issues.length === 0,
    hydraulicNodeBindingReady: false,
    wholeSystemVectorExtractionReady: false,
    hydraulicFlowReady: false,
    fieldDrainRouteResolved,
    gradeDirectionReady,
    endpointElevationsReady,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
