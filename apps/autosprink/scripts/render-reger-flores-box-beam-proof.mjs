import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRegerFloresBoxBeamCalibrationViews, validateRegerFloresBoxBeamCalibration, verifyRegerFloresBoxBeamCalibrationAdversarialLoop } from '../src/engine/reger-flores-box-beam-calibration.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const packet = JSON.parse(fs.readFileSync(path.join(root, 'src/data/reger-flores-box-beam-calibration.json'), 'utf8'));
const [validation, adversarial] = await Promise.all([
  validateRegerFloresBoxBeamCalibration(packet),
  verifyRegerFloresBoxBeamCalibrationAdversarialLoop(packet),
]);
const views = renderRegerFloresBoxBeamCalibrationViews(packet);
if (validation.status !== 'passed' || adversarial.status !== 'passed' || views.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial, views }, null, 2));

const out = path.join(root, 'out/visual-proof');
fs.mkdirSync(out, { recursive: true });
for (const [name, svg] of Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg })) fs.writeFileSync(path.join(out, `reger-flores-box-beam-${name}.svg`), svg);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>HaloFire Reger-Flores Box-Beam Proof</title><style>
*{box-sizing:border-box}body{margin:0;background:#05070b;color:#edf4ff;font-family:Inter,Segoe UI,Arial,sans-serif}.page{min-height:100vh;padding:28px;background:radial-gradient(circle at 80% 0,#2b1225,transparent 34%),linear-gradient(145deg,#070a10,#111722)}header{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:18px}h1{margin:4px 0 0;font-size:28px}.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#ffb36b;font-weight:800}.stamp{border:1px solid #24c9a5;color:#7ef9dc;border-radius:999px;padding:8px 12px;font:700 11px ui-monospace,monospace;white-space:nowrap}.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}.card{background:#0d131d;border:1px solid #293344;border-radius:14px;overflow:hidden;box-shadow:0 18px 55px #0008}.card h2{font-size:14px;margin:0;padding:13px 15px;border-bottom:1px solid #293344}.card svg{display:block;width:100%;height:420px;background:#fff}.card.model{grid-column:1/-1}.card.model svg{height:430px}.facts{display:flex;flex-wrap:wrap;gap:20px;margin-top:16px;padding:14px 16px;border:1px solid #293344;border-radius:12px;background:#0d131d;font:12px ui-monospace,monospace;color:#b7c5d9}.facts b{color:#fff}.warn{color:#ffc879}.fail{color:#ff9b9b}@media(max-width:900px){.grid{grid-template-columns:1fr}.card.model{grid-column:auto}}
</style></head><body><div class="page"><header><div><div class="eyebrow">HaloFire source-to-output correction proof</div><h1>Reger-Flores lounge - box-beam-aware pitched layout</h1></div><div class="stamp">SEALED - PRIMARY + INDEPENDENT + 7 ADVERSARIAL</div></header><div class="grid"><section class="card"><h2>1 - Bluebeam-style top layout: two slopes x three beam bays</h2>${views.topSvg}</section><section class="card"><h2>2 - Side view controls the 4:12 ceiling elevation</h2>${views.elevationSvg}</section><section class="card model"><h2>3 - Partial-room 3D reconstruction from the corrected source geometry</h2>${views.model3dSvg}</section></div><div class="facts"><span><b>Source</b> three consecutive 8 ft CAD dimensions</span><span><b>Obstructions</b> two 8 x 8 full-span box beams</span><span><b>Output</b> six heads in six protection cells</span><span><b>Receipt</b> ${packet.receiptSha256.slice(0, 16)}...</span><span class="warn"><b>Truth</b> answer-exposed correction; exact placement not claimed</span><span class="fail"><b>Still blocked</b> fresh unseen acceptance, compliance, fabrication, field release</span></div></div></body></html>`;
const htmlPath = path.join(out, 'reger-flores-box-beam-proof.html');
fs.writeFileSync(htmlPath, html);
console.log(JSON.stringify({ status: 'passed', htmlPath, receiptSha256: packet.receiptSha256, adversarialRejected: adversarial.rejectedCases.length, counts: views.counts }, null, 2));
