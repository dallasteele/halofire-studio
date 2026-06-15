/**
 * HaloFire SUBMITTAL SHEET SET (Phase 4, chunk 3).
 *
 * Builds the standard fire-sprinkler SUBMITTAL SHEET SET on a TITLEBLOCK from the
 * real reconstructed model + Phase-2 BOM + Phase-3 hydraulics:
 *
 *   FP-0  Cover sheet (project / sheet index / disclaimer)
 *   FP-H  Hydraulic placard (from the Phase-3 hydraulic report / __hf3.report)
 *   FP-N  Per-level floor plan(s)  (one sheet per occupied level; heads/pipes/walls/columns)
 *   FP-R  Riser diagram (schematic vertical mains/risers + cross-mains + branch stubs)
 *   FP-B  Bill of materials (from the BOM takeoff)
 *   FP-D  Details (a generated section/elevation detail when one exists, else a stock note)
 *
 * Each sheet is a SHEET object:
 *   { id, code, title, kind, svg, w, h, titleblock }
 * where `svg` is a complete, self-contained <svg>…</svg> string drawn on an ANSI-D
 * (34"x22") titleblock at 72 px/in => 2448 x 1584 px viewBox. The renderer is pure
 * string-building (no DOM, no THREE) so it unit-tests and prints identically.
 *
 * PURE + deterministic + browser-free. Unit-tested. The host (autosprink.html)
 * supplies the live model, hydraulic report, BOM takeoff and (optional) section,
 * and wires `__hfPhase4.submittal -> { sheets:[ids], hasTitleblock, exportReady }`.
 *
 * HONESTY: this is an ENGINEERING AID. Every sheet carries the NOT-AHJ/PE-stamped
 * disclaimer in its titleblock. A generated sheet NEVER reads as an approved /
 * sealed / permit-ready submittal. Schedules, BOM and hydraulics are best-effort
 * estimates from the reconstructed model and must be professionally reviewed.
 */

export const SUBMITTAL_SHEETS_DISCLAIMER =
  'ENGINEERING AID — generated from the reconstructed design model. NOT AHJ-approved, '
  + 'NOT PE-stamped, NOT permit-ready. Schedules, bill of materials and hydraulics are '
  + 'best-effort estimates and require professional review before submittal.';

// ANSI-D sheet @ 72 px/in. Landscape.
const SHEET_W = 2448; // 34"
const SHEET_H = 1584; // 22"
const MARGIN = 36;    // 0.5"
const TB_W = 360;     // titleblock width (right strip)
const TB_FOOT_H = 96; // footer disclaimer band height

const EPS = 1e-9;

function round(n, p = 2) {
  const m = Math.pow(10, p);
  return Math.round((Number(n) + Number.EPSILON) * m) / m;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function num(n, d = 0) { return Number.isFinite(Number(n)) ? Number(n) : d; }

/* ── plan-extent helpers ─────────────────────────────────────────────────── */

/** Bounding box (plan feet) of a set of solids; returns null if empty. */
function planBounds(solids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const note = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const s of solids) {
    if (!s) continue;
    if (s.kind === 'head' && Array.isArray(s.position)) note(s.position[0], s.position[1]);
    else if (s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to)) {
      note(s.from[0], s.from[1]); note(s.to[0], s.to[1]);
    } else if (s.kind === 'wall' && Array.isArray(s.a) && Array.isArray(s.b)) {
      note(s.a[0], s.a[1]); note(s.b[0], s.b[1]);
    } else if (s.kind === 'column' && Number.isFinite(s.x)) note(s.x, s.y);
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1, w: Math.max(x1 - x0, EPS), h: Math.max(y1 - y0, EPS) };
}

/** A plan->paper mapper that fits `bounds` (plan ft) into a paper rect (px), Y-flipped. */
function fitMapper(bounds, rect) {
  if (!bounds) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    return { X: () => cx, Y: () => cy, scale: 1 };
  }
  const sx = rect.w / bounds.w, sy = rect.h / bounds.h;
  const scale = Math.min(sx, sy);
  // center within the rect
  const drawW = bounds.w * scale, drawH = bounds.h * scale;
  const ox = rect.x + (rect.w - drawW) / 2;
  const oy = rect.y + (rect.h - drawH) / 2;
  return {
    scale,
    X: (xf) => ox + (xf - bounds.x0) * scale,
    // paper Y grows DOWN; plan Y grows UP -> flip
    Y: (yf) => oy + (bounds.y1 - yf) * scale,
  };
}

/* ── titleblock ──────────────────────────────────────────────────────────── */

/**
 * Render the titleblock (right strip + footer disclaimer band) for one sheet.
 * Carries project / address / date / designer / sheet number / scale + the
 * NOT-AHJ/PE-stamped disclaimer. Returns an SVG fragment string.
 */
