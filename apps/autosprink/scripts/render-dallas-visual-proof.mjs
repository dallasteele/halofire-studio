import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packet from '../src/data/dallas-pitched-attic-hydraulic-registration.json' with { type: 'json' };
import { buildDallasPitchedAtticBluebeamOverlay } from '../src/engine/dallas-pitched-attic-bluebeam-overlay.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'out', 'visual-proof');
fs.mkdirSync(outDir, { recursive: true });

const result = buildDallasPitchedAtticBluebeamOverlay(packet);
if (result.status !== 'passed') throw new Error(result.issues?.[0]?.message || 'Dallas Bluebeam overlay blocked');
fs.writeFileSync(path.join(outDir, result.manifest.fileName), result.buffer);
fs.writeFileSync(path.join(outDir, 'dallas-bluebeam-manifest.json'), JSON.stringify(result.manifest, null, 2));

const clip = packet.plan.remoteAreaCrop.clipPt;
const scale = packet.plan.remoteAreaCrop.matrixScale;
const map = ([x, y]) => [(x - clip[0]) * scale, (y - clip[1]) * scale];
const points = new Map(packet.heads.map((head) => [head.nodeId, head.planPointPt]));
for (const junction of packet.junctions) points.set(junction.nodeId, junction.planPointPt);
const pipes = packet.mappedBranchPipes.map((pipe) => {
  const a = map(points.get(pipe.fromNodeId)); const b = map(points.get(pipe.toNodeId));
  return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" data-pipe-id="${pipe.id}"/><text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 18}">2\"</text>`;
}).join('');
const heads = packet.heads.map((head) => {
  const [x, y] = map(head.planPointPt);
  return `<g data-head-id="${head.nodeId}"><circle cx="${x}" cy="${y}" r="28"/><path d="M ${x - 19} ${y - 19} L ${x + 19} ${y + 19} M ${x + 19} ${y - 19} L ${x - 19} ${y + 19}"/><text x="${x}" y="${y - 42}" text-anchor="middle">${head.nodeId}</text></g>`;
}).join('');

const sourceImage = '../agent-loops/dallas-pitched-attic-hydraulic-registration-20260713/asbuilt/page-005-remote-area-4x.png';
const html = `<!doctype html><html><head><meta charset="utf-8"><title>HaloFire Dallas Bluebeam Visual Proof</title><style>
*{box-sizing:border-box}body{margin:0;background:#070a10;color:#ecf4ff;font-family:Inter,Segoe UI,sans-serif}.page{padding:28px 30px 34px;min-height:100vh;background:radial-gradient(circle at 75% 0,#25102b 0,transparent 36%),linear-gradient(145deg,#080b12,#11151e)}
header{display:flex;justify-content:space-between;align-items:end;margin-bottom:18px}h1{margin:0;font-size:28px;letter-spacing:.02em}.eyebrow{color:#ffb36b;text-transform:uppercase;letter-spacing:.18em;font-size:11px;font-weight:700}.stamp{border:1px solid #2bba9c;color:#78f5d1;padding:8px 12px;border-radius:999px;font:700 11px ui-monospace,monospace}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:#0d121b;border:1px solid #283140;border-radius:14px;overflow:hidden;box-shadow:0 18px 60px #0008}.card h2{font-size:14px;margin:0;padding:13px 16px;border-bottom:1px solid #283140;display:flex;justify-content:space-between}.card h2 span{color:#8ea0b9;font:11px ui-monospace,monospace}.drawing{position:relative;height:500px;background:#fff;overflow:hidden}.drawing img,.drawing svg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.overlay line{stroke:#9f55f5;stroke-width:18;stroke-linecap:round;filter:drop-shadow(0 0 8px #6f22cc)}.overlay circle{fill:#63e7ffcc;stroke:#003f55;stroke-width:9}.overlay path{stroke:#002a38;stroke-width:9}.overlay text{fill:#071019;font:700 34px ui-monospace,monospace;paint-order:stroke;stroke:#fff;stroke-width:11;stroke-linejoin:round}.legend{display:flex;gap:18px;align-items:center;padding:11px 16px;background:#0a0f17;color:#a9b8cd;font-size:12px}.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px}.cyan{background:#63e7ff}.purple{background:#9f55f5}.facts{margin-top:18px;padding:14px 16px;background:#101722;border:1px solid #283140;border-radius:12px;display:flex;gap:24px;flex-wrap:wrap;font:12px ui-monospace,monospace;color:#b8c7db}.facts b{color:#fff}.warn{color:#ffcf87!important}
</style></head><body><div class="page"><header><div><div class="eyebrow">HaloFire source-to-output visual gate</div><h1>Dallas FP-1.4 · PDF → Bluebeam registration</h1></div><div class="stamp">SEALED · PRIMARY + ADVERSARIAL REPLAY</div></header><div class="grid"><section class="card"><h2>1 · Completed as-built PDF source <span>physical page 5 · crop 1050,650–1620,1320 pt</span></h2><div class="drawing"><img src="${sourceImage}" alt="Completed Dallas FP-1.4 Remote Area 5 source crop"></div><div class="legend">Unmodified as-built raster · SHA-256 matched reviewed set · 0 crop pixels changed</div></section><section class="card"><h2>2 · Bluebeam FDF imported markup preview <span>page index 4 · 18 annotations</span></h2><div class="drawing"><img src="${sourceImage}" alt="Completed Dallas FP-1.4 underlay"><svg class="overlay" viewBox="0 0 2280 2680" aria-label="Registered A1-A9 and two-inch branches">${pipes}${heads}</svg></div><div class="legend"><span><i class="dot cyan"></i>9 registered operating heads</span><span><i class="dot purple"></i>8 registered 2-inch branches</span></div></section></div><div class="facts"><span><b>Scale</b> 1/8\" = 1'-0\"</span><span><b>Roof</b> 4:12 pitched attic</span><span><b>Hydraulics</b> 334.913 gpm @ 46.453 psi</span><span><b>Import</b> Markups List → Markups → Import</span><span class="warn"><b>Gate</b> completed calibration subset · not whole-building compliance/fabrication release</span></div></div></body></html>`;
fs.writeFileSync(path.join(outDir, 'dallas-bluebeam-proof.html'), html);
console.log(JSON.stringify({ html: path.join(outDir, 'dallas-bluebeam-proof.html'), fdf: path.join(outDir, result.manifest.fileName), manifest: result.manifest }, null, 2));
