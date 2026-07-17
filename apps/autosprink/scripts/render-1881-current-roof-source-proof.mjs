import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');
const OUT = path.join(REPO, 'output/visual-proof');
const ARCH = 'E:/ClaudeBot/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const MECHANICAL = 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Mechanical.pdf';
const PLUMBING = 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Plumbing.pdf';
const EXPECTED = {
  architectural: 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f',
  mechanical: 'f2aa3329951b29ea7829fa56ff30866c0f3fa7e46ecd7f8c0377556da1e4a3d7',
  plumbing: 'eb9cfb0410f1b022b7b445c24e241c54ca9ffa858c914e5a471cd46323ee89c2',
};
const sha = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
if (sha(ARCH) !== EXPECTED.architectural || sha(MECHANICAL) !== EXPECTED.mechanical || sha(PLUMBING) !== EXPECTED.plumbing) {
  throw new Error('Cooperative 1881 proof source drift');
}
fs.mkdirSync(OUT, { recursive: true });
const roof = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/roof-reconstruction.cooperative-1881.json'), 'utf8'));
const coordination = JSON.parse(fs.readFileSync(path.join(APP, 'src/data/roof-coordination.cooperative-1881.json'), 'utf8'));

const roofPage = await renderSheetToCanvas(pdfjs, { url: ARCH, page: 32, targetPx: 3600 });
const header = 0; const roofCanvas = createCanvas(roofPage.widthPx, roofPage.heightPx); const roofContext = roofCanvas.getContext('2d');
roofContext.fillStyle = '#fff'; roofContext.fillRect(0, 0, roofCanvas.width, roofCanvas.height); roofContext.drawImage(roofPage.canvas, 0, 0);
const scale = roofPage.widthPx / roofPage.widthPt;
const toPdf = (point) => [point[0] * 27 / 4, 1728 - point[1] * 27 / 4];
const colors = ['#ff2db2', '#00d4ff'];
roofContext.globalAlpha = 0.24;
roof.regions.forEach((region, index) => {
  roofContext.fillStyle = colors[index % colors.length]; roofContext.beginPath();
  region.boundaryPlanFt.map(toPdf).forEach((point, pointIndex) => {
    const viewportPoint = [point[0] * scale, header + point[1] * scale];
    if (pointIndex) roofContext.lineTo(...viewportPoint); else roofContext.moveTo(...viewportPoint);
  });
  roofContext.closePath(); roofContext.fill();
});
roofContext.globalAlpha = 1; roofContext.lineWidth = 5;
roof.regions.forEach((region, index) => {
  roofContext.strokeStyle = colors[index % colors.length]; roofContext.beginPath();
  region.boundaryPlanFt.map(toPdf).forEach((point, pointIndex) => {
    const viewportPoint = [point[0] * scale, header + point[1] * scale];
    if (pointIndex) roofContext.lineTo(...viewportPoint); else roofContext.moveTo(...viewportPoint);
  });
  roofContext.closePath(); roofContext.stroke();
});
for (const feature of roof.features) {
  roofContext.fillStyle = feature.type === 'roof-hatch' ? '#00e676' : feature.type.includes('overflow') ? '#ff9100' : '#ff1744';
  if (feature.geometry.kind === 'point') {
    const point = toPdf(feature.geometry.planPointFt); roofContext.beginPath();
    roofContext.arc(point[0] * scale, header + point[1] * scale, 12, 0, Math.PI * 2); roofContext.fill();
  } else {
    roofContext.beginPath(); feature.geometry.boundaryPlanFt.map(toPdf).forEach((point, index) => {
      const viewportPoint = [point[0] * scale, header + point[1] * scale];
      if (index) roofContext.lineTo(...viewportPoint); else roofContext.moveTo(...viewportPoint);
    }); roofContext.closePath(); roofContext.fill();
  }
}
const roofOutput = path.join(OUT, '1881-current-a121-roof-registration.png');
fs.writeFileSync(roofOutput, roofCanvas.encodeSync('png'));

const panels = [
  { sheet: 'M109', url: MECHANICAL, page: 13, items: coordination.equipment },
  { sheet: 'P109', url: PLUMBING, page: 10, items: coordination.vents },
];
const panelWidth = 2400; const panelHeight = 1600; const mepCanvas = createCanvas(panelWidth * 2, panelHeight); const mepContext = mepCanvas.getContext('2d');
mepContext.fillStyle = '#fff'; mepContext.fillRect(0, 0, mepCanvas.width, mepCanvas.height);
for (let index = 0; index < panels.length; index += 1) {
  const panel = panels[index]; const rendered = await renderSheetToCanvas(pdfjs, { url: panel.url, page: panel.page, targetPx: panelWidth });
  mepContext.drawImage(rendered.canvas, index * panelWidth, 0, panelWidth, panelHeight);
  const panelScale = panelWidth / rendered.widthPt;
  if (panel.sheet === 'M109') {
    mepContext.strokeStyle = '#ff2db2'; mepContext.lineWidth = 2;
    for (const item of panel.items) { const rect = item.sourceRectPdf; mepContext.strokeRect(index * panelWidth + rect[0] * panelScale, rect[1] * panelScale, (rect[2] - rect[0]) * panelScale, (rect[3] - rect[1]) * panelScale); }
  } else {
    mepContext.fillStyle = '#00e5ff';
    for (const item of panel.items) { const point = item.sourcePointPdf; mepContext.beginPath(); mepContext.arc(index * panelWidth + point[0] * panelScale, point[1] * panelScale, 5, 0, Math.PI * 2); mepContext.fill(); }
  }
}
const mepOutput = path.join(OUT, '1881-current-mep-registration.png');
fs.writeFileSync(mepOutput, mepCanvas.encodeSync('png'));
console.log(JSON.stringify({ roofOutput, mepOutput, counts: { planes: roof.regions.length, features: roof.features.length, equipment: coordination.equipment.length, vents: coordination.vents.length } }, null, 2));