function renderTitleblock(tb) {
  const x = SHEET_W - MARGIN - TB_W;
  const y = MARGIN;
  const w = TB_W;
  const h = SHEET_H - 2 * MARGIN - TB_FOOT_H - 12;
  const lines = [
    ['PROJECT', tb.project],
    ['ADDRESS', tb.address],
    ['CLIENT', tb.client],
    ['DESIGNER', tb.designer],
    ['DATE', tb.date],
    ['SCALE', tb.scale],
    ['SYSTEM', tb.system],
    ['SHEET', tb.sheetCode + '  (' + tb.sheetNo + ' of ' + tb.sheetTotal + ')'],
  ];
  let out = '';
  out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="#111" stroke-width="2"/>`;
  // company band
  out += `<rect x="${x}" y="${y}" width="${w}" height="56" fill="#1b2430"/>`;
  out += `<text x="${x + 16}" y="${y + 36}" fill="#e8f0ff" font-size="26" font-weight="700" font-family="Arial,Helvetica,sans-serif">HALO FIRE PROTECTION</text>`;
  // key/value rows
  let ry = y + 56;
  const rowH = 46;
  for (const [k, v] of lines) {
    out += `<line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="#888" stroke-width="1"/>`;
    out += `<text x="${x + 12}" y="${ry + 18}" fill="#5a6470" font-size="12" font-weight="700" font-family="Arial,Helvetica,sans-serif">${esc(k)}</text>`;
    out += `<text x="${x + 12}" y="${ry + 38}" fill="#111" font-size="17" font-family="Arial,Helvetica,sans-serif">${esc(v == null || v === '' ? '—' : v)}</text>`;
    ry += rowH;
  }
  // big sheet code at the bottom of the block
  const bigY = y + h - 64;
  out += `<line x1="${x}" y1="${bigY - 10}" x2="${x + w}" y2="${bigY - 10}" stroke="#111" stroke-width="2"/>`;
  out += `<text x="${x + w / 2}" y="${bigY + 44}" fill="#b71c1c" font-size="56" font-weight="800" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">${esc(tb.sheetCode)}</text>`;
  return out;
}

/** Footer disclaimer band spanning the sheet width. */
function renderFooter() {
  const x = MARGIN, w = SHEET_W - 2 * MARGIN;
  const y = SHEET_H - MARGIN - TB_FOOT_H;
  let out = '';
  out += `<rect x="${x}" y="${y}" width="${w}" height="${TB_FOOT_H}" fill="#fff5f5" stroke="#b71c1c" stroke-width="2"/>`;
  // wrap the disclaimer over two lines
  const d = SUBMITTAL_SHEETS_DISCLAIMER;
  const mid = d.indexOf(' ', Math.floor(d.length / 2));
  const l1 = d.slice(0, mid), l2 = d.slice(mid + 1);
  out += `<text x="${x + 18}" y="${y + 40}" fill="#7a1010" font-size="20" font-weight="700" font-family="Arial,Helvetica,sans-serif">${esc(l1)}</text>`;
  out += `<text x="${x + 18}" y="${y + 72}" fill="#7a1010" font-size="20" font-weight="700" font-family="Arial,Helvetica,sans-serif">${esc(l2)}</text>`;
  return out;
}

/** The drawing window (left of the titleblock, above the footer). */
function drawRect() {
  return {
    x: MARGIN + 12,
    y: MARGIN + 12,
    w: SHEET_W - 2 * MARGIN - TB_W - 48,
    h: SHEET_H - 2 * MARGIN - TB_FOOT_H - 36,
  };
}

/** Wrap body SVG + titleblock + footer + frame into a full sheet SVG string. */
function wrapSheet(body, tb) {
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" `
    + `width="100%" preserveAspectRatio="xMidYMid meet" font-family="Arial,Helvetica,sans-serif">`;
  out += `<rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="#ffffff"/>`;
  // outer frame
  out += `<rect x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}" fill="none" stroke="#111" stroke-width="3"/>`;
  out += body;
  out += renderTitleblock(tb);
  out += renderFooter();
  out += `</svg>`;
  return out;
}

/* ── sheet bodies ────────────────────────────────────────────────────────── */

