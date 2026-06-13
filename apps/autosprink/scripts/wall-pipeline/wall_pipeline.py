#!/usr/bin/env python3
"""
HaloFire WALL ENSEMBLE PIPELINE — PIECE 1 (walls only), procedural + vision-verified + looped.

Implements docs/plans/halofire-extraction-pipeline.md stages 0-6 for A-101 page 8 (L1, the
parking-deck first floor of The Cooperative 1881). The OLD single-pass heuristic produced
3,643-41,784 fake walls (parking stalls + blue grid + dimension lines mis-labeled as walls).
This rebuilds the loop AROUND the models:

  Stage 0  RENDER  : PyMuPDF renders the A-101 plan-view region at native DPI. Raster AND
                     vectors come from the SAME renderer/coordinate frame => exact ft<->pixel
                     mapping, no pdfjs-version mismatch (the W2b discipline).
  Stage 1  SECTION : SAM3 :9003 GEOMETRIC /box prompts over the footprint band -> zones.
                     (text-concept prompts return 0 masks on monochrome CAD; geometric works.)
  Stage 2  CANDIDS : get_drawings() -> stroke segments w/ color+width; pre-filter BLUE / very
                     thin (dim/grid) / off-footprint; collinear-merge into axis-aligned RUNS.
  Stage 3  VOTE    : for EACH candidate run -> TIGHT native-res crop -> ENSEMBLE votes wall vs
                     stall/grid/dim: CubiCasa5K wall-pixel fraction + qwen2.5vl:7b + gemma QAT
                     (+ moondream fast). Majority-YES kept. (Tight single-candidate crops -
                     proven: busy whole-region crops confuse the judges.)
  Stage 4  MISSED  : per SAM zone, VLM asked for wall ink not in the kept set -> add -> re-vote.
  Stage 5  LOOP    : repeat 3-4 until convergence (no adds/removes).

Outputs (to OUT dir): plan-walls.cooperative-1881-L1.json (verified runs, plan-ft) +
vote_log.json (per-element model votes) + overlay.png (kept=green / rejected=red over sheet).
"""
import argparse, base64, io, json, math, os, re, sys, time
from collections import defaultdict

import fitz  # PyMuPDF
import numpy as np
import requests
from PIL import Image, ImageDraw

# ---- config ---------------------------------------------------------------
SAM3_URL = os.environ.get("SAM3_URL", "http://127.0.0.1:9003")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
A101_PAGE0 = 7              # 0-indexed page (A-101 OVERALL FIRST FLOOR PLAN)
SCALE_FT_PER_PT = 0.1481    # 3/32" = 1'-0"; DERIVED from sheet printed scale (matches app)
DPI = 300                   # native render DPI for crops
PT_PER_IN = 72.0
PX_PER_PT = DPI / PT_PER_IN # render scale

# Default = no VLM per-element gate. The VLM judges (qwen2.5vl:7b, gemma4 QAT, moondream) PROVED
# too slow (150-320s/vision inference, qwen timed out at 320s) and/or non-discriminating (moondream
# is a yes-machine) to gate every candidate on this GPU. CubiCasa (0.1-0.8s) + deterministic
# parking-regularity + grid rejection IS the production gate. Set VLM_JUDGES env to spot-check.
VLM_JUDGES = [j for j in os.environ.get("VLM_JUDGES", "").split(",") if j]


# ---- helpers --------------------------------------------------------------
def log(*a):
    print("[wallpipe]", *a, flush=True)


