import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildModelFromPlan } from '../src/engine/plan-pipeline.js';

function escapePdfText(text) {
  return String(text).replace(/([()\\])/g, '\\$1');
}

function createSyntheticPlanPdf(pdfPath) {
  const commands = [];
  const line = (x1, y1, x2, y2, width = 3) => commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (x, y, value, size = 10) => commands.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
  const quarterArc = (cx, cy, radius) => {
    const kappa = 0.5522847498;
    const x0 = cx + radius;
    const y0 = cy;
    const x1 = cx + radius;
    const y1 = cy + kappa * radius;
    const x2 = cx + kappa * radius;
    const y2 = cy + radius;
    const x3 = cx;
    const y3 = cy + radius;
    commands.push(`1.5 w ${x0} ${y0} m ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} c S`);
  };

  text(72, 756, 'SCALE: 1/8" = 1\'-0"', 12);
  line(72, 500, 432, 500);
  line(432, 500, 432, 680);
  line(432, 680, 72, 680);
  line(72, 680, 72, 500);
  [132, 192, 252, 312, 372].forEach((x) => line(x, 500, x, 680));
  [545, 590, 635].forEach((y) => line(72, y, 432, y));
  [102, 162, 222, 282, 342, 402].forEach((x) => line(x, 500, x, 590));
  [102, 162, 222, 282, 342, 402].forEach((x) => line(x, 590, x, 680));
  quarterArc(132, 545, 27);
  quarterArc(252, 590, 27);
  text(80, 650, 'LOBBY');
  text(145, 650, 'CORRIDOR');
  text(210, 650, 'STAIR');
  text(330, 650, 'MECH');
  text(90, 560, 'UNIT');
  text(205, 560, 'RESTROOM');
  text(330, 560, 'STORAGE');

  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  fs.writeFileSync(pdfPath, Buffer.from(pdf, 'binary'));
}

test('buildModelFromPlan runs the layered pipeline on a fixture PDF', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-plan-pipeline-'));
  const pdfPath = path.join(fixtureDir, 'synthetic-floorplan.pdf');
  createSyntheticPlanPdf(pdfPath);

  const { model, diagnostics, passesRun } = await buildModelFromPlan(pdfPath, 1, {
    roomOpts: { gridN: 160, minRoomSqft: 10 },
  });

  assert.deepEqual(passesRun, ['pass1', 'pass2', 'pass3', 'pass4', 'pass5', 'pass6', 'pass7']);
  assert.ok(Array.isArray(model.shell.outline) && model.shell.outline.length >= 4);
  assert.ok(Array.isArray(model.walls) && model.walls.length > 20);
  assert.ok(Array.isArray(model.doors) && model.doors.length > 0);

  const wallIds = new Set(model.walls.map((wall) => wall.id));
  for (const door of model.doors) {
    assert.ok(wallIds.has(door.wallId), `door ${door.id} should reference a real wall`);
  }

  const orphanDiagnostic = diagnostics.find((entry) => entry.code === 'orphan_walls');
  assert.equal(orphanDiagnostic, undefined);
});
