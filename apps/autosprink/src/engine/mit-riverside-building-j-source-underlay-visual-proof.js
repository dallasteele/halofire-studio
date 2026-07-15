const PDF_SHA256 = '08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export function validateMitRiversideBuildingJSourceUnderlayVisualProof(proof) {
  const issues = [];
  if (proof?.artifactType !== 'halofire.mit-riverside-building-j-source-underlay-visual-proof.v1') issues.push(issue('MIT_J_UNDERLAY_PROOF_TYPE', 'Unexpected visual-proof artifact type.'));
  if (proof?.sourcePdf?.bytes !== 116713715 || proof?.sourcePdf?.sha256 !== PDF_SHA256) issues.push(issue('MIT_J_UNDERLAY_SOURCE_BINDING', 'Visual proof is not bound to the protected architectural bid PDF.'));
  const roof = proof?.roofPlan;
  if (roof?.sourcePage !== 106 || roof?.sourcePageIndex !== 105 || roof?.actualProtectedPdfUnderlayVisible !== true) issues.push(issue('MIT_J_ROOF_PDF_UNDERLAY_MISSING', 'The actual protected roof-plan page must remain visible behind the registered geometry.'));
  if (roof?.registeredHeadCount !== 68 || roof?.registeredCricketFaceCount !== 4) issues.push(issue('MIT_J_ROOF_OVERLAY_COUNT', 'The source roof overlay must include all 68 heads and four exact drain wedges.'));
  if (!Number.isInteger(roof?.pixelWidth) || roof.pixelWidth < 1600 || !Number.isInteger(roof?.pixelHeight) || roof.pixelHeight < 2200 || !Number.isInteger(roof?.bytes) || roof.bytes < 100000 || !SHA.test(roof?.sha256 || '')) issues.push(issue('MIT_J_ROOF_RASTER_EVIDENCE_WEAK', 'Roof underlay raster dimensions, bytes, or digest are missing.'));
  const sections = proof?.sections;
  if (sections?.sourcePage !== 110 || sections?.sourcePageIndex !== 109 || sections?.actualProtectedPdfUnderlayVisible !== true || sections?.sourceProfiles !== 4) issues.push(issue('MIT_J_SECTION_PDF_UNDERLAY_MISSING', 'The actual protected E/F section page and four source roof profiles must remain visible.'));
  if (!Number.isInteger(sections?.pixelWidth) || sections.pixelWidth < 2000 || !Number.isInteger(sections?.pixelHeight) || sections.pixelHeight < 1600 || !Number.isInteger(sections?.bytes) || sections.bytes < 100000 || !SHA.test(sections?.sha256 || '')) issues.push(issue('MIT_J_SECTION_RASTER_EVIDENCE_WEAK', 'Section underlay raster dimensions, bytes, or digest are missing.'));
  const model3d = proof?.model3d;
  if (model3d?.sourcePdfPlanProjectedInto3d !== true || model3d?.registrationAnchorCount !== 4 || model3d?.roofSurfaceCount !== 3 || model3d?.sourceProtectionTargetCount !== 53 || model3d?.pendingPendentXyCount !== 15) issues.push(issue('MIT_J_3D_SOURCE_REGISTRATION_MISSING', 'The 3D proof must project the protected PDF plan and preserve anchors, surfaces, targets, and pending pendent XY markers.'));
  if (!Number.isInteger(model3d?.bytes) || model3d.bytes < 5000 || !SHA.test(model3d?.sha256 || '') || model3d?.file !== 'source-pdf-registered-3d.svg') issues.push(issue('MIT_J_3D_VISUAL_EVIDENCE_WEAK', 'The source-registered 3D artifact bytes, digest, or filename are missing.'));
  const rcp = proof?.rcpCeilingEnvelope;
  if (rcp?.sourcePage !== 105 || rcp?.sourcePageIndex !== 104 || rcp?.actualProtectedPdfUnderlayVisible !== true || rcp?.ceilingZoneCount !== 20 || rcp?.pendentCeilingPlaneCount !== 15 || rcp?.aboveFinishedCeilingUprightCount !== 7 || rcp?.exactInstalledHeadZReady !== false) issues.push(issue('MIT_J_RCP_CEILING_UNDERLAY_MISSING', 'The protected RCP must visibly carry 20 ceiling zones, 15 pendent planes, seven above-ceiling uprights, and no exact installed Z claim.'));
  if (!Number.isInteger(rcp?.pixelWidth) || rcp.pixelWidth < 2000 || !Number.isInteger(rcp?.pixelHeight) || rcp.pixelHeight < 2700 || !Number.isInteger(rcp?.bytes) || rcp.bytes < 100000 || !SHA.test(rcp?.sha256 || '')) issues.push(issue('MIT_J_RCP_CEILING_RASTER_EVIDENCE_WEAK', 'RCP ceiling-envelope raster dimensions, bytes, or digest are missing.'));
  const boundary = proof?.claimBoundary;
  if (boundary?.sourceRegistrationReady !== true || boundary?.installedHeadElevationReady !== false || boundary?.complianceReady !== false || boundary?.fabricationReady !== false || boundary?.fieldReleaseReady !== false) issues.push(issue('MIT_J_UNDERLAY_FALSE_PROMOTION', 'Source underlay proof may not promote installed elevation, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourcePdfUnderlaysVisible: issues.length === 0, registeredHeadCount: issues.length ? 0 : 68, sourceRegistered3dReady: issues.length === 0, installedHeadElevationReady: false, complianceReady: false };
}

export function verifyMitRiversideBuildingJSourceUnderlayVisualProofAdversarialLoop(proof) {
  const cases = [
    ['type', (value) => { value.artifactType = 'schematic'; }],
    ['source-sha', (value) => { value.sourcePdf.sha256 = '0'.repeat(64); }],
    ['roof-page', (value) => { value.roofPlan.sourcePage = 105; }],
    ['roof-underlay', (value) => { value.roofPlan.actualProtectedPdfUnderlayVisible = false; }],
    ['heads', (value) => { value.roofPlan.registeredHeadCount = 53; }],
    ['crickets', (value) => { value.roofPlan.registeredCricketFaceCount = 3; }],
    ['roof-width', (value) => { value.roofPlan.pixelWidth = 900; }],
    ['roof-bytes', (value) => { value.roofPlan.bytes = 1024; }],
    ['roof-digest', (value) => { value.roofPlan.sha256 = 'bad'; }],
    ['section-page', (value) => { value.sections.sourcePageIndex = 110; }],
    ['section-underlay', (value) => { value.sections.actualProtectedPdfUnderlayVisible = false; }],
    ['section-profiles', (value) => { value.sections.sourceProfiles = 3; }],
    ['section-height', (value) => { value.sections.pixelHeight = 800; }],
    ['section-digest', (value) => { value.sections.sha256 = 'bad'; }],
    ['3d-underlay', (value) => { value.model3d.sourcePdfPlanProjectedInto3d = false; }],
    ['3d-anchors', (value) => { value.model3d.registrationAnchorCount = 3; }],
    ['3d-surfaces', (value) => { value.model3d.roofSurfaceCount = 2; }],
    ['3d-targets', (value) => { value.model3d.sourceProtectionTargetCount = 52; }],
    ['3d-pending', (value) => { value.model3d.pendingPendentXyCount = 0; }],
    ['3d-digest', (value) => { value.model3d.sha256 = 'bad'; }],
    ['rcp-underlay', (value) => { value.rcpCeilingEnvelope.actualProtectedPdfUnderlayVisible = false; }],
    ['rcp-zones', (value) => { value.rcpCeilingEnvelope.ceilingZoneCount = 19; }],
    ['rcp-pendents', (value) => { value.rcpCeilingEnvelope.pendentCeilingPlaneCount = 14; }],
    ['rcp-uprights', (value) => { value.rcpCeilingEnvelope.aboveFinishedCeilingUprightCount = 6; }],
    ['rcp-z', (value) => { value.rcpCeilingEnvelope.exactInstalledHeadZReady = true; }],
    ['rcp-digest', (value) => { value.rcpCeilingEnvelope.sha256 = 'bad'; }],
    ['installed-z', (value) => { value.claimBoundary.installedHeadElevationReady = true; }],
    ['compliance', (value) => { value.claimBoundary.complianceReady = true; }],
    ['fabrication', (value) => { value.claimBoundary.fabricationReady = true; }],
    ['release', (value) => { value.claimBoundary.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(proof);
    mutate(value);
    if (validateMitRiversideBuildingJSourceUnderlayVisualProof(value).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, sourcePdfUnderlaysVisible: true, sourceRegistered3dReady: true, installedHeadElevationReady: false, complianceReady: false };
}