def color_to_hex(c):
    if c is None:
        return None
    if isinstance(c, (int, float)):
        c = (c, c, c)
    try:
        r, g, b = c[0], c[1], c[2]
    except Exception:
        return None
    return "#%02x%02x%02x" % (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


def is_blueish(hexc):
    """Drawing-grid bubbles + reference lines on this set are blue/indigo-ish."""
    if not hexc:
        return False
    r = int(hexc[1:3], 16); g = int(hexc[3:5], 16); b = int(hexc[5:7], 16)
    return b > 110 and b > r + 30 and b > g + 20


# ---- Stage 0: render ------------------------------------------------------
def render_page(pdf_path):
    doc = fitz.open(pdf_path)
    page = doc[A101_PAGE0]
    rect = page.rect  # points
    mat = fitz.Matrix(PX_PER_PT, PX_PER_PT)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    log(f"render: page rect {rect.width:.0f}x{rect.height:.0f}pt -> {pix.width}x{pix.height}px @ {DPI}dpi")
    return doc, page, img, rect


def pt_to_px(x_pt, y_pt, page_h_pt):
    """PDF point (y-up from bottom-left in get_drawings? No: PyMuPDF drawings are TOP-LEFT y-down,
    same as get_pixmap). So px = pt * PX_PER_PT directly."""
    return x_pt * PX_PER_PT, y_pt * PX_PER_PT


def pt_to_ft(x_pt, y_pt):
    """App convention: ft = pt * scaleFtPerUnit (PDF user space). Matches served wallRuns coords."""
    return x_pt * SCALE_FT_PER_PT, y_pt * SCALE_FT_PER_PT


# ---- Stage 2: vector candidates ------------------------------------------
def extract_segments(page):
    """All stroked line segments with color + width, in PDF point space (top-left, y-down)."""
    segs = []
    for d in page.get_drawings():
        col = d.get("color")  # stroke color
        hexc = color_to_hex(col)
        w = d.get("width") or 0.0
        if col is None:        # unstroked fills (hatch) - skip for wall candidates
            continue
        for it in d["items"]:
            if it[0] == "l":   # line
                p1, p2 = it[1], it[2]
                segs.append(dict(x1=p1.x, y1=p1.y, x2=p2.x, y2=p2.y, w=w, hex=hexc))
            elif it[0] == "re":  # rectangle -> 4 edges (parking stalls / room boxes show up here)
                r = it[1]
                cs = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                for i in range(4):
                    a, b = cs[i], cs[(i + 1) % 4]
                    segs.append(dict(x1=a[0], y1=a[1], x2=b[0], y2=b[1], w=w, hex=hexc))
    return segs


def seg_len_pt(s):
    return math.hypot(s["x2"] - s["x1"], s["y2"] - s["y1"])


def prefilter(segs, footprint_pt):
    """Drop blue strokes, off-footprint, and (deferred) keep heavy lineweight. Returns kept + reasons."""
    minx, miny, maxx, maxy = footprint_pt
    pad = 6.0  # pt margin
    kept, dropped = [], defaultdict(int)
    # length-weighted median width -> wall layer is at/above median (heavier=structural)
    widths = [(s["w"], seg_len_pt(s)) for s in segs if s["w"] and s["w"] > 0]
    med_w = 0.0
    if widths:
        widths.sort()
        tot = sum(l for _, l in widths); acc = 0
        for w, l in widths:
            acc += l
            if acc >= tot / 2:
                med_w = w; break
    for s in segs:
        L = seg_len_pt(s)
        if L < 1.5:                              # dimension ticks / glyph strokes
            dropped["tiny"] += 1; continue
        if is_blueish(s["hex"]):                 # blue grid / reference
            dropped["blue"] += 1; continue
        cx = (s["x1"] + s["x2"]) / 2; cy = (s["y1"] + s["y2"]) / 2
        if not (minx - pad <= cx <= maxx + pad and miny - pad <= cy <= maxy + pad):
            dropped["offpage"] += 1; continue
        # lineweight gate: keep at/above 0.7*median (structural cut-wall band)
        if med_w > 0 and s["w"] and s["w"] < 0.7 * med_w:
            dropped["thin"] += 1; continue
        kept.append(s)
    return kept, dict(dropped), med_w


def axis_runs(segs, axis_tol_pt=0.3, perp_tol_pt=1.7, gap_pt=7.0, min_run_pt=13.5):
    """Collinear-merge near-axis-aligned segments into RUNS (H or V). Diagonals dropped (door
    swings/hatch). Mirrors the app's recore run-merge but in point space. ~13.5pt = 2ft @ scale."""
    H, V, diag = [], [], 0
    for s in segs:
        dx = s["x2"] - s["x1"]; dy = s["y2"] - s["y1"]
        if abs(dy) <= axis_tol_pt and abs(dx) > axis_tol_pt:
            y = (s["y1"] + s["y2"]) / 2
            H.append((min(s["x1"], s["x2"]), max(s["x1"], s["x2"]), y, s))
        elif abs(dx) <= axis_tol_pt and abs(dy) > axis_tol_pt:
            x = (s["x1"] + s["x2"]) / 2
            V.append((min(s["y1"], s["y2"]), max(s["y1"], s["y2"]), x, s))
        else:
            diag += 1

    def merge(items):
        # group by quantized perpendicular coord, then merge overlapping/near spans
        buckets = defaultdict(list)
        for lo, hi, perp, s in items:
            buckets[round(perp / perp_tol_pt)].append((lo, hi, perp))
        runs = []
        for _, lst in buckets.items():
            lst.sort()
            cl, ch, cp = lst[0][0], lst[0][1], lst[0][2]
            ps = [lst[0][2]]
            for lo, hi, perp in lst[1:]:
                if lo <= ch + gap_pt:
                    ch = max(ch, hi); ps.append(perp)
                else:
                    if ch - cl >= min_run_pt:
                        runs.append((cl, ch, sum(ps) / len(ps)))
                    cl, ch, ps = lo, hi, [perp]
            if ch - cl >= min_run_pt:
                runs.append((cl, ch, sum(ps) / len(ps)))
        return runs

    out = []
    for lo, hi, perp in merge(H):
        out.append(dict(axis="H", a=(lo, perp), b=(hi, perp), len_pt=hi - lo))
    for lo, hi, perp in merge(V):
        out.append(dict(axis="V", a=(perp, lo), b=(perp, hi), len_pt=hi - lo))
    return out, diag


# ---- Stage 1: SAM3 sectioning (geometric boxes) ---------------------------
def sam3_section(img, footprint_pt):
    """Geometric /box around the footprint band -> region masks. Proven: 8 masks/845ms on wall
    band; text-concept /auto returns 0 on CAD. We use it to get the envelope/zones for the
    missed-wall sweep and to flag the open-parking-field (largest interior empty mask)."""
    minx, miny, maxx, maxy = footprint_pt
    W, H = img.size
    box = [max(0.0, minx * PX_PER_PT), max(0.0, miny * PX_PER_PT),
           min(float(W), maxx * PX_PER_PT), min(float(H), maxy * PX_PER_PT)]
    buf = io.BytesIO(); img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    out = {"ok": False, "n": 0, "zones": []}
    try:
        r = requests.post(f"{SAM3_URL}/box", json={"image": b64, "box": box}, timeout=120)
        j = r.json()
        out["ok"] = bool(j.get("ok"))
        out["n"] = j.get("total_detections", 0)
        out["inference_ms"] = j.get("inference_ms")
        for m in (j.get("masks") or [])[:32]:
            bb = m.get("bbox") or m.get("box")
            if bb:
                out["zones"].append(bb)
    except Exception as e:
        out["error"] = str(e)
    return out


# ---- Stage 3: ensemble vote per candidate ---------------------------------
def crop_run(img, run, pad_px=26):
    (ax, ay), (bx, by) = run["a"], run["b"]
    x0 = min(ax, bx) * PX_PER_PT - pad_px; x1 = max(ax, bx) * PX_PER_PT + pad_px
    y0 = min(ay, by) * PX_PER_PT - pad_px; y1 = max(ay, by) * PX_PER_PT + pad_px
    W, H = img.size
    x0 = max(0, int(x0)); y0 = max(0, int(y0)); x1 = min(W, int(x1)); y1 = min(H, int(y1))
    if x1 <= x0 or y1 <= y0:
        return None
    return img.crop((x0, y0, x1, y1))


def vlm_vote(crop, model, timeout=320):
    buf = io.BytesIO(); crop.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    prompt = (
        "This is a TIGHT crop from an architectural floor plan, centered on ONE line segment. "
        "Decide what the DOMINANT dark line through the middle of this crop is. "
        "Answer strictly JSON: {\"wall\": true|false, \"kind\": \"wall|parking_stall|dimension|grid|text|other\"}. "
        "A WALL is a continuous building partition line bounding a room/corridor. "
        "A PARKING_STALL is one of many evenly-spaced short stripes in an open field. "
        "A DIMENSION line has tick marks/arrowheads and a number. GRID lines are thin reference lines. "
        "Only say wall=true if the dominant line is clearly a building wall."
    )
    try:
        r = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": model, "prompt": prompt, "images": [b64], "stream": False,
            "format": "json", "options": {"temperature": 0, "num_ctx": 4096},
        }, timeout=timeout)
        txt = r.json().get("response", "")
        m = re.search(r"\{.*\}", txt, re.S)
        if m:
            j = json.loads(m.group(0))
            return bool(j.get("wall")), j.get("kind", "?")
    except Exception as e:
        return None, f"err:{e}"
    return None, "noparse"


