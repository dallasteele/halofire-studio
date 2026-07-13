import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Source = z.object({ sheetId: z.string().min(1), sha256: SHA, kind: z.string().min(1) }).strict();
const Pitch = z.object({
  id: z.string().min(1), method: z.enum(['source-vector-text', 'canny-hough-long-section-edge']),
  riseIn: z.number().positive(), runIn: z.number().positive(), sourceText: z.string().min(1).optional(),
  sourceLinePx: z.array(z.number().int()).length(4).optional(), sourceLineLengthPx: z.number().positive().optional(),
}).strict();
const Datum = z.object({ id: z.string().min(1), kind: z.string().min(1), sourceText: z.string().min(1), elevationFt: z.number().finite() }).strict();
const Output = z.object({ surfaceCount: z.number().int().nonnegative(), protectedSurfaceCount: z.number().int().nonnegative(), headCount: z.number().int().nonnegative(), slopeFollowingPipeCount: z.number().int().nonnegative() }).strict();
const Project = z.object({ projectId: z.enum(['dillon-residence', 'dallas-temple', 'tallahassee-temple', 'winter-garden-meetinghouse']), evidenceRole: z.string().min(1), sources: z.array(Source).min(2), pitchObservations: z.array(Pitch), datumObservations: z.array(Datum).min(1), completedOutput: Output }).strict();
const Acceptance = z.object({ minimumIndependentProjects: z.literal(3), minimumPitchedProjects: z.literal(3), maximumDallasSectionPitchSpreadInPer12: z.literal(.1), dallasCalibrationRiseInPer12: z.literal(8.5195), winterGardenCalibrationRiseInPer12: z.literal(4.5), structuralRoofPromotionRequiresPitchAndDatum: z.literal(true), complianceReady: z.literal(false) }).strict();
const Draft = z.object({ artifactType: z.literal('halofire.pitched-roof-cross-project-evidence.v1'), projects: z.array(Project).length(4), acceptance: Acceptance, claimStatus: z.literal('cross-project-pitched-geometry-calibration-not-code-compliance-or-approval') }).strict();
const Packet = Draft.extend({ receiptSha256: SHA }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (a, b, tolerance = 1e-8) => Math.abs(a - b) <= tolerance;

const EXPECTED_SOURCES = Object.freeze({
  'dillon-residence': Object.freeze({ 'architectural-RCP': 'ed51fe47cdbb0c95db5d3a4f64117fe2625d3c0bf4e7170c6f3dec0d38ed11ba', 'submitted-FP1': 'ea09a1fe2b1e175170e980a0e0960a7e7f2bf82f949668ae1c895e163c604a63' }),
  'dallas-temple': Object.freeze({ 'A-9': 'd15c239fdacf5a03f2444eb4458b8185bc9982645c068838e9ed364f5dd6a8a6', 'A-10': '30187ba4990dd117f2916d30261276883c6bf80dbe08468efb375ad0ef5d28e1', 'FP-3-RCP': '485c988de578bf740028724844bc38f0a3705d2c3994efd2c3cf475952cd6cb4', 'FP-1.2-REVIEWED': 'da7da6a82a9812f3bbf4846a1f0079709b4a86720b0ef38647bf3d8cc797d647' }),
  'tallahassee-temple': Object.freeze({ A107: 'e820f549f293d10cdeb050c5fd53fdc67c844f7d1232ae6bb324a2f2faec2f70', A302: '8d1836052731eb29172cdd4d4eff2f63ee205d3f62e8f74e689eab1b7498e521', 'ASBUILT-FP3': '42ea9845a8a5596c1914bed31b6946862e51c07086806572dfb0161a6918d01d' }),
  'winter-garden-meetinghouse': Object.freeze({ A121: '0fa8d19cf2a8ca421a3cad7200b410763eee701bb566ca84d37321b1b51ce921', A201: 'f756533aaf7bb8f1229b28226d26d0fbb53c9cd09f80af2bdcf1b271963243a8', A301: '719ae05138b3872c2ed8740fa4470ca457dcc0a9f8fec617cabf7969560ecc30', 'ASBUILT-FP3': '13aa82f90bf7b03bc0b4728d0b631321372a48932d2a55187dad6edc947de3a0' }),
});

export async function sealPitchedRoofCrossProjectEvidence(input) {
  const parsed = Draft.parse(input);
  return { ...parsed, receiptSha256: await sha256Hex(parsed) };
}

export async function validatePitchedRoofCrossProjectEvidence(input) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('PITCHED_ROOF_CROSS_PROJECT_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  const packet = parsed.data; const { receiptSha256, ...draft } = packet; const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('PITCHED_ROOF_CROSS_PROJECT_RECEIPT_MISMATCH', 'Cross-project evidence does not match its sealed receipt.'));
  for (const project of packet.projects) {
    const expected = EXPECTED_SOURCES[project.projectId];
    if (!expected || project.sources.length !== Object.keys(expected).length || project.sources.some((source) => expected[source.sheetId] !== source.sha256)) issues.push(issue('PITCHED_ROOF_CROSS_PROJECT_SOURCE_DRIFT', `${project.projectId} source identities no longer match the selected completed-project corpus.`));
  }
  const dillon = packet.projects.find((project) => project.projectId === 'dillon-residence');
  if (!dillon || dillon.pitchObservations.length < 2 || dillon.pitchObservations.some((entry) => entry.method !== 'source-vector-text' || entry.riseIn !== 3 || entry.runIn !== 12)) issues.push(issue('PITCHED_ROOF_DILLON_VECTOR_PITCH_DRIFT', 'Dillon vector 3:12 controls are missing or changed.'));
  const dallas = packet.projects.find((project) => project.projectId === 'dallas-temple'); const dallasPitches = dallas?.pitchObservations.map((entry) => entry.riseIn) ?? [];
  const pitchSpread = dallasPitches.length ? Math.max(...dallasPitches) - Math.min(...dallasPitches) : Infinity; const pitchMean = dallasPitches.length ? dallasPitches.reduce((sum, value) => sum + value, 0) / dallasPitches.length : NaN;
  if (!dallas || dallas.pitchObservations.length !== 4 || dallas.pitchObservations.some((entry) => entry.method !== 'canny-hough-long-section-edge' || entry.runIn !== 12 || !entry.sourceLinePx || (entry.sourceLineLengthPx ?? 0) < 900) || pitchSpread > packet.acceptance.maximumDallasSectionPitchSpreadInPer12 || !near(pitchMean, packet.acceptance.dallasCalibrationRiseInPer12)) issues.push(issue('PITCHED_ROOF_DALLAS_SECTION_DISAGREEMENT', 'Independent A-9/A-10 long roof edges do not agree with the sealed steep-roof calibration.'));
  const ridge = dallas?.datumObservations.find((entry) => entry.id === 'a10-ridge'); const bearings = dallas?.datumObservations.filter((entry) => entry.kind === 'bearing-plate') ?? [];
  const sectionRiseFt = ridge && bearings.length === 2 ? ridge.elevationFt - bearings[0].elevationFt : NaN;
  if (!ridge || bearings.length !== 2 || !near(bearings[0].elevationFt, bearings[1].elevationFt) || !near(sectionRiseFt, 12.84375)) issues.push(issue('PITCHED_ROOF_DALLAS_DATUM_DRIFT', 'A-10 ridge and bearing-plate elevations no longer prove the sealed vertical rise.'));
  const tallahassee = packet.projects.find((project) => project.projectId === 'tallahassee-temple'); const elevations = tallahassee?.datumObservations.map((entry) => entry.elevationFt) ?? [];
  if (!tallahassee || elevations.length < 4 || elevations.some((value, index) => index && value <= elevations[index - 1])) issues.push(issue('PITCHED_ROOF_TALLAHASSEE_LEVEL_DRIFT', 'Tallahassee roof/section/as-built levels are missing or non-monotonic.'));
  const winterGarden = packet.projects.find((project) => project.projectId === 'winter-garden-meetinghouse');
  const winterPitches = winterGarden?.pitchObservations ?? [];
  if (!winterGarden || winterPitches.length !== 2 || winterPitches.some((entry) => entry.method !== 'source-vector-text' || entry.runIn !== 12 || !near(entry.riseIn, packet.acceptance.winterGardenCalibrationRiseInPer12))) issues.push(issue('PITCHED_ROOF_WINTER_GARDEN_PITCH_DRIFT', 'Winter Garden A121/A301 vector pitch labels no longer agree at 4.5:12.'));
  const winterDatum = new Map((winterGarden?.datumObservations ?? []).map((entry) => [entry.id, entry.elevationFt]));
  if (!near(winterDatum.get('a201-level-1-slab'), 100) || !near(winterDatum.get('a301-roof-bearing-chapel'), 115.6666666667) || !near(winterDatum.get('a301-bottom-of-truss'), 119.5) || !near(winterDatum.get('a201-rake-beam'), 125.9583333333) || !near(winterDatum.get('a201-steeple'), 155) || winterGarden?.completedOutput.headCount !== 329) issues.push(issue('PITCHED_ROOF_WINTER_GARDEN_DATUM_DRIFT', 'Winter Garden elevation chain or observed as-built head total changed.'));
  const pitchedProjects = packet.projects.filter((project) => project.pitchObservations.length > 0).length;
  if (packet.projects.length < packet.acceptance.minimumIndependentProjects || pitchedProjects < packet.acceptance.minimumPitchedProjects || packet.acceptance.complianceReady) issues.push(issue('PITCHED_ROOF_CROSS_PROJECT_ACCEPTANCE_DRIFT', 'Cross-project minimums or fail-closed compliance status changed.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, metrics: { projectCount: packet.projects.length, pitchedProjectCount: pitchedProjects, dallasPitchMeanInPer12: pitchMean, dallasPitchSpreadInPer12: pitchSpread, dallasSectionRiseFt: sectionRiseFt, winterGardenPitchInPer12: winterPitches[0]?.riseIn ?? null, winterGardenRoofBearingFt: winterDatum.get('a301-roof-bearing-chapel') ?? null, winterGardenRakeBeamFt: winterDatum.get('a201-rake-beam') ?? null }, complianceReady: false, claimStatus: packet.claimStatus };
}

export function buildPitchedRoofCalibrationCases(validation) {
  if (validation?.status !== 'passed' || !validation.packet) return { status: 'blocked', issues: [issue('PITCHED_ROOF_CROSS_PROJECT_NOT_VALIDATED', 'Passed cross-project evidence is required.')] };
  const dallas = validation.packet.projects.find((project) => project.projectId === 'dallas-temple');
  const ridge = dallas.datumObservations.find((entry) => entry.id === 'a10-ridge').elevationFt; const bearing = dallas.datumObservations.find((entry) => entry.id === 'a10-left-bearing').elevationFt;
  const dallasRiseIn = validation.packet.acceptance.dallasCalibrationRiseInPer12; const dallasSpanFt = (ridge - bearing) / (dallasRiseIn / 12);
  const winterGarden = validation.packet.projects.find((project) => project.projectId === 'winter-garden-meetinghouse');
  const winterDatum = new Map(winterGarden.datumObservations.map((entry) => [entry.id, entry.elevationFt]));
  const winterRiseIn = validation.packet.acceptance.winterGardenCalibrationRiseInPer12;
  const winterBearing = winterDatum.get('a301-roof-bearing-chapel'); const winterRake = winterDatum.get('a201-rake-beam');
  const winterSpanFt = (winterRake - winterBearing) / (winterRiseIn / 12);
  return {
    status: 'passed', artifactType: 'halofire.pitched-roof-calibration-cases.v1',
    cases: [
      { id: 'dillon-vector-3-12', riseIn: 3, runIn: 12, spanFt: 18, uphillElevationFt: 109, downhillElevationFt: 104.5, sourceMode: 'vector-text-plus-project-datum' },
      { id: 'dallas-scanned-section-steep-roof', riseIn: dallasRiseIn, runIn: 12, spanFt: dallasSpanFt, uphillElevationFt: ridge, downhillElevationFt: bearing, sourceMode: 'independent-a9-a10-section-lines-plus-elevation-labels' },
      { id: 'winter-garden-vector-4.5-12', riseIn: winterRiseIn, runIn: 12, spanFt: winterSpanFt, uphillElevationFt: winterRake, downhillElevationFt: winterBearing, sourceMode: 'a121-a301-vector-pitch-plus-a201-a301-datums' },
    ],
    complianceReady: false,
  };
}
