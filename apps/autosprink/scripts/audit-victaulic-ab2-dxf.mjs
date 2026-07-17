import fs from 'node:fs';
import path from 'node:path';
import { auditDxfAcdsBodies, verifyDxfAcdsAudit } from './lib/dxf-acds-audit.mjs';

const source = process.argv[2];
if (!source) throw new Error('USAGE: audit-victaulic-ab2-dxf.mjs <source.dxf> [--expected-sha256 <hex>]');
const shaIndex = process.argv.indexOf('--expected-sha256');
const expectedSha256 = shaIndex >= 0 ? process.argv[shaIndex + 1] : undefined;
const audit = auditDxfAcdsBodies(fs.readFileSync(path.resolve(source)));
const verification = verifyDxfAcdsAudit(audit, {
  sourceSha256: expectedSha256,
  solidCount: 15,
  solidHandles: ['1B6', '1B7', '1B8', '1B9', '1BA', '1BB', '1BC', '1BD', '1BE', '1BF', '1C0', '1C1', '1C2', '1C3', '1C4'],
});
process.stdout.write(`${JSON.stringify({ ...audit, verification }, null, 2)}\n`);
if (!verification.ok) process.exitCode = 1;