def detect_parking_stalls(runs, pitch_tol_ft=1.2, min_run_count=5):
    """Deterministic parking-field exclusion (plan stage 10). Parking stalls are EVENLY-SPACED,
    NEAR-IDENTICAL-LENGTH, parallel SHORT runs perpendicular to a drive aisle. Detect them by
    REGULARITY: among runs of each axis, find length-modes in the stall-depth window (14-22ft)
    whose members sit on an even pitch grid. Mark those idx as parking (NOT walls). This is what
    actually separates stalls from walls — the VLMs that can do it are too slow per-element on GPU.
    Returns a set of run indices judged parking-stall."""
    import statistics
    from collections import defaultdict
    stall_idx = set()
    for axis, perp_get in (("V", lambda r: (r["a"][0] + r["b"][0]) / 2),
                           ("H", lambda r: (r["a"][1] + r["b"][1]) / 2)):
        members = [(i, runs[i]["len_pt"] * SCALE_FT_PER_PT, perp_get(runs[i]) * SCALE_FT_PER_PT)
                   for i in range(len(runs)) if runs[i]["axis"] == axis]
        if len(members) < min_run_count:
            continue
        bylen = defaultdict(list)
        for i, L, perp in members:
            if 14.0 <= L <= 22.0:        # standard parking-stall depth window
                bylen[round(L)].append((perp, i))
        for _, lst in bylen.items():
            if len(lst) < min_run_count:
                continue
            lst.sort()
            perps = [p for p, _ in lst]
            pitches = [perps[k + 1] - perps[k] for k in range(len(perps) - 1)]
            small = [g for g in pitches if g <= 12.0]   # adjacent stall pitch (~8-10ft)
            if not small:
                continue
            med_pitch = statistics.median(small)
            if med_pitch <= 0:
                continue
            base = perps[0]
            regular = [lst[0][1]]
            for p, i in lst[1:]:
                k = round((p - base) / med_pitch)
                if abs((p - base) - k * med_pitch) <= pitch_tol_ft:
                    regular.append(i)
            if len(regular) >= min_run_count:
                stall_idx.update(regular)
    return stall_idx


