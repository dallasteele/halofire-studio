import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sealElevationDatumPacket } from '../src/engine/elevation-datums.js';

const EXPECTED_PDF_SHA256 = '179a572ea380be805131aabdeb7c3a3a041f9c2f5aaf55d2fcde673289ab6d53';
const sourcePdf = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF || 'plans/cooperative-1881/1881-updated-architectural.pdf');
const outputPath = path.resolve(process.env.COOPERATIVE_1881_ELEVATION_OUTPUT || 'src/data/elevation-datums.cooperative-1881.json');
const sourcePdfSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourcePdf)).digest('hex');
if (sourcePdfSha256 !== EXPECTED_PDF_SHA256) throw new Error(`architectural source PDF hash mismatch: ${sourcePdfSha256}`);
const sourceBinding = {
  sourcePdfSha256, physicalPageNumber: 61, pageIndex: 60,
  renderedPageSha256: 'ea47dd4c5f6d38be5cf1b53172048cb9ac57ed24877ff4b063d38028cdc3b888',
  sheetId: 'A-201', coordinateSpace: 'pdf-points',
  renderProfile: { renderer: 'PyMuPDF', rendererVersion: '1.27.2.2', matrixScale: 2.5, colorspace: 'rgb', alpha: false },
};
const rows = [
  ['floor-1', 'floor', 'FIRST FLOOR', '+0\'-0"'], ['floor-2', 'floor', 'SECOND FLOOR', '+10\'-0"'],
  ['floor-3', 'floor', 'THIRD FLOOR', '+20\'-0"'], ['floor-4', 'floor', 'FOURTH FLOOR', '+31\'-0"'],
  ['floor-5', 'floor', 'FIFTH FLOOR', '+41\'-0"'], ['floor-6', 'floor', 'SIXTH FLOOR', '+51\'-0"'],
  ['floor-7', 'floor', 'SEVENTH FLOOR', '+61\'-0"'], ['floor-8', 'floor', 'EIGHTH FLOOR', '+71\'-0"'],
  ['roof-eave', 'eave', 'ROOF EAVE', '+81\'-0"'], ['roof-ridge', 'ridge', 'T.O. ROOF RIDGE', '+89\'-6 3/4"'],
];
const sealed = await sealElevationDatumPacket({
  artifactType: 'halofire.elevation-datum-packet.v1', sourceDocumentId: 'cooperative-1881-updated-architectural',
  sourceBinding, observations: rows.map(([id, kind, label, elevationText]) => ({ id, kind, label, elevationText, sourceBinding })),
});
fs.writeFileSync(outputPath, `${JSON.stringify(sealed, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, receiptSha256: sealed.receiptSha256, sourceBinding, observationCount: sealed.observations.length }, null, 2));
