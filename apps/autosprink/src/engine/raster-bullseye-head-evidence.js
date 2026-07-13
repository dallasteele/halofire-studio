import { sha256Hex } from './elevation-datums.js';

const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_SOURCE = '93f8df04bc84ac817ecd2e222812fede93565879094c66b4d7511f783631543e';

const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-3) => Math.abs(left - right) <= tolerance;

export async function sealRasterBullseyeHeadEvidence(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateRasterBullseyeHeadEvidence(value) {
  if (!value || value.artifactType !== 'halofire.raster-bullseye-head-evidence.v1') {
    return { status: 'blocked', issues: [issue('RASTER_HEAD_SCHEMA_INVALID', 'Raster head evidence schema is invalid.')], projectionReady: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = value;
  if (!SHA256.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('RASTER_HEAD_RECEIPT_MISMATCH', 'Raster head evidence no longer matches its sealed receipt.'));
  if (value.projectId !== 'winter-garden-meetinghouse' || value.sheetId !== 'FP3' || value.sourcePdfSha256 !== EXPECTED_SOURCE || !SHA256.test(value.renderedImageSha256 || '')) issues.push(issue('RASTER_HEAD_SOURCE_DRIFT', 'The source PDF, rendered page, project, or sheet identity changed.'));
  const expected = value.legendExpectedCount;
  const primaryCount = value.primary?.count;
  const independentCount = value.independent?.count;
  if (value.primary?.method !== 'normalized-template-correlation' || primaryCount !== expected || value.points?.length !== expected) issues.push(issue('RASTER_HEAD_PRIMARY_COUNT_MISMATCH', 'Primary points must equal the source legend count.'));
  if (value.independent?.method !== 'thresholded-contour-hierarchy' || Math.abs(independentCount - expected) > value.independent?.maximumCountDelta) issues.push(issue('RASTER_HEAD_INDEPENDENT_COUNT_MISMATCH', 'Independent contour count exceeds the permitted one-symbol reconciliation.'));
  const thresholdCounts = Object.values(value.adversarial?.thresholdCounts || {});
  if (thresholdCounts.length !== 3 || thresholdCounts.some((count) => count !== expected) || value.adversarial?.centerRemovedTemplateRejected !== true || value.adversarial?.centerRemovedTemplateCount === expected) issues.push(issue('RASTER_HEAD_ADVERSARIAL_CHECK_FAILED', 'Threshold stability or center-removal mutation rejection failed.'));
  const [imageWidth, imageHeight] = value.renderedImageSizePx || [];
  const [pageWidth, pageHeight] = value.displayPageSizePt || [];
  const ids = new Set();
  for (const point of value.points || []) {
    const [nx, ny] = point.normalized || [];
    const [px, py] = point.displayPdfPtTopLeft || [];
    if (!point.id || ids.has(point.id) || !Number.isFinite(nx) || !Number.isFinite(ny) || nx <= 0 || nx >= 1 || ny <= 0 || ny >= 1 || !near(px, nx * pageWidth) || !near(py, ny * pageHeight) || point.score < .58) {
      issues.push(issue('RASTER_HEAD_POINT_INVALID', `Point ${point.id || 'unknown'} is duplicated, out of bounds, or not mapped to display PDF coordinates.`));
      break;
    }
    ids.add(point.id);
  }
  if (imageWidth !== 5400 || imageHeight !== 3601 || pageWidth !== 2592 || pageHeight !== 1728) issues.push(issue('RASTER_HEAD_COORDINATE_SPACE_DRIFT', 'Rendered or display-page dimensions changed.'));
  if (value.projectionReady !== false || value.complianceReady !== false || value.status !== 'passed') issues.push(issue('RASTER_HEAD_FAIL_CLOSED_STATUS_DRIFT', 'Calibration points must remain non-projecting and non-compliance-ready.'));
  return {
    status: issues.length ? 'blocked' : 'passed', issues,
    metrics: { expectedCount: expected, primaryCount, independentCount, reconciliationDelta: Math.abs(primaryCount - independentCount), minimumScore: Math.min(...(value.points || []).map((point) => point.score)) },
    points: issues.length ? [] : value.points,
    projectionReady: false, complianceReady: false,
  };
}
