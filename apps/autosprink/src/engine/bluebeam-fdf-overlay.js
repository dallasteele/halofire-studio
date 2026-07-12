import { createHash } from 'node:crypto';
import { z } from 'zod';

const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Input = z.object({
  artifactType: z.literal('halofire.bluebeam-fdf-overlay-input.v1'),
  sourceFileName: z.string().min(1),
  packet: z.object({ evidenceReceiptSha256: z.string(), slopeRegions: z.array(z.object({ id: z.string(), polygonSubmittedPt: z.array(Point).min(4), obstructions: z.array(z.object({ id: z.string(), centerSubmittedPt: Point, clearanceFt: z.number() }).passthrough()) }).passthrough()) }).passthrough(),
  layout: z.object({ status: z.literal('passed'), heads: z.array(z.object({ id: z.string(), pointPt: Point }).passthrough()) }).passthrough(),
  parity: z.object({ status: z.literal('passed'), metrics: z.object({ precision: z.number(), recall: z.number(), maxPlanErrorFt: z.number() }) }).passthrough(),
}).strict();

const issue = (code, message) => ({ severity: 'blocking', code, message, refs: [] });
const esc = (value) => String(value).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
const n = (value) => Number(value).toFixed(3).replace(/\.000$/, '');
// Calibration coordinates are the FP-1 page rotated 90 degrees counter-clockwise
// into landscape, while FDF annotations target the original unrotated 2160 x 3024
// PDF page and use a bottom-left origin.
export const submittedLandscapeToOriginalPdf = ([xLandscape, yLandscape]) => [2160 - yLandscape, 3024 - xLandscape];

export function buildBluebeamFdfOverlay(inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success) return { status: 'blocked', issues: [issue('BLUEBEAM_FDF_INPUT_INVALID', parsed.error.message)] };
  const { sourceFileName, packet, layout, parity } = parsed.data; const annotations = [];
  const add = (body) => annotations.push(body);
  for (const region of packet.slopeRegions) {
    const vertices = region.polygonSubmittedPt.flatMap((point) => submittedLandscapeToOriginalPdf(point)).map(n).join(' ');
    add(`<< /Type /Annot /Subtype /PolyLine /Page 0 /Vertices [${vertices}] /C [0.95 0.50 0] /CA 0.8 /BS << /W 2 >> /T (HaloFire Generator) /Subj (3:12 source-bound region) /Contents (${esc(region.id)}) /NM (${esc(`hf-region-${region.id}`)}) /F 4 >>`);
    for (const obstruction of region.obstructions) {
      const center = submittedLandscapeToOriginalPdf(obstruction.centerSubmittedPt); const radius = obstruction.clearanceFt * 13.5;
      add(`<< /Type /Annot /Subtype /Circle /Page 0 /Rect [${n(center[0] - radius)} ${n(center[1] - radius)} ${n(center[0] + radius)} ${n(center[1] + radius)}] /C [0.95 0.50 0] /CA 0.65 /BS << /W 2 >> /T (HaloFire Generator) /Subj (Ceiling fan calibration clearance) /Contents (${esc(`${obstruction.id} / ${obstruction.clearanceFt} ft clearance`)}) /NM (${esc(`hf-obstruction-${obstruction.id}`)}) /F 4 >>`);
    }
  }
  for (const head of layout.heads) {
    const point = submittedLandscapeToOriginalPdf(head.pointPt); const radius = 8;
    add(`<< /Type /Annot /Subtype /Circle /Page 0 /Rect [${n(point[0] - radius)} ${n(point[1] - radius)} ${n(point[0] + radius)} ${n(point[1] + radius)}] /C [0 0.35 0.95] /IC [0.70 0.85 1] /CA 1 /BS << /W 2 >> /T (HaloFire Generator) /Subj (Generated sprinkler head) /Contents (${esc(`${head.id} / calibration candidate`)}) /NM (${esc(`hf-head-${head.id}`)}) /F 4 >>`);
  }
  if (layout.heads.length > 1) {
    for (let index = 1; index < layout.heads.length; index += 1) {
      const start = submittedLandscapeToOriginalPdf(layout.heads[index - 1].pointPt); const end = submittedLandscapeToOriginalPdf(layout.heads[index].pointPt);
      add(`<< /Type /Annot /Subtype /Line /Page 0 /L [${n(start[0])} ${n(start[1])} ${n(end[0])} ${n(end[1])}] /C [0 0.35 0.95] /CA 1 /BS << /W 3 >> /LE [/None /None] /T (HaloFire Generator) /Subj (Generated slope-following branch) /Contents (Generated calibration branch centerline) /NM (hf-generated-branch-${index}) /F 4 >>`);
    }
  }
  const note = `Calibration only. Precision ${(parity.metrics.precision * 100).toFixed(0)}%, recall ${(parity.metrics.recall * 100).toFixed(0)}%, max plan error ${parity.metrics.maxPlanErrorFt.toFixed(3)} ft. Receipt ${packet.evidenceReceiptSha256}. Not code compliance, approval, or fabrication release.`;
  add(`<< /Type /Annot /Subtype /FreeText /Page 0 /Rect [80 80 930 180] /C [0.12 0.16 0.22] /DA (/Helvetica 10 Tf 0 0 0 rg) /T (HaloFire Generator) /Subj (Verification evidence) /Contents (${esc(note)}) /NM (hf-verification-note) /F 4 >>`);
  const firstAnnotationId = 2; const references = annotations.map((_, index) => `${firstAnnotationId + index} 0 R`).join(' ');
  const objects = [`1 0 obj\n<< /FDF << /F (${esc(sourceFileName)}) /Annots [${references}] >> >>\nendobj\n`];
  annotations.forEach((annotation, index) => objects.push(`${firstAnnotationId + index} 0 obj\n${annotation}\nendobj\n`));
  const body = `%FDF-1.2\n% HaloFire deterministic Bluebeam overlay\n${objects.join('')}trailer\n<< /Root 1 0 R /Size ${annotations.length + 2} >>\n%%EOF\n`;
  const buffer = Buffer.from(body, 'ascii'); const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { status: 'passed', buffer, manifest: { artifactType: 'halofire.bluebeam-fdf-overlay.v1', fileName: 'Dillon-Residence-FP1-generated-slope-overlay.fdf', sourceFileName, pageIndex: 0, annotationCount: annotations.length, regionCount: packet.slopeRegions.length, generatedHeadCount: layout.heads.length, generatedPipeCount: Math.max(0, layout.heads.length - 1), sha256, evidenceReceiptSha256: packet.evidenceReceiptSha256, importPath: 'Bluebeam Revu > Markups List > Markups > Import', complianceReady: false }, issues: [] };
}
