// DIAGNOSTIC (read-only): root-cause the Cooperative 1881 sprinkler-network scale/alignment break.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'https://halofire.rankempire.io';
const OUT = process.argv[3] || 'out/halofire-plan';
const USER = process.env.HF_USER || 'admin';
const PASS = process.env.HF_PASS;
if (!PASS) { console.error('set HF_PASS'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
const login = await ctx.request.post(BASE + '/api/auth/login', { data: { username: USER, password: PASS } });
console.log('login', login.status());
if (!login.ok()) { process.exit(2); }

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type()==='error') errs.push('[console]'+m.text()); });
await page.goto(BASE + '/autosprink.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.getElementById('genBtn'), null, { timeout: 60000 });
// wait for kernel ready
await page.waitForFunction(() => window.ogReady === true, null, { timeout: 120000 }).catch(()=>console.log('ogReady wait timed out'));
await sleep(1000);

const projName = await page.evaluate(() => {
  const t = document.getElementById('projectTarget');
  if (!t) return null;
  const opt = [...t.options].find((o) => /cooperative/i.test(o.value) || /1881/.test(o.value));
  if (opt) { t.value = opt.value; t.dispatchEvent(new Event('change', { bubbles: true })); }
  return { value: t.value, ogReady: window.ogReady };
});
console.log('project=', JSON.stringify(projName));
await sleep(2500);

// state right after selecting (before generate) — does plan-comprehension build kick in?
const preGen = await page.evaluate(() => ({
  underlayMode: window.__underlayMode || null,
  hasPlanBuild: !!window.planBuildState,
  planBuildProject: window.planBuildState ? window.planBuildState.project : null,
  planBuildErr: window.__planBuildError || null,
  currentProject: (typeof currentProjectName==='function') ? currentProjectName() : null,
}));
console.log('PRE-GEN:', JSON.stringify(preGen, null, 2));

// Generate
await page.evaluate(() => { const b=document.getElementById('genBtn'); if(b){b.disabled=false; b.click();} });
await page.waitForFunction(() => !!window.__geomTakeoff, null, { timeout: 180000 }).catch(()=>console.log('takeoff wait timed out; status='));
await sleep(3000);
const statusTxt = await page.evaluate(() => { const s=document.getElementById('status'); return s?s.textContent:null; });
console.log('STATUS after gen:', statusTxt);

const diag = await page.evaluate(() => {
  const out = { underlayMode: window.__underlayMode || null, takeoff: window.__geomTakeoff || null, planBuildErr: window.__planBuildError||null };
  const cm = window.currentCadModel || null;
  function bboxOfPts(pts){ if(!pts.length) return null; let a=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity]; for(const p of pts){a[0]=Math.min(a[0],p[0]);a[1]=Math.max(a[1],p[0]);a[2]=Math.min(a[2],p[1]);a[3]=Math.max(a[3],p[1]);a[4]=Math.min(a[4],p[2]);a[5]=Math.max(a[5],p[2]);} return {minX:a[0],maxX:a[1],minY:a[2],maxY:a[3],minZ:a[4],maxZ:a[5],w:a[1]-a[0],d:a[3]-a[2],h:a[5]-a[4]};}
  if (cm && Array.isArray(cm.solids)) {
    const pipePts=[]; for(const s of cm.solids){ if(s.from&&s.to) pipePts.push(s.from,s.to); }
    out.cadModel = {
      counts: cm.counts||null,
      networkBbox: bboxOfPts(pipePts),
      roles: [...new Set(cm.solids.filter(s=>s.role).map(s=>s.role))],
      maxPipeDia: cm.solids.reduce((m,s)=> (s.diameterIn||0)>m?(s.diameterIn):m,0),
      sampleMains: cm.solids.filter(s=>/main/.test(s.role||'')).slice(0,3).map(s=>({role:s.role,dia:s.diameterIn,from:s.from,to:s.to})),
    };
  }
  const pb = window.planBuildState || null;
  if (pb) out.planBuild = { project: pb.project, center: pb.center, apiBounds: pb.api&&pb.api.bounds, apiSummary: pb.api&&pb.api.summary,
    l1: (()=>{ const l=(pb.levelPlans||[]).find(x=>x.level===1); return l&&l.plan?{footprintBboxFt:l.plan.footprintBboxFt,scaleFtPerUnit:l.plan.scaleFtPerUnit}:null;})() };
  out.pipeVizScale = (typeof pipeVizScale!=='undefined')?pipeVizScale:null;
  if (out.cadModel && out.cadModel.maxPipeDia) { const pv=out.pipeVizScale??1; out.crossMainRenderedRadiusFt=(out.cadModel.maxPipeDia/12/2)*pv; out.trueRadius_8in=8/12/2; }
  out.geomPick={}; for(const g of ['teeDown','elbowUp','coupling','hangerVert']){ try{ out.geomPick[g]=window.__geomPick?window.__geomPick(g):null;}catch(e){out.geomPick[g]=String(e);} }
  return out;
});
fs.writeFileSync(path.join(OUT, '1881-diag.json'), JSON.stringify(diag, null, 2));
console.log('CADMODEL:', JSON.stringify(diag.cadModel, null, 2));
console.log('CROSSMAIN: pipeVizScale=', diag.pipeVizScale, 'renderedRadiusFt=', diag.crossMainRenderedRadiusFt, 'trueRadius_8in=', diag.trueRadius_8in);
console.log('PLANBUILD.l1=', JSON.stringify(diag.planBuild && diag.planBuild.l1), 'apiBounds=', JSON.stringify(diag.planBuild && diag.planBuild.apiBounds));
console.log('GEOMPICK:', JSON.stringify(diag.geomPick));
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0,10));

async function snap(name,w=1100,h=750,q=0.8){ try{ const u=await page.evaluate(([mw,mh,qq])=>window.__snapshot?window.__snapshot(mw,mh,qq):null,[w,h,q]); if(u){fs.writeFileSync(path.join(OUT,name),Buffer.from(u.split(',')[1],'base64'));console.log('saved',name);}else console.log('no snapshot');}catch(e){console.log('snap fail',e.message);} }
await snap('1881-broken-network-scale.jpg');
await browser.close();
console.log('DONE');