/** FP-0 cover: project header + sheet index + disclaimer block. */
function bodyCover(ctx, sheetIndex) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x + 24}" y="${r.y + 80}" font-size="64" font-weight="800" fill="#111">FIRE SPRINKLER</text>`;
  out += `<text x="${r.x + 24}" y="${r.y + 150}" font-size="64" font-weight="800" fill="#111">SUBMITTAL PACKAGE</text>`;
  out += `<text x="${r.x + 24}" y="${r.y + 210}" font-size="30" fill="#444">${esc(ctx.project)}</text>`;
  if (ctx.address) out += `<text x="${r.x + 24}" y="${r.y + 252}" font-size="24" fill="#666">${esc(ctx.address)}</text>`;
  // sheet index table
  let iy = r.y + 340;
  out += `<text x="${r.x + 24}" y="${iy}" font-size="28" font-weight="700" fill="#111">SHEET INDEX</text>`;
  iy += 24;
  out += `<line x1="${r.x + 24}" y1="${iy}" x2="${r.x + 720}" y2="${iy}" stroke="#111" stroke-width="2"/>`;
  iy += 36;
  for (const s of sheetIndex) {
    out += `<text x="${r.x + 24}" y="${iy}" font-size="24" font-weight="700" fill="#b71c1c">${esc(s.code)}</text>`;
    out += `<text x="${r.x + 150}" y="${iy}" font-size="24" fill="#222">${esc(s.title)}</text>`;
    iy += 40;
  }
  // disclaimer block
  const by = r.y + r.h - 200;
  out += `<rect x="${r.x + 24}" y="${by}" width="${r.w - 48}" height="160" fill="#fff5f5" stroke="#b71c1c" stroke-width="2"/>`;
  out += `<text x="${r.x + 44}" y="${by + 40}" font-size="22" font-weight="800" fill="#7a1010">⚠ NOT FOR CONSTRUCTION / NOT A STAMPED SUBMITTAL</text>`;
  const words = SUBMITTAL_SHEETS_DISCLAIMER.split(' ');
  const wrapped = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).length > 78) { wrapped.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) wrapped.push(line);
  wrapped.slice(0, 4).forEach((l, i) => {
    out += `<text x="${r.x + 44}" y="${by + 78 + i * 28}" font-size="18" fill="#7a1010">${esc(l)}</text>`;
  });
  return out;
}

/** Draw the plan geometry (walls, columns, pipes, heads) for a set of solids into rect r. */
function drawPlan(solids, r) {
  const bounds = planBounds(solids);
  const map = fitMapper(bounds, r);
  let out = '';
  // walls (dark)
  for (const s of solids) {
    if (s.kind !== 'wall' || !Array.isArray(s.a) || !Array.isArray(s.b)) continue;
    out += `<line x1="${round(map.X(s.a[0]))}" y1="${round(map.Y(s.a[1]))}" x2="${round(map.X(s.b[0]))}" y2="${round(map.Y(s.b[1]))}" stroke="#1b2430" stroke-width="3"/>`;
  }
  // columns (red squares)
  for (const s of solids) {
    if (s.kind !== 'column' || !Number.isFinite(s.x)) continue;
    const sz = Math.max((num(s.sizeFt, 1)) * map.scale, 6);
    out += `<rect x="${round(map.X(s.x) - sz / 2)}" y="${round(map.Y(s.y) - sz / 2)}" width="${round(sz)}" height="${round(sz)}" fill="#b71c1c" fill-opacity="0.55" stroke="#7a1010" stroke-width="1.5"/>`;
  }
  // pipes (blue branches, red mains)
  for (const s of solids) {
    if (s.kind !== 'pipe' || !Array.isArray(s.from) || !Array.isArray(s.to)) continue;
    const isMain = s.role === 'main' || s.role === 'cross-main' || s.role === 'riser';
    const col = isMain ? '#d32f2f' : (s.role === 'drop' ? '#0891b2' : '#1565c0');
    const wdt = isMain ? 3 : 1.6;
    out += `<line x1="${round(map.X(s.from[0]))}" y1="${round(map.Y(s.from[1]))}" x2="${round(map.X(s.to[0]))}" y2="${round(map.Y(s.to[1]))}" stroke="${col}" stroke-width="${wdt}"/>`;
  }
  // heads (open circles with cross)
  let headCount = 0;
  for (const s of solids) {
    if (s.kind !== 'head' || !Array.isArray(s.position)) continue;
    headCount++;
    const cx = round(map.X(s.position[0])), cy = round(map.Y(s.position[1]));
    out += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="none" stroke="#b71c1c" stroke-width="1.6"/>`;
    out += `<line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="#b71c1c" stroke-width="1.2"/>`;
    out += `<line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}" stroke="#b71c1c" stroke-width="1.2"/>`;
  }
  return { svg: out, bounds, scale: map.scale, headCount };
}

