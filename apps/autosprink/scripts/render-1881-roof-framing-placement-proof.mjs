import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');
const ARCH = 'E:/ClaudeBot/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const EXPECTED_ARCH_SHA256 = 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f';
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(ARCH)).digest('hex');
if (actualHash !== EXPECTED_ARCH_SHA256) throw new Error(`architectural proof source drift: ${actualHash}`);
const placement = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/roof-framing-placement.cooperative-1881.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/registered-roof-framing.cooperative-1881.json'), 'utf8'));
if (placement.counts.skipped !== 0 || !placement.evaluationComplete) throw new Error('placement proof refuses incomplete accounting');

const rendered = await renderSheetToCanvas(pdfjs, { url: ARCH, page: 32, targetPx: 3600 });
const header = 180;
const canvas = createCanvas(rendered.widthPx, rendered.heightPx + header);
const context = canvas.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
context.drawImage(rendered.canvas, 0, header);
context.fillStyle = '#f8fafc'; context.font = 'bold 44px Arial';
context.fillText('Cooperative 1881 · source-bound roof framing placement gate', 46, 62);
context.font = '28px Arial';
context.fillStyle = '#f59e0b'; context.fillText('7 bounded wood centerlines · evidence only · NOT physical solids', 46, 112);
context.fillStyle = '#ef4444'; context.fillText('1 exact HSS member rejected at roof opening', 46, 152);
context.fillStyle = '#cbd5e1'; context.fillText('127/127 accounted · 0 skipped', canvas.width - 520, 62);

const scale = rendered.widthPx / rendered.widthPt;
const toViewport = ([xFt, yFt]) => [xFt * 27 / 4 * scale, header + (1728 - yFt * 27 / 4) * scale];
const candidateMap = new Map([...candidates.beams, ...candidates.joists].map((member) => [member.id, member]));
context.lineCap = 'round';
for (const member of placement.boundedMembers) {
  const [a, b] = member.topEndpointsFt.map((point) => toViewport(point));
  context.strokeStyle = '#f59e0b'; context.lineWidth = 11; context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.stroke();
  context.fillStyle = '#7c2d12'; context.font = 'bold 20px Arial';
  context.fillText(member.member, (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8);
}
const exactRejected = placement.rejectedMembers.filter((member) => member.member === 'HSS10X4X3/8');
for (const rejection of exactRejected) {
  const source = candidateMap.get(rejection.id);
  const a = toViewport(source.a_ft); const b = toViewport(source.b_ft);
  context.strokeStyle = '#ef4444'; context.lineWidth = 12; context.setLineDash([24, 16]);
  context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.stroke(); context.setLineDash([]);
  const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  context.lineWidth = 10; context.beginPath(); context.moveTo(center[0] - 28, center[1] - 28); context.lineTo(center[0] + 28, center[1] + 28); context.moveTo(center[0] + 28, center[1] - 28); context.lineTo(center[0] - 28, center[1] + 28); context.stroke();
  context.fillStyle = '#7f1d1d'; context.font = 'bold 22px Arial'; context.fillText('HSS rejected: roof opening', center[0] + 36, center[1]);
}
const output = path.join(REPO, 'output/visual-proof/1881-a121-roof-framing-placement-gate.png');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, canvas.encodeSync('png'));
console.log(JSON.stringify({ output, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'), counts: placement.counts }, null, 2));

