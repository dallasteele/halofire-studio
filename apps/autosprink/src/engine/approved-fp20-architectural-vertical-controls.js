/** Dependency-free source gate for New Hope FP2.0 architectural vertical controls. */

const ARCHITECTURAL_PDF_SHA = '9f9f8b97cfb35931474566156f35d97520ae993052dac046efacb408f32ea0a7';
const REQUIRED_SHEETS = Object.freeze(['A101', 'A102', 'A103', 'A201', 'A301']);
const REQUIRED_DWGS = Object.freeze({
  floor: ['79d985df4f51567b8f881d0253700d832c6b5522990923ee5358bd3d2269e898', 2542915],
  rcp: ['4bfeab0b1679fb042274881a7111e3f81a192ff1cf5b3695c2ca3680c3f83eb1', 719994],
  roof: ['b57e51aeaaeb622ba4ea86337ff1910c8c7d5c3f34ae5c266ec89b7f4d8d61f3', 128516],
  section3: ['470252c77ade5743d8f0d7953904bb7d36e16da4abb4fb6f81c85b7874425f56', 519787],
  section4: ['d872b0e6101d2033a7eead83e12e30ce43fd28e1068c14be322da5076d5a6156', 639863],
  section5: ['e21a6bb8a46d841c1dad8be5558cc9a144fa04ff9c706fc3042931e1db75419a', 488148],
});

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });

export function evaluateApprovedFp20ArchitecturalVerticalControls(source) {
  const issues = [];
  const architecturalPdf = source?.protectedSources?.architecturalPdf;
  const dwgs = source?.protectedSources?.dwgs;
  const volume = source?.pitchedConcealedVolume;
  const registration = volume?.sourceRegistration;

  if (source?.artifactType !== 'halofire.protected-pitched-attic-holdout-source.v1' || source?.projectId !== 'new-hope-crisis-center-brigham-city-ut') {
    issues.push(issue('FP20_ARCHITECTURAL_PROJECT_IDENTITY_INVALID', 'The architectural vertical-control packet must remain bound to New Hope.'));
  }
  if (architecturalPdf?.sha256 !== ARCHITECTURAL_PDF_SHA || architecturalPdf?.bytes !== 66511145 || architecturalPdf?.pageCount !== 53 || JSON.stringify(architecturalPdf?.allowedSheets) !== JSON.stringify(REQUIRED_SHEETS)) {
    issues.push(issue('FP20_ARCHITECTURAL_PDF_IDENTITY_INVALID', 'The exact 53-page bid-set PDF and A101/A102/A103/A201/A301 sheet allowlist are required.'));
  }
  for (const [id, [sha256, bytes]] of Object.entries(REQUIRED_DWGS)) {
    const dwg = dwgs?.[id];
    if (dwg?.sha256 !== sha256 || dwg?.bytes !== bytes || dwg?.reader !== '@mlightcad/libredwg-web 0.7.7' || dwg?.unknownEntityCount !== 0) {
      issues.push(issue('FP20_ARCHITECTURAL_DWG_IDENTITY_INVALID', `The coordinated ${id} DWG identity or zero-unknown parse changed.`, id));
    }
  }
  if (registration?.featureId !== volume?.id
    || registration?.floor?.page !== 'A101' || registration?.floor?.pdfPageNumber !== 22
    || registration?.rcp?.page !== 'A102' || registration?.rcp?.pdfPageNumber !== 23
    || registration?.roof?.page !== 'A103' || registration?.roof?.pdfPageNumber !== 24
    || registration?.section?.page !== 'A301' || registration?.section?.pdfPageNumber !== 26) {
    issues.push(issue('FP20_ARCHITECTURAL_SHEET_REGISTRATION_INVALID', 'A101 floor, A102 RCP, A103 roof, and A301 section must bind one pitched feature at their exact physical pages.'));
  }
  if (volume?.slopeRise !== 4 || volume?.slopeRun !== 12 || volume?.ridgeAxis !== 'x'
    || volume?.eaveDatumZFt !== 11.083333 || volume?.ridgeDatumZFt !== 21.208333
    || registration?.section?.trussBearingDatumZFt !== 10.96875) {
    issues.push(issue('FP20_ARCHITECTURAL_VERTICAL_DATUM_INVALID', 'The source-bound 4:12 roof, eave, ridge, and truss-bearing controls changed.'));
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.approved-fp20-architectural-vertical-control-result.v1',
    projectId: source?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    registeredSheets: ready ? [
      { sheet: 'A102', physicalPageNumber: 23, role: 'reflected-ceiling-plan' },
      { sheet: 'A103', physicalPageNumber: 24, role: 'roof-plan' },
      { sheet: 'A201', physicalPageNumber: 25, role: 'exterior-elevations' },
      { sheet: 'A301', physicalPageNumber: 26, role: 'building-sections' },
    ] : [],
    roofEnvelope: ready ? {
      slopeRise: volume.slopeRise,
      slopeRun: volume.slopeRun,
      eaveDatumZFt: volume.eaveDatumZFt,
      ridgeDatumZFt: volume.ridgeDatumZFt,
      trussBearingDatumZFt: registration.section.trussBearingDatumZFt,
    } : null,
    sourceRegistrationReady: ready,
    architecturalVerticalControlReady: ready,
    pipeCenterlineOffsetReady: false,
    endpointElevationsReady: false,
    gradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