/** FP-N per-level plan body. */
function bodyPlan(levelSolids, levelLabel) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x}" y="${r.y + 8}" font-size="28" font-weight="700" fill="#111">${esc(levelLabel)} — SPRINKLER PLAN</text>`;
  const inner = { x: r.x, y: r.y + 28, w: r.w, h: r.h - 28 };
  const drawn = drawPlan(levelSolids, inner);
  out += drawn.svg;
  if (!drawn.bounds) {
    out += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="26" fill="#999" text-anchor="middle">no plan geometry on this level</text>`;
  }
  // north arrow
  const nx = r.x + r.w - 70, ny = r.y + 70;
  out += `<g><line x1="${nx}" y1="${ny + 26}" x2="${nx}" y2="${ny - 26}" stroke="#111" stroke-width="2"/>`
    + `<path d="M ${nx} ${ny - 30} L ${nx - 8} ${ny - 14} L ${nx + 8} ${ny - 14} Z" fill="#111"/>`
    + `<text x="${nx}" y="${ny + 42}" font-size="16" text-anchor="middle" fill="#111">N</text></g>`;
  return out;
}

/** FP-H hydraulic placard body — from the Phase-3 hydraulic report summary. */
function bodyHydraulic(report) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x}" y="${r.y + 8}" font-size="28" font-weight="700" fill="#111">HYDRAULIC DESIGN PLACARD</text>`;
  const s = report && report.summary;
  if (!s) {
    out += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="26" fill="#999" text-anchor="middle">no hydraulic solve — run Phase-3 hydraulics first</text>`;
    return out;
  }
  // NFPA-13 style permanently-affixed placard
  const px = r.x + 40, py = r.y + 60, pw = Math.min(r.w - 80, 900);
  const rows = [
    ['Building / system', report.meta && report.meta.system],
    ['Hazard / occupancy', s.hazardLabel || s.hazard || '—'],
    ['Design density', s.densityGpmFt2 != null ? s.densityGpmFt2 + ' gpm/ft²' : '—'],
    ['Design area', s.designAreaSqFt != null ? s.designAreaSqFt + ' ft²' : '—'],
    ['Design basis', s.designBasisLabel || '—'],
    ['K-factor', s.kFactor != null ? String(s.kFactor) : '—'],
    ['System demand', s.demandGpm != null ? round(s.demandGpm, 1) + ' gpm' : '—'],
    ['Required pressure', s.requiredPsi != null ? round(s.requiredPsi, 1) + ' psi' : '—'],
    ['Available pressure', s.availablePsi != null ? round(s.availablePsi, 1) + ' psi' : '—'],
    ['Safety margin', s.safetyMarginPsi != null ? round(s.safetyMarginPsi, 1) + ' psi' : '—'],
    ['Friction loss', s.frictionLossPsi != null ? round(s.frictionLossPsi, 1) + ' psi' : '—'],
    ['Elevation loss', s.elevationPsi != null ? round(s.elevationPsi, 1) + ' psi' : '—'],
    ['Max velocity', s.maxVelocityFps != null ? round(s.maxVelocityFps, 1) + ' fps' : '—'],
    ['Heads (flowing / total)', (s.headsFlowing != null ? s.headsFlowing : '—') + ' / ' + (s.headsTotal != null ? s.headsTotal : '—')],
    ['Demand met', s.demandMet === true ? 'YES' : (s.demandMet === false ? 'NO' : '—')],
  ];
  const rowH = 50;
  out += `<rect x="${px}" y="${py}" width="${pw}" height="${rows.length * rowH + 8}" fill="#fffef5" stroke="#111" stroke-width="2.5"/>`;
  let ry = py + 8;
  for (const [k, v] of rows) {
    out += `<line x1="${px}" y1="${ry}" x2="${px + pw}" y2="${ry}" stroke="#bbb" stroke-width="1"/>`;
    out += `<text x="${px + 18}" y="${ry + 33}" font-size="22" font-weight="700" fill="#333">${esc(k)}</text>`;
    const ok = (k === 'Demand met' && v === 'YES');
    const bad = (k === 'Demand met' && v === 'NO');
    out += `<text x="${px + pw - 18}" y="${ry + 33}" font-size="22" font-weight="700" fill="${ok ? '#1b7a2f' : (bad ? '#b71c1c' : '#111')}" text-anchor="end">${esc(v)}</text>`;
    ry += rowH;
  }
  out += `<text x="${px}" y="${ry + 40}" font-size="16" fill="#7a1010">${esc(report.disclaimer || '')}</text>`;
  return out;
}

/**
 * FP-R riser diagram body — a SCHEMATIC vertical riser: source -> riser -> cross
 * mains per level -> branch stubs. Built from the model's risers/mains/levels.
 */
function bodyRiser(solids, levels) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x}" y="${r.y + 8}" font-size="28" font-weight="700" fill="#111">RISER DIAGRAM (SCHEMATIC)</text>`;
  // gather level elevations (feet) — fall back to a single level at z=0
  let lvls = (Array.isArray(levels) && levels.length)
    ? levels.map((l) => ({ label: l.name || ('Level ' + l.level), z: num(l.elevationFt, 0) }))
    : null;
  if (!lvls) {
    // derive levels from head Z values
    const zs = new Set();
    for (const s of solids) {
      if (s.kind === 'head' && Array.isArray(s.position)) zs.add(round(num(s.position[2], 0), 0));
      if (s.kind === 'pipe' && Array.isArray(s.from)) { zs.add(round(num(s.from[2], 0), 0)); zs.add(round(num(s.to[2], 0), 0)); }
    }
    const arr = [...zs].sort((a, b) => a - b);
    lvls = arr.length ? arr.map((z, i) => ({ label: 'EL ' + z + "'", z })) : [{ label: 'Level 1', z: 0 }];
  }
  lvls.sort((a, b) => a.z - b.z);
  const ix = r.x + 200, iy0 = r.y + r.h - 120, iyTop = r.y + 80;
  const zMin = lvls[0].z, zMax = Math.max(lvls[lvls.length - 1].z, zMin + 10);
  const Z = (z) => iy0 - (z - zMin) / Math.max(zMax - zMin, EPS) * (iy0 - iyTop);
  // ground + source
  out += `<line x1="${r.x + 40}" y1="${iy0}" x2="${r.x + r.w - 40}" y2="${iy0}" stroke="#444" stroke-width="2" stroke-dasharray="8 6"/>`;
  out += `<text x="${r.x + 40}" y="${iy0 + 28}" font-size="16" fill="#666">GRADE / WATER SUPPLY (FDC + backflow + riser check)</text>`;
  // vertical riser
  out += `<line x1="${ix}" y1="${iy0}" x2="${ix}" y2="${Z(zMax)}" stroke="#d32f2f" stroke-width="6"/>`;
  out += `<rect x="${ix - 14}" y="${iy0 - 4}" width="28" height="44" fill="#fff" stroke="#d32f2f" stroke-width="3"/>`;
  out += `<text x="${ix - 70}" y="${iy0 + 60}" font-size="16" fill="#b71c1c">RISER / VALVE</text>`;
  // per-level cross main + branch stubs
  const headByLevel = bucketHeadsByZ(solids, lvls);
  lvls.forEach((lv, i) => {
    const y = Z(lv.z);
    out += `<line x1="${ix}" y1="${y}" x2="${r.x + r.w - 80}" y2="${y}" stroke="#d32f2f" stroke-width="4"/>`;
    out += `<text x="${ix - 60}" y="${y - 8}" font-size="18" font-weight="700" fill="#111" text-anchor="end">${esc(lv.label)}</text>`;
    // branch stubs (one per ~6 heads, capped) descending from the cross-main
    const heads = headByLevel[i] || 0;
    const stubs = Math.max(1, Math.min(10, Math.round(heads / 6) || 1));
    for (let k = 0; k < stubs; k++) {
      const sx = ix + 120 + k * ((r.w - 360) / Math.max(stubs, 1));
      out += `<line x1="${round(sx)}" y1="${round(y)}" x2="${round(sx)}" y2="${round(y + 34)}" stroke="#1565c0" stroke-width="2.5"/>`;
      out += `<circle cx="${round(sx)}" cy="${round(y + 40)}" r="5" fill="none" stroke="#b71c1c" stroke-width="1.8"/>`;
    }
    out += `<text x="${r.x + r.w - 70}" y="${y + 6}" font-size="15" fill="#555">${heads} heads</text>`;
  });
  out += `<text x="${r.x}" y="${r.y + r.h + 4}" font-size="15" fill="#7a1010">Schematic — branch stub count derived from head count per level; not a fabrication drawing.</text>`;
  return out;
}

function bucketHeadsByZ(solids, lvls) {
  const counts = new Array(lvls.length).fill(0);
  for (const s of solids) {
    if (s.kind !== 'head' || !Array.isArray(s.position)) continue;
    const z = num(s.position[2], 0);
    // nearest level
    let best = 0, bestD = Infinity;
    lvls.forEach((lv, i) => { const d = Math.abs(lv.z - z); if (d < bestD) { bestD = d; best = i; } });
    counts[best]++;
  }
  return counts;
}

/** FP-B bill of materials body — from the BOM takeoff. */
function bodyBom(bom) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x}" y="${r.y + 8}" font-size="28" font-weight="700" fill="#111">BILL OF MATERIALS (TAKEOFF)</text>`;
  if (!bom) {
    out += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="26" fill="#999" text-anchor="middle">no BOM — generate a layout first</text>`;
    return out;
  }
  const lines = [];
  lines.push(['Sprinkler heads', num(bom.heads), 'ea']);
  lines.push(['Pipe (total)', num(bom.pipeFt), 'ft']);
  if (bom.bySize) for (const [k, v] of Object.entries(bom.bySize)) lines.push(['  Pipe ' + k, v, 'ft']);
  lines.push(['Pipe segments', num(bom.pipeSegments), 'ea']);
  lines.push(['Fittings (components)', num(bom.fittings), 'ea']);
  if (num(bom.couplings)) lines.push(['Couplings (est.)', num(bom.couplings), 'ea']);
  if (num(bom.hangers)) lines.push(['Hangers (est.)', num(bom.hangers), 'ea']);
  if (num(bom.walls)) lines.push(['Walls (model)', num(bom.walls), 'ea']);
  if (bom.byMaterial) for (const [k, v] of Object.entries(bom.byMaterial)) lines.push(['Material · ' + k, v, 'parts']);

  const tx = r.x + 24, tw = Math.min(r.w - 48, 1000), rowH = 46;
  let ty = r.y + 56;
  out += `<rect x="${tx}" y="${ty}" width="${tw}" height="${(lines.length + 1) * rowH + 8}" fill="#fff" stroke="#111" stroke-width="2"/>`;
  // header
  out += `<rect x="${tx}" y="${ty}" width="${tw}" height="${rowH}" fill="#1b2430"/>`;
  out += `<text x="${tx + 16}" y="${ty + 31}" font-size="20" font-weight="700" fill="#e8f0ff">ITEM</text>`;
  out += `<text x="${tx + tw - 200}" y="${ty + 31}" font-size="20" font-weight="700" fill="#e8f0ff" text-anchor="end">QTY</text>`;
  out += `<text x="${tx + tw - 24}" y="${ty + 31}" font-size="20" font-weight="700" fill="#e8f0ff" text-anchor="end">UNIT</text>`;
  ty += rowH;
  for (const [item, qty, unit] of lines) {
    out += `<line x1="${tx}" y1="${ty + rowH}" x2="${tx + tw}" y2="${ty + rowH}" stroke="#ddd" stroke-width="1"/>`;
    out += `<text x="${tx + 16}" y="${ty + 31}" font-size="19" fill="#111">${esc(item)}</text>`;
    out += `<text x="${tx + tw - 200}" y="${ty + 31}" font-size="19" fill="#111" text-anchor="end">${esc(qty)}</text>`;
    out += `<text x="${tx + tw - 24}" y="${ty + 31}" font-size="19" fill="#555" text-anchor="end">${esc(unit)}</text>`;
    ty += rowH;
  }
  out += `<text x="${tx}" y="${ty + 36}" font-size="16" fill="#7a1010">Quantities are best-effort estimates from the model — not a manufacturer-quoted material list.</text>`;
  return out;
}

/**
 * FP-D details body — renders a generated section/elevation detail when one is
 * supplied (the Phase-4 section entities), else a stock "details to be added"
 * note. The section is drawn in section coords (u along, v elevation up).
 */
function bodyDetails(section) {
  const r = drawRect();
  let out = '';
  out += `<text x="${r.x}" y="${r.y + 8}" font-size="28" font-weight="700" fill="#111">DETAILS / SECTIONS</text>`;
  if (!section || !section.ok || !Array.isArray(section.entities) || !section.entities.length) {
    out += `<rect x="${r.x + 24}" y="${r.y + 56}" width="${r.w - 64}" height="${r.h - 120}" fill="#fafafa" stroke="#bbb" stroke-width="1.5" stroke-dasharray="10 8"/>`;
    out += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="26" fill="#999" text-anchor="middle">No section placed. Use the Section / elevation cut tool, then regenerate the sheet set to embed a detail here.</text>`;
    return out;
  }
  const b = section.bounds;
  const inner = { x: r.x + 40, y: r.y + 80, w: r.w - 120, h: r.h - 180 };
  const du = Math.max(b.u1 - b.u0, 1), dv = Math.max(b.v1 - b.v0, 1);
  const sc = Math.min(inner.w / du, inner.h / dv);
  const ox = inner.x, oy = inner.y + inner.h;
  const X = (u) => ox + (u - b.u0) * sc;
  const Y = (v) => oy - (v - b.v0) * sc;
  out += `<text x="${r.x + 24}" y="${r.y + 56}" font-size="22" font-weight="700" fill="#b71c1c">${esc(section.label || 'Section')}</text>`;
  const COL = { wall: '#6b7280', column: '#8a8f98', main: '#d32f2f', branch: '#1565c0', drop: '#0891b2', riser: '#f59e0b', pipe: '#555', head: '#b71c1c' };
  const entCol = (e) => (e.kind === 'pipe' ? (COL[e.role] || COL.pipe) : (COL[e.kind] || '#888'));
  // datum lines
  for (const e of section.entities) {
    if (e.type !== 'datum') continue;
    out += `<line x1="${round(X(b.u0))}" y1="${round(Y(e.v))}" x2="${round(X(b.u1))}" y2="${round(Y(e.v))}" stroke="#aaa" stroke-width="1" stroke-dasharray="6 4"/>`;
    out += `<text x="${round(X(b.u0)) + 4}" y="${round(Y(e.v)) - 4}" font-size="14" fill="#888">${esc(e.label)}</text>`;
  }
  const draw = (e) => {
    const col = entCol(e); const op = e.cut ? 1 : 0.4;
    if (e.type === 'rect') {
      const x0 = X(Math.min(e.u0, e.u1)), x1 = X(Math.max(e.u0, e.u1));
      const y0 = Y(e.v1), y1 = Y(e.v0);
      out += `<rect x="${round(x0)}" y="${round(y0)}" width="${round(Math.max(2, x1 - x0))}" height="${round(Math.max(2, y1 - y0))}" fill="${col}" fill-opacity="${op * 0.5}" stroke="${col}" stroke-width="${e.cut ? 2 : 1}"/>`;
    } else if (e.type === 'line') {
      out += `<line x1="${round(X(e.a[0]))}" y1="${round(Y(e.a[1]))}" x2="${round(X(e.b[0]))}" y2="${round(Y(e.b[1]))}" stroke="${col}" stroke-width="${e.cut ? 3 : 1.5}" stroke-opacity="${op}"/>`;
    } else if (e.type === 'head') {
      const cx = X(e.u), cy = Y(e.v);
      out += `<circle cx="${round(cx)}" cy="${round(cy)}" r="5" fill="none" stroke="${col}" stroke-width="1.8" stroke-opacity="${op}"/>`;
    }
  };
  section.entities.filter((e) => e.type !== 'datum' && !e.cut).forEach(draw);
  section.entities.filter((e) => e.type !== 'datum' && e.cut).forEach(draw);
  out += `<text x="${r.x + 24}" y="${r.y + r.h + 4}" font-size="15" fill="#7a1010">${esc(section.disclaimer || 'Geometric projection — not a PE-stamped detail.')}</text>`;
  return out;
}

