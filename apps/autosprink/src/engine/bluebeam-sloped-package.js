import { createHash } from 'node:crypto';
import { z } from 'zod';

const SHA256 = /^[0-9a-f]{64}$/;
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Input = z.object({
  artifactType: z.literal('halofire.bluebeam-sloped-package-input.v1'),
  packet: z.object({
    projectName: z.string(), printedScalePtPerFt: z.number().positive(), evidenceReceiptSha256: z.string().regex(SHA256),
    slopeRegions: z.array(z.object({ id: z.string(), polygonSubmittedPt: z.array(Point).min(4), protectionBasis: z.string(), submittedHeadIds: z.array(z.string()), obstructions: z.array(z.object({ centerSubmittedPt: Point, clearanceFt: z.number() }).passthrough()), elevationDatum: z.object({ sourceText: z.string(), projectElevationFt: z.number() }).passthrough().nullable() }).passthrough()),
    submittedHeads: z.array(z.object({ id: z.string(), pointPt: Point }).passthrough()), coverage: z.object({ unresolved: z.array(z.string()) }).passthrough(),
  }).passthrough(),
  layout: z.object({ status: z.literal('passed'), heads: z.array(z.object({ id: z.string(), regionId: z.string(), pointPt: Point }).passthrough()), regions: z.array(z.object({ regionId: z.string() }).passthrough()) }).passthrough(),
  parity: z.object({ status: z.literal('passed'), metrics: z.object({ precision: z.number(), recall: z.number(), maxPlanErrorFt: z.number(), meanPlanErrorFt: z.number() }) }).passthrough(),
  model3d: z.object({ status: z.literal('passed'), absoluteElevationReady: z.literal(true), heads: z.array(z.object({ id: z.string(), pointFt: z.tuple([z.number(), z.number(), z.number()]) }).passthrough()), pipes: z.array(z.object({ fromFt: z.tuple([z.number(), z.number(), z.number()]), toFt: z.tuple([z.number(), z.number(), z.number()]) }).passthrough()) }).passthrough(),
  model3dVerification: z.object({ status: z.literal('passed'), maxPlaneResidualFt: z.number(), hydraulicDatumJoined: z.literal(true), protectedRegionHeadNodeMappingReady: z.literal(false) }).passthrough(),
}).strict();

const issue = (code, message) => ({ severity: 'blocking', code, message, refs: [] });
const esc = (value) => String(value).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
const num = (value) => Number(value).toFixed(3).replace(/\.000$/, '');
const text = (x, y, size, value) => `BT /F1 ${size} Tf ${num(x)} ${num(y)} Td (${esc(value)}) Tj ET\n`;
const line = (a, b) => `${num(a[0])} ${num(a[1])} m ${num(b[0])} ${num(b[1])} l S\n`;
const circle = (x, y, radius) => { const k = radius * .5522847498; return `${num(x + radius)} ${num(y)} m ${num(x + radius)} ${num(y + k)} ${num(x + k)} ${num(y + radius)} ${num(x)} ${num(y + radius)} c ${num(x - k)} ${num(y + radius)} ${num(x - radius)} ${num(y + k)} ${num(x - radius)} ${num(y)} c ${num(x - radius)} ${num(y - k)} ${num(x - k)} ${num(y - radius)} ${num(x)} ${num(y - radius)} c ${num(x + k)} ${num(y - radius)} ${num(x + radius)} ${num(y - k)} ${num(x + radius)} ${num(y)} c S\n`; };

function pdf(objects, infoId) {
  const header = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]);
  const chunks = [header]; const offsets = [0]; let offset = header.length;
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(offset); const body = Buffer.isBuffer(objects[index]) ? objects[index] : Buffer.from(objects[index], 'ascii');
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), body, Buffer.from('\nendobj\n', 'ascii')]); chunks.push(object); offset += object.length;
  }
  const xrefOffset = offset; let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.length; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  const seed = createHash('md5').update(Buffer.concat(chunks)).digest('hex');
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R /ID [<${seed}><${seed}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'ascii')); return Buffer.concat(chunks);
}

