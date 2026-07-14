import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealRegerFloresBoxBeamCalibration(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export function replayRegerFloresBoxBeamCalibration(value) {
  const geometry = value.geometry;
  const beamLines = geometry.beamStationsFt.map((stationSubmittedPt, index) => ({ id: `reger-box-beam-${index + 1}`, kind: 'box-beam', axis: 'x', stationSubmittedPt, widthIn: geometry.beamWidthIn, spansRegion: true, partitionProtectionRegion: true }));
  const regions = [
    { id: 'vault-west-plane', polygonSubmittedPt: [[0, 0], [geometry.halfRunFt, 0], [geometry.halfRunFt, geometry.lengthFt], [0, geometry.lengthFt]], slopeAxis: 'x', downhillDirection: 'negative-x', riseIn: geometry.pitch.riseIn, runIn: geometry.pitch.runIn, shouldProtect: true, obstructions: [], linearObstructions: beamLines },
    { id: 'vault-east-plane', polygonSubmittedPt: [[geometry.halfRunFt, 0], [geometry.widthFt, 0], [geometry.widthFt, geometry.lengthFt], [geometry.halfRunFt, geometry.lengthFt]], slopeAxis: 'x', downhillDirection: 'positive-x', riseIn: geometry.pitch.riseIn, runIn: geometry.pitch.runIn, shouldProtect: true, obstructions: [], linearObstructions: beamLines },
  ];
  return generateSlopedCeilingLayout({ artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1, regions, maxAcrossSlopeSpanFt: value.layoutControls.maxAcrossSlopeSpanFt, maxAlongSlopeSpanFt: value.layoutControls.maxAlongSlopeSpanFt });
}

export async function validateRegerFloresBoxBeamCalibration(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.reger-flores-box-beam-calibration.v1') return { status: 'blocked', issues: [issue('REGER_BEAM_CALIBRATION_SCHEMA_INVALID', 'Reger-Flores beam calibration identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('REGER_BEAM_CALIBRATION_RECEIPT_MISMATCH', 'The beam calibration no longer matches its receipt.'));
  const source = value.sourceEvidence;
  if (source?.ceilingCadSha256 !== '62156c099f062a4bef85edcab4dbf4e262586655b1c462003e2cdeed99dea279' || source?.completedPdfSha256 !== 'af45158d0e52a87faa78973b171245d6c772d46d5edccfad0e8410e88c8ffce9'
    || source?.correctedVaultLengthFt !== 24 || source?.rejectedPriorVaultLengthFt !== 16 || source?.dimensionEntities?.length !== 3 || source.dimensionEntities.some((entry) => entry.text !== "8'-0\"") || source?.beamLabels?.length !== 3) issues.push(issue('REGER_BEAM_SOURCE_EVIDENCE_DRIFT', 'The three source-proven eight-foot beam bays changed.'));
  const geometry = value.geometry;
  if (geometry?.widthFt !== 18.5 || geometry?.lengthFt !== 24 || geometry?.halfRunFt !== 9.25 || geometry?.pitch?.riseIn !== 4 || geometry?.pitch?.runIn !== 12 || geometry?.beamWidthIn !== 8 || JSON.stringify(geometry?.beamStationsFt) !== '[8,16]') issues.push(issue('REGER_BEAM_GEOMETRY_DRIFT', 'The corrected 18.5 by 24 foot, two-plane, beam-partitioned vault changed.'));
  const replay = replayRegerFloresBoxBeamCalibration(value);
  const yStations = replay.status === 'passed' ? replay.heads.map((head) => head.pointPt[1]) : [];
  if (replay.status !== 'passed' || replay.heads.length !== 6 || JSON.stringify(yStations) !== '[4,12,20,4,12,20]' || replay.regions.some((region) => region.partitionCells?.length !== 3)) issues.push(issue('REGER_BEAM_REPLAY_MISMATCH', 'Beam-aware replay must produce three protected cells per plane and six heads.'));
  const answer = value.answerEvidence; const result = value.calibrationResult;
  if (answer?.roomLabel !== 'LOUNGE VAULTED' || answer?.headCount !== 6 || answer?.slopeColumnCount !== 2 || answer?.ridgeDirectionRowsPerColumn !== 3
    || result?.status !== 'passed' || result?.generatedHeadCount !== 6 || result?.generatedSlopeColumnCount !== 2 || result?.generatedRidgeDirectionRowsPerColumn !== 3 || result?.topologyParityPassed !== true || result?.exactPlanPlacementClaimed !== false) issues.push(issue('REGER_BEAM_CALIBRATION_RESULT_DRIFT', 'Answer-exposed topology calibration must remain six heads in two columns by three rows without exact-placement promotion.'));
  if (value.sequence?.failedFreshComparisonReceiptSha256 !== '51a8afef5cf735d73a031bc66af86063f385960ecf816932488bfabe99b2cfd7' || value.sequence?.answerExposedBeforeThisCorrection !== true || value.sequence?.eligibleAsFreshHoldout !== false
    || value.unseenProjectPlacementVerified !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('REGER_BEAM_FALSE_PROMOTION', 'Answer-exposed calibration cannot become fresh acceptance or downstream readiness.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length !== 7) issues.push(issue('REGER_BEAM_LOOPS_INCOMPLETE', 'Primary, independent, and seven-case adversarial loops are required.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, calibrationReady: issues.length === 0, freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyRegerFloresBoxBeamCalibrationAdversarialLoop(packet) {
  const cases = [
    ['length', (v) => { v.geometry.lengthFt = 16; }], ['beam-remove', (v) => { v.geometry.beamStationsFt.pop(); }], ['beam-shift', (v) => { v.geometry.beamStationsFt[0] = 7; }],
    ['answer-count', (v) => { v.answerEvidence.headCount = 4; }], ['sequence', (v) => { v.sequence.answerExposedBeforeThisCorrection = false; }],
    ['fresh-pass', (v) => { v.unseenProjectPlacementVerified = true; }], ['compliance-pass', (v) => { v.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) { const changed = structuredClone(packet); mutate(changed); if ((await validateRegerFloresBoxBeamCalibration(await sealRegerFloresBoxBeamCalibration(changed))).status === 'blocked') rejectedCases.push(name); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function renderRegerFloresBoxBeamCalibrationViews(value) {
  const layout = replayRegerFloresBoxBeamCalibration(value);
  if (layout.status !== 'passed' || layout.heads.length !== 6) return { status: 'blocked', issues: [issue('REGER_BEAM_PROOF_LAYOUT_BLOCKED', 'A six-head beam-aware replay is required before visual proof can render.')] };
  const { widthFt, lengthFt, halfRunFt, springElevationFt, peakElevationFt, beamStationsFt } = value.geometry;
  const sx = 34; const sy = 24; const ox = 86; const oy = 82;
  const px = (feet) => ox + feet * sx; const py = (feet) => oy + feet * sy;
  const headSymbol = (x, y, id) => `<g data-head-id="${xml(id)}"><circle cx="${x}" cy="${y}" r="13" fill="#5ee7ff" stroke="#082f49" stroke-width="4"/><path d="M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}" stroke="#082f49" stroke-width="3"/></g>`;
  const topHeads = layout.heads.map((head) => headSymbol(px(head.pointPt[0]), py(head.pointPt[1]), head.id)).join('');
  const beamBands = beamStationsFt.map((station, index) => `<g data-box-beam="${index + 1}"><rect x="${px(0)}" y="${py(station) - 7}" width="${widthFt * sx}" height="14" fill="#f59e0b" fill-opacity=".32" stroke="#b45309" stroke-width="3"/><text x="${px(widthFt) + 16}" y="${py(station) + 5}" fill="#92400e" font-size="16">8 x 8 BOX BEAM</text></g>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 780" role="img" aria-label="Reger Flores beam-aware Bluebeam-style top layout"><rect width="980" height="780" fill="#f8fafc"/><text x="42" y="38" fill="#0f172a" font-size="22" font-family="Arial" font-weight="700">LOUNGE VAULTED - BEAM-AWARE CALIBRATION TOP VIEW</text><text x="42" y="62" fill="#b45309" font-size="14" font-family="Arial">Answer-exposed calibration; fresh unseen holdout and code review remain required</text><rect x="${px(0)}" y="${py(0)}" width="${widthFt * sx}" height="${lengthFt * sy}" fill="#fff" stroke="#0f172a" stroke-width="5"/>${beamBands}<line x1="${px(halfRunFt)}" y1="${py(0)}" x2="${px(halfRunFt)}" y2="${py(lengthFt)}" stroke="#7c3aed" stroke-width="5" stroke-dasharray="16 10"/>${topHeads}<text x="${px(halfRunFt) + 10}" y="${py(0) + 22}" fill="#6d28d9" font-size="16">RIDGE</text><text x="${px(0)}" y="${py(lengthFt) + 38}" fill="#334155" font-size="16">18.5 ft x 24 ft | 2 slope columns x 3 beam bays | 6 generated heads</text></svg>`;

  const ez = (z) => 610 - (z - springElevationFt) * 118; const ex = (feet) => 92 + feet * 40;
  const elevationHeads = layout.heads.filter((head) => head.pointPt[1] === 4).map((head) => {
    const z = springElevationFt + head.relativeElevationFt; return headSymbol(ex(head.pointPt[0]), ez(z), head.id);
  }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 720" role="img" aria-label="Reger Flores source-datum pitched elevation"><rect width="980" height="720" fill="#07111f"/><text x="42" y="42" fill="#e2e8f0" font-size="22" font-family="Arial" font-weight="700">SOURCE-DATUM PITCHED ELEVATION</text><text x="42" y="68" fill="#fbbf24" font-size="14" font-family="Arial">4:12 vault | spring 12 ft 1 in | peak 15 ft 2 in</text><path d="M ${ex(0)} ${ez(springElevationFt)} L ${ex(halfRunFt)} ${ez(peakElevationFt)} L ${ex(widthFt)} ${ez(springElevationFt)}" fill="none" stroke="#38bdf8" stroke-width="8"/>${elevationHeads}<line x1="${ex(0)}" y1="${ez(springElevationFt) + 42}" x2="${ex(widthFt)}" y2="${ez(springElevationFt) + 42}" stroke="#64748b" stroke-width="2" stroke-dasharray="10 8"/><text x="${ex(0)}" y="${ez(springElevationFt) + 72}" fill="#94a3b8" font-size="16">Side view controls elevation; heads lie on their actual ceiling planes</text></svg>`;

  const iso = ([x, y, z]) => [490 + (x - widthFt / 2) * 26 - (y - lengthFt / 2) * 13, 560 - (z - springElevationFt) * 65 - (x - widthFt / 2) * 8 - (y - lengthFt / 2) * 7];
  const polygon = (points) => points.map((point) => iso(point).join(',')).join(' ');
  const west = polygon([[0, 0, springElevationFt], [halfRunFt, 0, peakElevationFt], [halfRunFt, lengthFt, peakElevationFt], [0, lengthFt, springElevationFt]]);
  const east = polygon([[halfRunFt, 0, peakElevationFt], [widthFt, 0, springElevationFt], [widthFt, lengthFt, springElevationFt], [halfRunFt, lengthFt, peakElevationFt]]);
  const modelBeams = beamStationsFt.map((station) => { const a = iso([0, station, springElevationFt]); const r = iso([halfRunFt, station, peakElevationFt]); const b = iso([widthFt, station, springElevationFt]); return `<polyline points="${a.join(',')} ${r.join(',')} ${b.join(',')}" fill="none" stroke="#f59e0b" stroke-width="10" stroke-linecap="round"/>`; }).join('');
  const modelHeads = layout.heads.map((head) => { const z = springElevationFt + head.relativeElevationFt; const [x, y] = iso([head.pointPt[0], head.pointPt[1], z]); return headSymbol(x, y, head.id); }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 720" role="img" aria-label="Reger Flores beam-aware pitched three dimensional model"><rect width="980" height="720" fill="#070b12"/><text x="42" y="42" fill="#e2e8f0" font-size="22" font-family="Arial" font-weight="700">PDF/CAD TO 3D - FLOOR + PITCHED CEILING + BOX BEAMS</text><text x="42" y="68" fill="#fbbf24" font-size="14" font-family="Arial">Partial-room calibration model; not a whole-building or fabrication model</text><polygon points="${west}" fill="#0ea5e9" fill-opacity=".28" stroke="#38bdf8" stroke-width="4"/><polygon points="${east}" fill="#7c3aed" fill-opacity=".28" stroke="#a78bfa" stroke-width="4"/>${modelBeams}${modelHeads}<text x="42" y="682" fill="#94a3b8" font-size="16">Two source-pitched planes | three beam-separated bays | six plane-registered heads</text></svg>`;
  return { status: 'passed', artifactType: 'halofire.reger-flores-box-beam-visual-proof.v1', topSvg, elevationSvg, model3dSvg, counts: { heads: 6, ceilingPlanes: 2, beamPartitions: 2, protectionCells: 6 }, freshHoldoutRequired: true, complianceReady: false };
}