/* ── public builder ──────────────────────────────────────────────────────── */

/**
 * Group the model solids by level using head/pipe Z elevation against level
 * elevations. Returns Map<levelIdx, solids[]>. When no levels are supplied,
 * everything goes to a single level 1.
 */
function groupSolidsByLevel(solids, levels) {
  if (!Array.isArray(levels) || levels.length <= 1) {
    return [{ label: (levels && levels[0] && (levels[0].name)) || 'Level 1', level: (levels && levels[0] && levels[0].level) || 1, solids }];
  }
  const sorted = levels.slice().sort((a, b) => num(a.elevationFt) - num(b.elevationFt));
  const buckets = sorted.map((l) => ({ label: l.name || ('Level ' + l.level), level: l.level, z: num(l.elevationFt, 0), solids: [] }));
  const zOf = (s) => {
    if (s.kind === 'head' && Array.isArray(s.position)) return num(s.position[2], 0);
    if (s.kind === 'pipe' && Array.isArray(s.from)) return (num(s.from[2], 0) + num(s.to[2], 0)) / 2;
    return null;
  };
  // walls/columns have no Z bucket reliably -> put on every level's plan (shared structure)
  const shared = solids.filter((s) => s.kind === 'wall' || s.kind === 'column');
  for (const b of buckets) b.solids.push(...shared);
  for (const s of solids) {
    if (s.kind === 'wall' || s.kind === 'column') continue;
    const z = zOf(s);
    if (z == null) { buckets[0].solids.push(s); continue; }
    let best = 0, bestD = Infinity;
    buckets.forEach((b, i) => { const d = Math.abs(b.z - z); if (d < bestD) { bestD = d; best = i; } });
    buckets[best].solids.push(s);
  }
  return buckets;
}