function stream(value) {
  const bytes = Buffer.from(value, 'ascii');
  return Buffer.concat([Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`, 'ascii'), bytes, Buffer.from('\nendstream', 'ascii')]);
}

export function buildBluebeamSlopedPackage(inputValue) {
  const parsed = Input.safeParse(inputValue);
  if (!parsed.success) return { status: 'blocked', issues: [issue('BLUEBEAM_PACKAGE_INPUT_INVALID', parsed.error.message)] };
  const { packet, layout, parity, model3d, model3dVerification } = parsed.data;
  const protectedRegion = packet.slopeRegions.find((region) => region.protectionBasis === 'completed-bid-protected');
  if (!protectedRegion) return { status: 'blocked', issues: [issue('BLUEBEAM_PROTECTED_REGION_MISSING', 'A source-bound protected 3:12 region is required.')] };
  const submitted = protectedRegion.submittedHeadIds.map((id) => packet.submittedHeads.find((head) => head.id === id)).filter(Boolean);
  const box = { minX: Math.min(...protectedRegion.polygonSubmittedPt.map((p) => p[0])), maxX: Math.max(...protectedRegion.polygonSubmittedPt.map((p) => p[0])), minY: Math.min(...protectedRegion.polygonSubmittedPt.map((p) => p[1])), maxY: Math.max(...protectedRegion.polygonSubmittedPt.map((p) => p[1])) };
  const pageWidth = 2592; const pageHeight = 1728; const outputPtPerFt = 54; const factor = outputPtPerFt / packet.printedScalePtPerFt;
  const origin = [180, 1450]; const map = (point) => [origin[0] + (point[0] - box.minX) * factor, origin[1] - (point[1] - box.minY) * factor];
  let top = `1 1 1 rg 0 0 ${pageWidth} ${pageHeight} re f 0 0 0 rg 1 J 1 j\n`;
  top += text(180, 1610, 30, 'HALO FIRE - BLUEBEAM CALIBRATION DETAIL');
  top += text(180, 1568, 18, `${packet.projectName} / 3:12 SLOPED CEILING TOP PLAN`);
  top += '/OC /SRC BDC\n0.20 0.20 0.24 RG 2 w\n';
  const polygon = protectedRegion.polygonSubmittedPt.map(map); top += `${num(polygon[0][0])} ${num(polygon[0][1])} m `; for (const point of polygon.slice(1)) top += `${num(point[0])} ${num(point[1])} l `; top += 'h S\n';
  for (const head of submitted) { const point = map(head.pointPt); top += circle(point[0], point[1], 7); top += line([point[0] - 10, point[1]], [point[0] + 10, point[1]]); }
  top += 'EMC\n/OC /GEN BDC\n0 0.35 0.95 RG 3 w\n';
  for (let index = 1; index < layout.heads.length; index += 1) top += line(map(layout.heads[index - 1].pointPt), map(layout.heads[index].pointPt));
  for (const head of layout.heads) { const point = map(head.pointPt); top += circle(point[0], point[1], 9); top += line([point[0] - 12, point[1]], [point[0] + 12, point[1]]); top += line([point[0], point[1] - 12], [point[0], point[1] + 12]); }
  top += 'EMC\n/OC /EVD BDC\n0.95 0.50 0 RG 2 w\n';
  for (const obstruction of protectedRegion.obstructions) { const point = map(obstruction.centerSubmittedPt); top += circle(point[0], point[1], obstruction.clearanceFt * outputPtPerFt); top += text(point[0] + 15, point[1] + 15, 14, `CEILING FAN / ${obstruction.clearanceFt} FT CALIBRATION CLEARANCE`); }
  top += 'EMC\n0 0 0 RG 1 w\n';
  top += text(1350, 1450, 18, 'EVIDENCE / RELEASE STATUS');
  top += text(1350, 1408, 16, 'PRINTED SCALE: 3/4 IN = 1 FT (54 PDF POINTS / FT)');
  top += text(1350, 1374, 14, `PARITY: ${parity.metrics.precision * 100}% PRECISION / ${parity.metrics.recall * 100}% RECALL`);
  top += text(1350, 1342, 14, `MAX PLAN ERROR: ${parity.metrics.maxPlanErrorFt.toFixed(3)} FT`);
  top += text(1350, 1304, 12, `SEALED RECEIPT: ${packet.evidenceReceiptSha256}`);
  top += text(1350, 1268, 14, 'LAYERS: SOURCE_GEOMETRY'); top += text(1430, 1238, 14, 'GENERATED_LAYOUT'); top += text(1430, 1208, 14, 'VERIFICATION_EVIDENCE');
  top += text(1350, 1155, 14, 'CALIBRATION REFERENCE ONLY'); top += text(1350, 1122, 13, 'NOT CODE COMPLIANCE, APPROVAL,'); top += text(1350, 1092, 13, 'OR FABRICATION RELEASE');
  top += text(1350, 1038, 14, 'UNRESOLVED:'); packet.coverage.unresolved.forEach((entry, index) => { top += text(1400, 1006 - index * 31, 12, `- ${entry}`); });
  top += text(180, 100, 12, 'SHEET HF-DILLON-SLOPE-TOP / VECTOR PDF 1.7 / BLUEBEAM-READABLE OPTIONAL CONTENT GROUPS');

  const ordered = [...model3d.heads].sort((a, b) => a.pointFt[1] - b.pointFt[1]); const minY = Math.min(...ordered.map((head) => head.pointFt[1])); const minZ = Math.min(...ordered.map((head) => head.pointFt[2]));
  const elevationScale = 108; const elevOrigin = [220, 650]; const elevMap = (head) => [elevOrigin[0] + (head.pointFt[1] - minY) * elevationScale, elevOrigin[1] + (head.pointFt[2] - minZ) * elevationScale];
  let elevation = `1 1 1 rg 0 0 ${pageWidth} ${pageHeight} re f 0 0 0 rg 1 J 1 j\n`; elevation += text(180, 1610, 30, 'HALO FIRE - ABSOLUTE ELEVATION CALIBRATION'); elevation += text(180, 1568, 18, `${packet.projectName} / 3:12 SLOPED CEILING ELEVATION`);
  elevation += '/OC /SRC BDC\n0.95 0.50 0 RG 4 w\n';
  const first = elevMap(ordered[0]); const last = elevMap(ordered[ordered.length - 1]); elevation += line([first[0] - 120, first[1] + 35], [last[0] + 120, last[1] - 35]); elevation += 'EMC\n';
  elevation += '/OC /GEN BDC\n0 0.35 0.95 RG 3 w\n'; for (const pipe of model3d.pipes) elevation += line(elevMap({ pointFt: pipe.fromFt }), elevMap({ pointFt: pipe.toFt }));
  for (const head of ordered) { const point = elevMap(head); elevation += circle(point[0], point[1], 9); elevation += text(point[0] + 16, point[1] + 8, 14, `${head.id} / EL ${head.pointFt[2].toFixed(3)} FT`); } elevation += 'EMC\n';
  elevation += '/OC /EVD BDC\n0 0 0 RG 1 w\n'; elevation += text(1450, 1450, 18, 'ABSOLUTE / HYDRAULIC EVIDENCE'); elevation += text(1450, 1408, 16, `ABSOLUTE DATUM: ${protectedRegion.elevationDatum?.sourceText || 'MISSING'}`); elevation += text(1450, 1372, 14, `3D PLANE RESIDUAL: ${model3dVerification.maxPlaneResidualFt.toFixed(3)} FT`); elevation += text(1450, 1336, 14, 'HYDRAULIC DATUM:'); elevation += text(1490, 1304, 14, 'LOCAL ELEVATION + 100 FT'); elevation += text(1490, 1272, 14, '= PROJECT ELEVATION'); elevation += text(1450, 1218, 14, 'PROTECTED-HEAD HYDRAULIC NODE'); elevation += text(1490, 1186, 14, 'IDENTITY: NOT SOURCE-PROVEN'); elevation += text(1450, 1128, 13, 'NOT CODE COMPLIANCE, APPROVAL,'); elevation += text(1450, 1098, 13, 'OR FABRICATION RELEASE'); elevation += text(180, 520, 14, 'ELEVATION DISPLAY SCALE: 1-1/2 IN = 1 FT'); elevation += 'EMC\n'; elevation += text(180, 100, 12, 'SHEET HF-DILLON-SLOPE-ELEV / VECTOR PDF 1.7 / BLUEBEAM-READABLE OPTIONAL CONTENT GROUPS');

  const resources = '<< /Font << /F1 5 0 R >> /Properties << /SRC 6 0 R /GEN 7 0 R /EVD 8 0 R >> >>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R 7 0 R 8 0 R] /D << /Order [6 0 R 7 0 R 8 0 R] /ON [6 0 R 7 0 R 8 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources ${resources} /Contents 9 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources ${resources} /Contents 10 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /OCG /Name (SOURCE_GEOMETRY) >>', '<< /Type /OCG /Name (GENERATED_LAYOUT) >>', '<< /Type /OCG /Name (VERIFICATION_EVIDENCE) >>',
    stream(top), stream(elevation),
    `<< /Title (${esc(`${packet.projectName} Bluebeam Sloped Ceiling Calibration`)}) /Author (Halo Fire) /Subject (Top and absolute elevation calibration package) /Keywords (Bluebeam sprinkler pitched roof slope calibration) /Creator (HaloFire Studio) >>`,
  ];
  const buffer = pdf(objects, 11); const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { status: 'passed', buffer, manifest: { artifactType: 'halofire.bluebeam-sloped-package.v1', fileName: 'Dillon-Residence-sloped-ceiling-calibration.pdf', pageCount: 2, mediaBoxPt: [pageWidth, pageHeight], layers: ['SOURCE_GEOMETRY', 'GENERATED_LAYOUT', 'VERIFICATION_EVIDENCE'], printedScale: '3/4 in = 1 ft', elevationDisplayScale: '1-1/2 in = 1 ft', vector: true, bluebeamCompatiblePdfVersion: '1.7', sha256, evidenceReceiptSha256: packet.evidenceReceiptSha256, complianceReady: false }, issues: [] };
}
