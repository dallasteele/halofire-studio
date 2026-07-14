import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMitRiversideBuildingJCrossDrawingGridAudit, renderMitRiversideBuildingJCrossDrawingGridAudit, sealMitRiversideBuildingJCrossDrawingGridAuditEvidence, validateMitRiversideBuildingJCrossDrawingGridAudit, validateMitRiversideBuildingJCrossDrawingGridAuditEvidence, verifyMitRiversideBuildingJCrossDrawingGridAuditAdversarialLoop } from '../src/engine/mit-riverside-building-j-cross-drawing-grid-audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = (name) => path.join(root, 'src', 'data', name);
const evidence = await sealMitRiversideBuildingJCrossDrawingGridAuditEvidence(JSON.parse(fs.readFileSync(dataPath('mit-riverside-building-j-cross-drawing-grid-audit-evidence.json'), 'utf8')));
const audit = await buildMitRiversideBuildingJCrossDrawingGridAudit(evidence);
const evidenceValidation = await validateMitRiversideBuildingJCrossDrawingGridAuditEvidence(evidence);
const auditValidation = await validateMitRiversideBuildingJCrossDrawingGridAudit(audit, evidence);
const adversarial = await verifyMitRiversideBuildingJCrossDrawingGridAuditAdversarialLoop(audit, evidence);
if ([evidenceValidation.status, auditValidation.status, adversarial.status].some((status) => status !== 'passed')) throw new Error(JSON.stringify({ evidenceValidation, auditValidation, adversarial }, null, 2));
fs.writeFileSync(dataPath('mit-riverside-building-j-cross-drawing-grid-audit-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(dataPath('mit-riverside-building-j-cross-drawing-grid-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
const out = path.join(root, 'out', 'visual-proof', 'mit-riverside-building-j-cross-drawing-grid-audit.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, renderMitRiversideBuildingJCrossDrawingGridAudit(audit));
console.log(JSON.stringify({ evidenceValidation, auditValidation, adversarial, evidenceReceiptSha256: evidence.receiptSha256, auditReceiptSha256: audit.receiptSha256, out }, null, 2));