/**
 * Build the full submittal sheet set.
 *
 * @param {object} input
 *   @param {{solids:Array}} input.cadModel        the live model
 *   @param {object} [input.hydraulicReport]       __hf3.report (buildHydraulicReport output)
 *   @param {object} [input.bom]                   __hfBomTakeoff
 *   @param {object} [input.section]               last generated section (FP-D detail)
 *   @param {Array}  [input.levels]                level metadata [{level,name,elevationFt}]
 *   @param {object} [input.project]               {name,address,client,designer,date,scale,system}
 * @returns {{ sheets, sheetIds, hasTitleblock, exportReady, disclaimer, generatedAt }}
 */
export function buildSubmittalSheets(input = {}) {
  const cadModel = input.cadModel || {};
  const solids = Array.isArray(cadModel.solids) ? cadModel.solids : [];
  const report = input.hydraulicReport || null;
  const bom = input.bom || null;
  const section = input.section || null;
  const levels = Array.isArray(input.levels) ? input.levels : [];
  const p = input.project || {};

  const project = p.name || cadModel.name || 'HaloFire AutoSPRINK — design model';
  const tbBase = {
    project,
    address: p.address || null,
    client: p.client || null,
    designer: p.designer || 'HaloFire AutoSPRINK clone',
    date: p.date || (typeof input.generatedAt === 'string' ? input.generatedAt.slice(0, 10) : null),
    system: p.system || (report && report.meta && report.meta.system) || 'Wet-pipe sprinkler system',
    scale: p.scale || 'NTS',
  };

  const levelGroups = groupSolidsByLevel(solids, levels);

  // ── assemble the ordered sheet plan (codes + titles) ──
  const plan = [];
  plan.push({ code: 'FP-0', title: 'Cover / Sheet Index', kind: 'cover' });
  plan.push({ code: 'FP-H', title: 'Hydraulic Design Placard', kind: 'hydraulic' });
  levelGroups.forEach((g, i) => {
    const suffix = levelGroups.length > 1 ? String(i + 1) : '';
    plan.push({ code: 'FP-N' + suffix, title: g.label + ' Sprinkler Plan', kind: 'plan', group: g, scale: 'AS NOTED' });
  });
  plan.push({ code: 'FP-R', title: 'Riser Diagram', kind: 'riser' });
  plan.push({ code: 'FP-B', title: 'Bill of Materials', kind: 'bom' });
  plan.push({ code: 'FP-D', title: 'Details / Sections', kind: 'details' });

  const sheetIndex = plan.map((s) => ({ code: s.code, title: s.title }));
  const total = plan.length;

  const sheets = plan.map((s, i) => {
    const tb = {
      ...tbBase,
      sheetCode: s.code,
      sheetNo: i + 1,
      sheetTotal: total,
      scale: s.scale || tbBase.scale,
    };
    let body = '';
    if (s.kind === 'cover') body = bodyCover({ project, address: tbBase.address }, sheetIndex);
    else if (s.kind === 'hydraulic') body = bodyHydraulic(report);
    else if (s.kind === 'plan') body = bodyPlan(s.group.solids, s.group.label);
    else if (s.kind === 'riser') body = bodyRiser(solids, levels);
    else if (s.kind === 'bom') body = bodyBom(bom);
    else if (s.kind === 'details') body = bodyDetails(section);
    return {
      id: s.code,
      code: s.code,
      title: s.title,
      kind: s.kind,
      w: SHEET_W,
      h: SHEET_H,
      titleblock: tb,
      svg: wrapSheet(body, tb),
    };
  });

  return {
    sheets,
    sheetIds: sheets.map((x) => x.id),
    hasTitleblock: true,
    exportReady: sheets.length > 0 && solids.length > 0,
    sheetCount: sheets.length,
    hasHydraulics: !!(report && report.summary),
    hasBom: !!bom,
    hasSection: !!(section && section.ok && Array.isArray(section.entities) && section.entities.length),
    disclaimer: SUBMITTAL_SHEETS_DISCLAIMER,
    generatedAt: input.generatedAt || null,
  };
}

/**
 * Render the whole sheet set as a single self-contained, printable HTML document
 * (one sheet per page, page-break between). Pure string build.
 */
export function renderSheetSetHtml(set, opts = {}) {
  if (!set || !Array.isArray(set.sheets)) return '';
  const title = esc((opts.project || (set.sheets[0] && set.sheets[0].titleblock && set.sheets[0].titleblock.project)) || 'HaloFire Submittal');
  const pages = set.sheets.map((sh) =>
    `<section class="sheet"><div class="sheetcap">${esc(sh.code)} — ${esc(sh.title)}</div>${sh.svg}</section>`
  ).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Submittal Set</title>
<style>
  @page { size: 34in 22in landscape; margin: 0; }
  body { margin:0; background:#555; font-family:Arial,Helvetica,sans-serif; }
  .sheet { width: 100%; background:#fff; margin:0 auto 24px; box-shadow:0 4px 18px rgba(0,0,0,.4); page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .sheetcap { font-size:12px; color:#fff; background:#222; padding:4px 10px; }
  svg { display:block; width:100%; height:auto; }
  @media print { body { background:#fff; } .sheetcap { display:none; } .sheet { box-shadow:none; margin:0; } }
</style></head><body>
${pages}
</body></html>`;
}
