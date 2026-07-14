import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SHA = /^[0-9a-f]{64}$/;
const EXPECTED = Object.freeze({
  A151: '4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43',
  A301: '719ae05138b3872c2ed8740fa4470ca457dcc0a9f8fec617cabf7969560ecc30',
  A303: 'dae14221cd3b913d350e53d146c6dd1abfca8a3b6d3ca142916474ba18a66de7',
});
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const near = (left, right, tolerance = 1e-5) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

function clipHalfPlane(polygon, boundaryY, keepAbove) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const inside = (point) => keepAbove ? point[1] >= boundaryY - 1e-8 : point[1] <= boundaryY + 1e-8;
  const intersect = (left, right) => {
    const ratio = (boundaryY - left[1]) / (right[1] - left[1]);
    return [left[0] + (right[0] - left[0]) * ratio, boundaryY];
  };
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = inside(current); const previousInside = inside(previous);
    if (currentInside && !previousInside) result.push(intersect(previous, current));
    if (currentInside) result.push(current);
    if (!currentInside && previousInside) result.push(intersect(previous, current));
  }
  return result;
}

function clipBand(polygon, minY, maxY) {
  return clipHalfPlane(clipHalfPlane(polygon, minY, true), maxY, false);
}

function polygonArea(polygon) {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

export function sourceSlopedCeilingElevationFt(profile, finish, yFt) {
  const high = Number(finish?.highElevationFt);
  if (!Number.isFinite(high) || !Number.isFinite(yFt)) return null;
  const { southLowYFt, plateauSouthYFt, plateauNorthYFt, northLowYFt, pitchRiseIn, pitchRunIn } = profile || {};
  if (yFt < southLowYFt - 1e-6 || yFt > northLowYFt + 1e-6) return null;
  const slope = pitchRiseIn / pitchRunIn;
  if (yFt < plateauSouthYFt) return round(high - (plateauSouthYFt - yFt) * slope);
  if (yFt > plateauNorthYFt) return round(high - (yFt - plateauNorthYFt) * slope);
  return round(high);
}

export function buildWinterGardenSourceSlopedCeiling({ section, ridgeYFt, registry, bottomOfTrussElevationFt = 119.5 }) {
  const scale = Number(section.printedScalePtPerFt);
  const vectors = [section.leftVector, section.rightVector].map((vector) => ({
    high: vector[0][1] <= vector[1][1] ? vector[0] : vector[1],
    low: vector[0][1] > vector[1][1] ? vector[0] : vector[1],
  })).sort((left, right) => left.low[0] - right.low[0]);
  const left = vectors[0]; const right = vectors[1];
  const slopeRunFt = ((left.high[0] - left.low[0]) + (right.low[0] - right.high[0])) / (2 * scale);
  const slopeRiseFt = ((left.low[1] - left.high[1]) + (right.low[1] - right.high[1])) / (2 * scale);
  const plateauWidthFt = (right.high[0] - left.high[0]) / scale;
  const pitchRiseIn = slopeRiseFt / slopeRunFt * 12;
  const plateauHalfWidthFt = plateauWidthFt / 2;
  const profile = {
    axis: 'plan-y',
    ridgeCenterYFt: round(ridgeYFt),
    plateauSouthYFt: round(ridgeYFt - plateauHalfWidthFt),
    plateauNorthYFt: round(ridgeYFt + plateauHalfWidthFt),
    southLowYFt: round(ridgeYFt - plateauHalfWidthFt - slopeRunFt),
    northLowYFt: round(ridgeYFt + plateauHalfWidthFt + slopeRunFt),
    plateauWidthFt: round(plateauWidthFt),
    slopeRunFt: round(slopeRunFt),
    slopeRiseFt: round(slopeRiseFt),
    pitchRiseIn: round(pitchRiseIn),
    pitchRunIn: 12,
    longitudinalGradientFtPerFt: 0,
  };
  const finishByRoom = new Map([['148', 'C4'], ['149', 'C3'], ['150', 'C3']]);
  const finishes = ['C3', 'C4'].map((finishType) => {
    const controls = registry.spaces.flatMap((space) => (space.ceilingControls || []).map((control) => ({ ...control, roomNumber: space.roomNumber })))
      .filter((control) => control.ceilingType === finishType && Number(control.heightFt) > 15);
    const distinct = [...new Set(controls.map((control) => round(control.heightFt)))];
    const heightAboveFloorFt = distinct.length === 1 ? distinct[0] : null;
    return {
      finishType,
      sourceControlIds: controls.map((control) => control.controlId).sort(),
      heightAboveFloorFt,
      highElevationFt: round(100 + heightAboveFloorFt),
      lowElevationFt: round(100 + heightAboveFloorFt - slopeRiseFt),
      trussClearanceIn: round((bottomOfTrussElevationFt - (100 + heightAboveFloorFt)) * 12, 4),
    };
  });
  const finishMap = new Map(finishes.map((finish) => [finish.finishType, finish]));
  const bands = [
    { id: 'south-slope', minY: profile.southLowYFt, maxY: profile.plateauSouthYFt },
    { id: 'ridge-flat', minY: profile.plateauSouthYFt, maxY: profile.plateauNorthYFt },
    { id: 'north-slope', minY: profile.plateauNorthYFt, maxY: profile.northLowYFt },
  ];
  const surfaces = [];
  for (const roomNumber of ['148', '149', '150']) {
    const room = registry.spaces.find((entry) => entry.roomNumber === roomNumber);
    const finish = finishMap.get(finishByRoom.get(roomNumber));
    if (!room?.geometry?.polygon || !finish) continue;
    for (const band of bands) {
      const polygon = clipBand(room.geometry.polygon, band.minY, band.maxY);
      if (polygon.length < 3 || polygonArea(polygon) < 0.01) continue;
      surfaces.push({
        surfaceId: `wg-${roomNumber}-${band.id}`,
        roomNumber,
        roomName: room.roomName,
        finishType: finish.finishType,
        profileBand: band.id,
        boundaryCompleteness: room.geometry.boundaryCompleteness,
        planPolygonFt: polygon.map((point) => point.map((value) => round(value))),
        verticesFt: polygon.map(([x, y]) => [round(x), round(y), sourceSlopedCeilingElevationFt(profile, finish, y)]),
        planAreaSqft: round(polygonArea(polygon), 4),
        status: 'source-only-ceiling-surface-envelope',
      });
    }
  }
  return { profile, finishes, surfaces };
}

export async function sealWinterGardenSourceSlopedCeiling(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourceSlopedCeiling(value, { registry, building } = {}) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-sloped-ceiling.v1' || value.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WG_SOURCE_SLOPED_CEILING_SCHEMA_INVALID', 'Source-only sloped ceiling identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_SLOPED_CEILING_RECEIPT_MISMATCH', 'Source-only sloped ceiling no longer matches its immutable receipt.'));
  if (value.sources?.A151?.sha256 !== EXPECTED.A151 || value.sources?.A301?.sha256 !== EXPECTED.A301 || value.sources?.A303?.sha256 !== EXPECTED.A303) issues.push(issue('WG_SOURCE_SLOPED_CEILING_SOURCE_DRIFT', 'A151, A301, or A303 source identity changed.'));
  if (!SHA.test(registry?.receiptSha256 || '') || value.sourceReceipts?.registry !== registry.receiptSha256 || !SHA.test(building?.receiptSha256 || '') || value.sourceReceipts?.building !== building.receiptSha256) issues.push(issue('WG_SOURCE_SLOPED_CEILING_UPSTREAM_DRIFT', 'Current sealed registry and building receipts are required.'));
  const operational = validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge);
  if (operational.status !== 'passed') issues.push(issue('WG_SOURCE_SLOPED_CEILING_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed Halo Fire operations receipt must govern ceiling reconstruction.'));
  const expected = registry && building ? buildWinterGardenSourceSlopedCeiling({
    section: value.sectionEvidence,
    ridgeYFt: building.model?.mainRoof?.ridgeYFt,
    registry,
    bottomOfTrussElevationFt: value.longitudinalEvidence?.bottomOfTrussElevationFt,
  }) : null;
  if (expected && (JSON.stringify(value.profile) !== JSON.stringify(expected.profile) || JSON.stringify(value.finishes) !== JSON.stringify(expected.finishes) || JSON.stringify(value.surfaces) !== JSON.stringify(expected.surfaces))) issues.push(issue('WG_SOURCE_SLOPED_CEILING_REPLAY_FAILED', 'Ceiling profile and room surfaces do not replay from sealed source evidence.'));
  const p = value.profile || {};
  if (!near(value.sectionEvidence?.printedScalePtPerFt, 18) || !near(p.pitchRiseIn, 3, 0.002) || !near(p.pitchRunIn, 12)
    || !near(p.plateauWidthFt, 10.406667, 0.002) || !near(p.slopeRunFt, 15.23, 0.002) || !near(p.slopeRiseFt, 3.806667, 0.002)
    || !near(p.ridgeCenterYFt, building?.model?.mainRoof?.ridgeYFt, 1e-5) || p.longitudinalGradientFtPerFt !== 0) issues.push(issue('WG_SOURCE_SLOPED_CEILING_PROFILE_DRIFT', 'A301 3:12 vectors, flat ridge strip, A303 longitudinal axis, or plan ridge registration drifted.'));
  const finishes = new Map((value.finishes || []).map((finish) => [finish.finishType, finish]));
  if (!near(finishes.get('C4')?.highElevationFt, 119.447917) || !near(finishes.get('C4')?.trussClearanceIn, 0.625, 0.001)
    || !near(finishes.get('C3')?.highElevationFt, 119.385417) || !near(finishes.get('C3')?.trussClearanceIn, 1.375, 0.001)) issues.push(issue('WG_SOURCE_SLOPED_CEILING_DATUM_DRIFT', 'A151 C3/C4 finish heights no longer reconcile with the A303 119-foot-6-inch truss datum.'));
  if (value.sectionEvidence?.roofPitchRiseIn !== 4.5 || value.sectionEvidence?.ceilingPitchDerivedFromRoof !== false || value.generation?.answerKeyUsed !== false || value.generation?.completedBidUsedForGeneration !== false) issues.push(issue('WG_SOURCE_SLOPED_CEILING_ROOF_OR_ANSWER_KEY_LEAKAGE', 'The 4.5:12 roof and completed sprinkler answer key must not substitute for the independently extracted 3:12 ceiling.'));
  if ((value.surfaces || []).length !== 6 || [...new Set(value.surfaces.map((surface) => surface.roomNumber))].join(',') !== '148,149,150') issues.push(issue('WG_SOURCE_SLOPED_CEILING_SURFACE_TALLY_DRIFT', 'Exactly six clipped source surface envelopes across rooms 148, 149, and 150 are expected.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length < 8) issues.push(issue('WG_SOURCE_SLOPED_CEILING_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial source loops must all pass.'));
  if (value.ceilingSurfaceEnvelopeReady !== true || value.roomBoundaryComplete !== false || value.pitchedSprinklerLayoutReady !== false || value.hydraulicCalculationReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_SOURCE_SLOPED_CEILING_FAIL_CLOSED_STATUS_DRIFT', 'Only the source ceiling surface envelope may be ready.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : value, ceilingSurfaceEnvelopeReady: !issues.length, pitchedSprinklerLayoutReady: false, complianceReady: false };
}