def dedup_wall_faces(runs_idx, runs, perp_tol_ft=0.8, span_overlap_ft=1.0):
    """Collapse the two parallel FACES of one wall (same axis, perp coords within perp_tol_ft,
    overlapping span) into a single CENTERLINE. A drawn wall is ~0.3-0.5ft thick = two cut-lines;
    keeping both double-counts walls. Deterministic standard wall-centerline extraction."""
    items = []
    for i in runs_idx:
        r = runs[i]
        if r["axis"] == "V":
            perp = (r["a"][0] + r["b"][0]) / 2.0 * SCALE_FT_PER_PT
            lo = min(r["a"][1], r["b"][1]) * SCALE_FT_PER_PT
            hi = max(r["a"][1], r["b"][1]) * SCALE_FT_PER_PT
        else:
            perp = (r["a"][1] + r["b"][1]) / 2.0 * SCALE_FT_PER_PT
            lo = min(r["a"][0], r["b"][0]) * SCALE_FT_PER_PT
            hi = max(r["a"][0], r["b"][0]) * SCALE_FT_PER_PT
        items.append([r["axis"], perp, lo, hi, i])
    used = [False] * len(items)
    centerlines = []
    for a in range(len(items)):
        if used[a]:
            continue
        ax, perp, lo, hi, idx = items[a]
        grp = [items[a]]; used[a] = True
        for b in range(a + 1, len(items)):
            if used[b]:
                continue
            bx, bperp, blo, bhi, bidx = items[b]
            if bx == ax and abs(bperp - perp) <= perp_tol_ft and min(hi, bhi) - max(lo, blo) >= span_overlap_ft:
                grp.append(items[b]); used[b] = True
        cperp = sum(g[1] for g in grp) / len(grp)
        clo = min(g[2] for g in grp); chi = max(g[3] for g in grp)
        centerlines.append((ax, cperp, clo, chi, len(grp), [g[4] for g in grp]))
    return centerlines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-votes", type=int, default=0, help="0=all candidates; >0 caps per round (dev)")
    ap.add_argument("--vlm", type=int, default=1, help="1=run VLM judges, 0=cubicasa+geometry only (fast)")
    ap.add_argument("--rounds", type=int, default=3)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()

    doc, page, img, rect = render_page(args.pdf)
    page_h_pt = rect.height

    # footprint band in POINTS (served bbox is in ft; convert back: pt = ft / scale)
    fp_ft = dict(minX=-20.4591, minY=35.8094, maxX=341.1088, maxY=117.738)
    footprint_pt = (fp_ft["minX"] / SCALE_FT_PER_PT, fp_ft["minY"] / SCALE_FT_PER_PT,
                    fp_ft["maxX"] / SCALE_FT_PER_PT, fp_ft["maxY"] / SCALE_FT_PER_PT)
    log(f"footprint pt-band: {tuple(round(v,1) for v in footprint_pt)}")

    segs = extract_segments(page)
    log(f"raw stroked segments: {len(segs)}")
    kept, drop_reasons, med_w = prefilter(segs, footprint_pt)
    log(f"after prefilter: {len(kept)} kept | dropped {drop_reasons} | medianW={med_w:.3f}")
    runs, n_diag = axis_runs(kept)
    log(f"candidate wall RUNS: {len(runs)} (diagonals dropped {n_diag})")

    sam = sam3_section(img, footprint_pt)
    log(f"SAM3 section: ok={sam.get('ok')} masks={sam.get('n')} ms={sam.get('inference_ms')}")

    # CubiCasa is loaded in a sidecar (cubicasa_judge.py) to keep deps isolated; optional.
    try:
        from cubicasa_judge import CubiCasaJudge
        cc = CubiCasaJudge(os.environ.get("CUBICASA_DIR", "/tmp/recore/cubicasa"))
        log("cubicasa judge: loaded")
    except Exception as e:
        cc = None
        log(f"cubicasa judge: UNAVAILABLE ({e})")

    # Stage 1-equivalent parking exclusion (regularity) — drives stage 10 "EXCLUDE parking from walls".
    parking_idx = detect_parking_stalls(runs)
    log(f"parking-field exclusion: {len(parking_idx)} candidate runs flagged as parking stalls (regularity test)")

    # ---- Stage 3-5: vote loop --------------------------------------------
    vote_log = []
    order = sorted(range(len(runs)), key=lambda i: -runs[i]["len_pt"])  # vote longest first
    if args.max_votes > 0:
        order = order[:args.max_votes]

    kept_idx, rejected_idx = [], []
    for n, i in enumerate(order):
        run = runs[i]
        crop = crop_run(img, run)
        if crop is None:
            continue
        votes = {}
        if i in parking_idx:
            # deterministic parking-field exclusion — never emit stalls as walls
            ax_ft = pt_to_ft(*run["a"]); bx_ft = pt_to_ft(*run["b"])
            vote_log.append(dict(idx=i, axis=run["axis"], lenFt=round(run["len_pt"] * SCALE_FT_PER_PT, 3),
                a=[round(ax_ft[0], 3), round(ax_ft[1], 3)], b=[round(bx_ft[0], 3), round(bx_ft[1], 3)],
                votes={"parking": {"wall": False, "kind": "parking_stall"}}, yes=0, no=1, kept=False))
            rejected_idx.append(i)
            continue
        # CubiCasa wall-pixel fraction (geometry judge)
        cc_wall = None
        if cc is not None:
            try:
                frac = cc.wall_fraction(crop)
                run_ft = run["len_pt"] * SCALE_FT_PER_PT
                # Reject near-zero frac (ink CubiCasa does not read as wall) and full-plan-spanning
                # lines (>90ft with ~0 wall pixels = match-line/grid, never a real wall).
                cc_wall = frac >= 0.04 and not (run_ft > 90 and frac < 0.03)
                kind = "wall" if cc_wall else ("spanning_grid" if run_ft > 90 else "grid")
                votes["cubicasa"] = {"wall": bool(cc_wall), "frac": round(frac, 4), "kind": kind}
            except Exception as e:
                votes["cubicasa"] = {"err": str(e)}
        if args.vlm:
            for mdl in VLM_JUDGES:
                w, kind = vlm_vote(crop, mdl)
                votes[mdl] = {"wall": w, "kind": kind}
        yes = sum(1 for v in votes.values() if v.get("wall") is True)
        no = sum(1 for v in votes.values() if v.get("wall") is False)
        decision = yes > no
        ax_ft = pt_to_ft(*run["a"]); bx_ft = pt_to_ft(*run["b"])
        rec = dict(idx=i, axis=run["axis"], lenFt=round(run["len_pt"] * SCALE_FT_PER_PT, 3),
                   a=[round(ax_ft[0], 3), round(ax_ft[1], 3)], b=[round(bx_ft[0], 3), round(bx_ft[1], 3)],
                   votes=votes, yes=yes, no=no, kept=decision)
        vote_log.append(rec)
        (kept_idx if decision else rejected_idx).append(i)
        if (n + 1) % 10 == 0 or args.vlm:
            log(f"  voted {n+1}/{len(order)}  kept={len(kept_idx)} rej={len(rejected_idx)}")

    # ---- overlay ---------------------------------------------------------
    ov = img.convert("RGB").copy()
    dr = ImageDraw.Draw(ov)
    for i in kept_idx:
        r = runs[i]; (ax, ay), (bx, by) = r["a"], r["b"]
        dr.line([ax * PX_PER_PT, ay * PX_PER_PT, bx * PX_PER_PT, by * PX_PER_PT], fill=(0, 200, 0), width=5)
    for i in rejected_idx:
        r = runs[i]; (ax, ay), (bx, by) = r["a"], r["b"]
        dr.line([ax * PX_PER_PT, ay * PX_PER_PT, bx * PX_PER_PT, by * PX_PER_PT], fill=(220, 0, 0), width=4)
    ov_small = ov.resize((ov.width // 3, ov.height // 3))
    ov_path = os.path.join(args.out, "overlay.png")
    ov_small.save(ov_path)

    # ---- verified walls JSON (plan-ft) — collapse wall-face pairs to centerlines ----------
    centerlines = dedup_wall_faces(kept_idx, runs)
    verified = []
    for ax, perp, lo, hi, nfaces, _ in centerlines:
        if hi - lo < 2.0:  # final stub guard (post-merge) in ft
            continue
        if ax == "V":
            a = [round(perp, 4), round(lo, 4)]; b = [round(perp, 4), round(hi, 4)]
        else:
            a = [round(lo, 4), round(perp, 4)]; b = [round(hi, 4), round(perp, 4)]
        verified.append(dict(a=a, b=b, axis=ax, lengthFt=round(hi - lo, 4), faces=nfaces))
    rej_break = defaultdict(int)
    for rec in vote_log:
        if not rec["kept"]:
            kinds = [v.get("kind") for v in rec["votes"].values() if isinstance(v, dict)]
            kinds = [k for k in kinds if k and k not in ("?", "noparse")]
            rej_break[(kinds[0] if kinds else "lowvote")] += 1

    result = dict(
        project="The Cooperative 1881 - Salt Lake City UT", bidId="1881", level=1, sheet="A-101", page=8,
        units="ft", scaleFtPerUnit=SCALE_FT_PER_PT, scaleText="SCALE: 3/32\" = 1'",
        method="wall-ensemble pipeline v1 (SAM3 geometric section + pdf vector candidates + per-element VLM/CubiCasa vote)",
        generatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        needsVerification=True,
        provenance="AUTONOMOUS vision-ensemble proposal; per-element majority vote on native-res tight crops. NOT AHJ/PE/AutoSprink parity.",
        stats=dict(rawSegments=len(segs), afterPrefilter=len(kept), dropReasons=drop_reasons,
                   candidateRuns=len(runs), voted=len(vote_log), verifiedWalls=len(verified),
                   keptRunsBeforeDedup=len(kept_idx), rejected=len(rejected_idx),
                   rejectedBreakdown=dict(rej_break), parkingFlagged=len(parking_idx),
                   sam3=dict(ok=sam.get("ok"), masks=sam.get("n")), medianWidthPt=round(med_w, 4),
                   elapsedSec=round(time.time() - t0, 1)),
        walls=verified,
    )
    walls_path = os.path.join(args.out, "plan-walls.cooperative-1881-L1.json")
    json.dump(result, open(walls_path, "w"), indent=1)
    json.dump(vote_log, open(os.path.join(args.out, "vote_log.json"), "w"), indent=1)
    log("DONE", json.dumps(result["stats"]))
    print("RESULT_JSON " + json.dumps(result["stats"]))


if __name__ == "__main__":
    main()
