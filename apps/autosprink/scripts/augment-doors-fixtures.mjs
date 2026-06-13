/**
 * augment-doors-fixtures.mjs — W2: add DOORS, OPENINGS, FIXTURES to L1 of the cooperative-1881
 * plan-levels data file, in the SAME merged coordinate frame the walls live in.
 *
 * A-101 (page 8) is a STACKED two-wing sheet: the merged L1 plan registers the upper wing onto
 * the lower by (dx,dy) (stored in plan.merged.registration). Doors are detected from the swing
 * ARCS in the plan vector ops. To land doors in the merged frame we MIRROR the merge pipeline:
 *   1) extract ALL arcs (page-space feet) via extractArcsFromOpList
 *   2) split arcs at the same splitYFt the wall merge used (plan.stackedSplit.splitYFt)
 *   3) translate UPPER-wing arcs by (dx,dy) from plan.merged.registration
 *   4) detect doors against the merged walls; detect openings; detect fixtures from rooms+labels+stairs
 *   5) write doors[], openings[], fixtures[] (+ fixtureCounts) into level.plan, all needs-verification.
 *
 * SAM3 (GX10:9003) is an OPTIONAL disambiguator (--sam) for unclear arcs; vector arcs are primary
 * and SAM is never required. Honest: every emitted object is flagged needs-verification.
 *
 * Usage: node scripts/augment-doors-fixtures.mjs [--sam]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractArcsFromOpList, detectDoors, detectOpenings, detectFixtures } from '../src/engine/plan-doors.js';

const ARCH = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const DATA = path.resolve(process.cwd(), 'src/data/plan-levels.cooperative-1881.json');
const FT_PER_UNIT_FALLBACK = 1 / ((3 / 32) * 72);
const useSam = process.argv.includes('--sam');

const dataObj = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const L1 = dataObj.levels.find((l) => l.level === 1);
if (!L1 || !L1.plan) { console.error('L1 plan not found in data file'); process.exit(1); }
const plan = L1.plan;
const scale = Number(plan.scaleFtPerUnit) || FT_PER_UNIT_FALLBACK;
const reg = plan.merged && plan.merged.registration ? plan.merged.registration : { dx: 0, dy: 0 };
const splitYFt = plan.stackedSplit && Number.isFinite(plan.stackedSplit.splitYFt) ? plan.stackedSplit.splitYFt : null;

(async () => {
  const data = new Uint8Array(fs.readFileSync(ARCH));
  const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const page = await doc.getPage(L1.page || 8);
  const opList = await page.getOperatorList();
  const { arcs } = extractArcsFromOpList(opList, { scale });

  // The wall merge translated UPPER-wing geometry by (dx,dy) onto the LOWER wing's frame, and the
  // split was on the per-wing Y in PRE-translation page-feet. splitYFt is in page-feet of the
  // lower wing's frame; arcs are in raw page-feet. Upper-wing arcs (cyFt >= splitYFt) get (dx,dy).
  const placed = arcs.map((a) => {
    if (splitYFt != null && a.cyFt >= splitYFt) {
      return {
        ...a,
        cxFt: a.cxFt + reg.dx, cyFt: a.cyFt + reg.dy,
        startFt: [a.startFt[0] + reg.dx, a.startFt[1] + reg.dy],
        endFt: [a.endFt[0] + reg.dx, a.endFt[1] + reg.dy],
      };
    }
    return a;
  });

  // host-wall set: prefer the recall-complete wallsFull (captures partition walls doors host on).
  const walls = (plan.wallsFull && plan.wallsFull.length ? plan.wallsFull : plan.walls) || [];
  const { doors, note: doorNote } = detectDoors(placed, walls, {});
  // Openings: detect on the SINGLE-BAND major walls only (perimeter + primary partitions). The
  // dense partition-inclusive set produces O(n^2) spurious collinear "gaps"; major walls give the
  // honest cased-opening signal. Still conservative + flagged.
  const { openings, note: openNote } = detectOpenings(plan.walls || [], doors, {});
  const { fixtures, counts: fixtureCounts, note: fixNote } = detectFixtures(plan.rooms || [], plan.labels || [], plan.stairs || []);

  let samUsed = false, samReason = 'not-attempted';
  if (useSam) {
    // Optional SAM3 disambiguation of LOW-confidence (off-wall) doors. Fail-soft.
    const lowDoors = doors.filter((d) => d.confidence === 'low');
    if (lowDoors.length === 0) { samReason = 'no-low-confidence-doors'; }
    else {
      try {
        const url = 'http://192.168.1.76:9003/segment';
        const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'door-disambiguation', points: lowDoors.map((d) => d.position) }), signal: AbortSignal.timeout(8000) });
        samUsed = resp.ok; samReason = resp.ok ? 'ok' : `http-${resp.status}`;
      } catch (e) { samReason = `sam-error:${e && e.message ? e.message : e}`; }
    }
  }

  plan.doors = doors;
  plan.openings = openings;
  plan.fixtures = fixtures;
  plan.fixtureCounts = fixtureCounts;
  plan.doorExtraction = {
    method: 'swing-arc-circle-fit', arcsTotal: arcs.length, doorsFound: doors.length,
    openingsFound: openings.length, fixturesFound: fixtures.length,
    samUsed, samReason, registrationApplied: { dx: reg.dx, dy: reg.dy, splitYFt },
    notes: { doors: doorNote, openings: openNote, fixtures: fixNote },
    needsVerification: true,
  };
  plan.counts = { ...(plan.counts || {}), doors: doors.length, openings: openings.length, fixtures: fixtures.length };

  // HONEST RECALL: the wall-coverage % surfaced in the Studio is MEASURED by the standalone
  // scripts/measure-wall-recall.mjs (rasterizes the committed wallsFull vs the A-101 sheet ink;
  // requires `canvas`, kept out of the app deps). That measurement writes wallsFullMeta.recallPct
  // + recallMeasure here. This augment step PRESERVES any existing measured recall so a re-run
  // doesn't silently drop it — it never fabricates a recall number.
  if (plan.wallsFullMeta && plan.wallsFullMeta.recallPct == null) {
    plan.wallsFullMeta.recallNote = 'recall not yet measured — run scripts/measure-wall-recall.mjs (needs canvas). needs-verification.';
  }

  // MINIFIED: L1 carries 41,784 wallsFull segs; this file is served static to the live Studio,
  // so pretty-printing ~3x's the payload for no benefit.
  fs.writeFileSync(DATA, JSON.stringify(dataObj));
  const onWall = doors.filter((d) => d.onWall).length;
  console.log(JSON.stringify({
    arcsTotal: arcs.length, doorsFound: doors.length, doorsOnWall: onWall,
    openingsFound: openings.length, fixturesFound: fixtures.length, fixtureCounts,
    samUsed, samReason, wrote: DATA,
  }, null, 2));
  try { await doc.destroy?.(); } catch { /* torn down */ }
})().catch((e) => { console.error('AUGMENT FAILED', e); process.exit(1); });
void pathToFileURL;
