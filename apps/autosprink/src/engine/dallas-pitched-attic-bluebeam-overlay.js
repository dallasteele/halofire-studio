import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const esc = (value) => String(value).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
const num = (value) => Number(value).toFixed(3).replace(/\.000$/, '');

/** Converts the packet's top-left PDF coordinates to FDF bottom-left coordinates. */
export function dallasPlanPointToFdf([x, y], pageHeightPt = 2160) {
  return [x, pageHeightPt - y];
}

/**
 * Creates a deterministic Bluebeam-importable markup layer for the sealed
 * Dallas FP-1.4 Remote Area 5 registration. The FDF never promotes the
 * completed-reference subset into a generated compliance or fabrication claim.
 */
export function buildDallasPitchedAtticBluebeamOverlay(packet, sourceFileName = 'Halo Stamped_As-Built Set.pdf') {
  const invalid = packet?.artifactType !== 'halofire.dallas-pitched-attic-hydraulic-registration.v1'
    || packet?.plan?.sheetId !== 'FP-1.4'
    || packet?.plan?.physicalPageNumber !== 5
    || !Array.isArray(packet?.plan?.pageSizePt)
    || packet.plan.pageSizePt.length !== 2
    || !Array.isArray(packet?.heads)
    || packet.heads.length !== 9
    || !Array.isArray(packet?.mappedBranchPipes)
    || packet.mappedBranchPipes.length !== 8
    || !SHA256.test(packet?.receiptSha256 || '')
    || packet?.complianceReady !== false
    || packet?.generatedDesignComplianceReady !== false;
  if (invalid) return { status: 'blocked', issues: [issue('DALLAS_BLUEBEAM_INPUT_INVALID', 'Sealed FP-1.4 A1-A9 registration with fail-closed claims is required.')] };

  const [pageWidthPt, pageHeightPt] = packet.plan.pageSizePt;
  const points = new Map(packet.heads.map((head) => [head.nodeId, head.planPointPt]));
  for (const junction of packet.junctions || []) points.set(junction.nodeId, junction.planPointPt);
  const annotations = [];
  const add = (body) => annotations.push(body);
  for (const pipe of packet.mappedBranchPipes) {
    const from = points.get(pipe.fromNodeId); const to = points.get(pipe.toNodeId);
    if (!from || !to) return { status: 'blocked', issues: [issue('DALLAS_BLUEBEAM_PIPE_ENDPOINT_MISSING', `Pipe ${pipe.id} has an unregistered endpoint.`)] };
    const a = dallasPlanPointToFdf(from, pageHeightPt); const b = dallasPlanPointToFdf(to, pageHeightPt);
    add(`<< /Type /Annot /Subtype /Line /Page 4 /L [${num(a[0])} ${num(a[1])} ${num(b[0])} ${num(b[1])}] /C [0.62 0.32 0.95] /CA 1 /BS << /W 4 >> /LE [/None /None] /T (HaloFire Registration) /Subj (Registered 2 inch pitched-attic branch) /Contents (${esc(`${pipe.fromNodeId}-${pipe.toNodeId} / ${pipe.planLengthFt} ft / 2 in nominal / 2.157 in ID`)}) /NM (${esc(`hf-dallas-pipe-${pipe.id}`)}) /F 4 >>`);
  }
  for (const head of packet.heads) {
    const point = dallasPlanPointToFdf(head.planPointPt, pageHeightPt); const radius = 9;
    add(`<< /Type /Annot /Subtype /Circle /Page 4 /Rect [${num(point[0] - radius)} ${num(point[1] - radius)} ${num(point[0] + radius)} ${num(point[1] + radius)}] /C [0 0.65 0.85] /IC [0.55 0.95 1] /CA 1 /BS << /W 3 >> /T (HaloFire Registration) /Subj (Registered operating sprinkler) /Contents (${esc(`${head.nodeId} / ${head.headFamily} / EL ${head.elevationFt} ft / K${head.kFactor}`)}) /NM (${esc(`hf-dallas-head-${head.nodeId}`)}) /F 4 >>`);
  }
  const note = `Completed-project calibration subset: FP-1.4 Remote Area 5, A1-A9, 4:12 roof, 1/8 in = 1 ft. ${packet.hydraulicSystem.totalDemandGpm} gpm at ${packet.hydraulicSystem.requiredPressurePsi} psi. Receipt ${packet.receiptSha256}. Not a generated whole-building layout, compliance approval, or fabrication release.`;
  add(`<< /Type /Annot /Subtype /FreeText /Page 4 /Rect [1080 390 2450 535] /C [0.08 0.12 0.18] /DA (/Helvetica 12 Tf 0 0 0 rg) /T (HaloFire Registration) /Subj (Sealed calibration evidence) /Contents (${esc(note)}) /NM (hf-dallas-verification-note) /F 4 >>`);

  const firstId = 2; const refs = annotations.map((_, index) => `${firstId + index} 0 R`).join(' ');
  const objects = [`1 0 obj\n<< /FDF << /F (${esc(sourceFileName)}) /Annots [${refs}] >> >>\nendobj\n`];
  annotations.forEach((annotation, index) => objects.push(`${firstId + index} 0 obj\n${annotation}\nendobj\n`));
  const body = `%FDF-1.2\n% HaloFire deterministic Dallas FP-1.4 Bluebeam overlay\n${objects.join('')}trailer\n<< /Root 1 0 R /Size ${annotations.length + 2} >>\n%%EOF\n`;
  const buffer = Buffer.from(body, 'ascii'); const sha256 = createHash('sha256').update(buffer).digest('hex');
  return {
    status: 'passed', buffer, issues: [],
    manifest: {
      artifactType: 'halofire.dallas-pitched-attic-bluebeam-overlay.v1',
      fileName: 'Dallas-FP-1.4-Remote-Area-5-registered-overlay.fdf', sourceFileName,
      sheetId: packet.plan.sheetId, pageIndex: 4, pageSizePt: [pageWidthPt, pageHeightPt],
      annotationCount: annotations.length, registeredHeadCount: packet.heads.length,
      registeredPipeCount: packet.mappedBranchPipes.length, sha256,
      evidenceReceiptSha256: packet.receiptSha256,
      importPath: 'Bluebeam Revu > Markups List > Markups > Import',
      wholeBuildingLayoutReady: false, fabricationReady: false, complianceReady: false,
    },
  };
}
