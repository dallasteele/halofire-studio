#!/usr/bin/env python3
"""Phase D.3 — author OpenSCAD files from the phase_d_manifest.json.

Reads `data/phase_d_manifest.json` and emits one .scad file per entry
into `packages/halofire-catalog/authoring/scad/`, using the annotation
grammar documented in `packages/halofire-catalog/AGENTS.md`.

Design notes
------------
* Manifest `kind` is normalised to the canonical `PartKind` set
  (`sprinkler_head`, `pipe_segment`, `fitting`, `valve`, `hanger`,
  `device`). Anything else is skipped with a warning.
* Manifest port `style` uses raw strings like `threaded_m`, `plain_end`,
  `threaded_f`. These are mapped to `NPT_threaded` / `grooved` / `none`
  from the schema's `CatalogPortStyleSchema`.
* Manifest port `role` is `inlet` / `outlet`. Mapped to `run_a` / `run_b`,
  with a synthesised `branch` port for tee fittings.
* Manifest port `size` like `"1/2NPT"` / `"2grooved"` is parsed into a
  numeric `size_in`.
* Categories are normalised to lowercase dotted tokens `[a-z0-9.]+` (underscores
  in the manifest like `hanger.swivel_ring` become `hanger.swivel.ring`).
* `.scad` stems must match the `@part` slug, and slugs must be stable
  filesystem names — we sanitise manifest `sku_intent` to
  `[a-z0-9_]` using the same regex the existing repo uses.
* Geometry is a mechanical approximation; the viewport doesn't need
  decorative detail.

Skip policy
-----------
* Entry is skipped (with a report line) only if required fields are
  missing (no `sku_intent`, no `display_name`, no `kind`, or kind cannot
  be normalised). `dims`/`ports` being empty is tolerated — we fall back
  to kind-specific defaults so every manifest entry is authored.
* Price/install_minutes flagged in `_estimate_fields` are emitted as-is
  (the caller is already aware they are seeds; D.4 will replace).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "data" / "phase_d_manifest.json"
SCAD_DIR = REPO_ROOT / "packages" / "halofire-catalog" / "authoring" / "scad"

# Manifest kind -> canonical PartKind
KIND_MAP = {
    "sprinkler_head": "sprinkler_head",
    "pipe": "pipe_segment",
    "fitting": "fitting",
    "valve": "valve",
    "hanger": "hanger",  # includes braces per manifest
    "switch": "device",
    "trim": "device",
}

# Manifest port style -> canonical ConnectionStyle
STYLE_MAP = {
    "threaded_m": "NPT_threaded",
    "threaded_f": "NPT_threaded",
    "NPT_threaded": "NPT_threaded",
    "grooved": "grooved",
    "plain_end": "grooved",  # plain-end black steel usually rolled-grooved in the field
    "flanged": "flanged.150",
    "flanged.150": "flanged.150",
    "flanged.300": "flanged.300",
    "solvent_welded": "solvent_welded",
    "soldered": "soldered",
    "stortz": "stortz",
    "none": "none",
}

# Manifest role -> canonical PortRole
ROLE_MAP = {
    "inlet": "run_a",
    "outlet": "run_b",
    "run_a": "run_a",
    "run_b": "run_b",
    "branch": "branch",
    "drop": "drop",
}

SLUG_RE = re.compile(r"[^a-z0-9]+")
SIZE_NUM_RE = re.compile(r"(\d+(?:\.\d+)?(?:/\d+)?)")


def slugify(s: str) -> str:
    """Return a filesystem/SKU-safe slug using only [a-z0-9_]."""
    s = s.strip().lower()
    s = SLUG_RE.sub("_", s)
    s = s.strip("_")
    return s


def normalise_category(cat: str) -> str:
    """Dotted-lowercase category with only [a-z0-9.]."""
    c = cat.strip().lower()
    # underscores and dashes become dots; collapse duplicates
    c = re.sub(r"[_\-]+", ".", c)
    c = re.sub(r"[^a-z0-9.]+", "", c)
    c = re.sub(r"\.+", ".", c).strip(".")
    if "." not in c:
        # parser requires dotted form; tack on a stable leaf
        c = f"{c}.generic"
    return c


def parse_size_in(raw: Any) -> float | None:
    """Extract a numeric size_in from a manifest port size or dim field."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw)
    m = SIZE_NUM_RE.search(s)
    if not m:
        return None
    tok = m.group(1)
    if "/" in tok:
        a, b = tok.split("/")
        try:
            return float(a) / float(b)
        except ZeroDivisionError:
            return None
    try:
        return float(tok)
    except ValueError:
        return None


def normalise_orientation(o: str | None) -> str | None:
    if not o:
        return None
    o = o.lower()
    # schema uses 'pendant', manifest uses 'pendent'
    if o == "pendent":
        return "pendant"
    if o in {"pendant", "upright", "sidewall", "concealed"}:
        return o
    return None


def normalise_response(r: str | None) -> str | None:
    if not r:
        return None
    r = r.lower()
    if r in {"standard", "quick", "esfr"}:
        return r
    return None


def normalise_crew(kind: str, price: float | None) -> str:
    """Pick a crew role heuristically by kind."""
    if kind in {"valve", "fdc"}:
        return "foreman"
    if kind in {"sprinkler_head", "hanger", "device"}:
        return "journeyman"
    return "journeyman"


def pick_style(kind: str, category: str, raw_style: str | None) -> str:
    """Pick a canonical style with kind-aware fallback."""
    if raw_style:
        mapped = STYLE_MAP.get(raw_style)
        if mapped:
            return mapped
    # fallbacks by category
    if "threaded" in category or "cpvc" in category:
        return "NPT_threaded"
    if "flange" in category:
        return "flanged.150"
    if kind == "sprinkler_head":
        return "NPT_threaded"
    return "grooved"


def escape_q(s: str) -> str:
    """Escape double quotes for SCAD string literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def normalise_display_name(name: str) -> str:
    """Strip mojibake and control chars so parsers see clean text."""
    out = (
        name.replace("\u00e2\u20ac\u201d", "—")  # em dash mojibake
        .replace("\u00e2\u20ac\u201c", "–")  # en dash mojibake
        .replace("\u00c2\u00b0", "°")  # degree sign mojibake
        .replace("\u00e2\u20ac\u0153", '"')
        .replace("\u00e2\u20ac\u009d", '"')
    )
    # Drop any stray control chars
    out = "".join(ch for ch in out if ch >= " ")
    # Collapse whitespace
    out = re.sub(r"\s+", " ", out).strip()
    return out


# ─── Geometry emitters (return SCAD body, after the annotation block) ────


def geom_head(entry: dict) -> str:
    dims = entry.get("dims") or {}
    length_in = float(dims.get("length_in", 2.25))
    body_dia_in = float(dims.get("body_dia_in", 1.0))
    length_mm = length_in * 25.4
    body_dia_mm = body_dia_in * 25.4
    orient = normalise_orientation(entry.get("orientation")) or "pendant"
    # Axis: pendant up +Y, upright -Y, sidewall -X, concealed mostly flush
    if orient == "upright":
        tilt = "rotate([180,0,0])"
    elif orient == "sidewall":
        tilt = "rotate([0,0,90])"
    else:
        tilt = ""
    thread_od = 21.3  # 1/2" NPT
    thread_len = 16
    return f"""size_in = 0.5;
k_factor = {float(entry.get("k_factor", 5.6))};

length_mm   = {length_mm:.2f};
body_dia_mm = {body_dia_mm:.2f};
thread_od   = {thread_od};
thread_len  = {thread_len};
deflector_d = body_dia_mm * 0.9;

{tilt} union() {{
    translate([0, thread_len/2, 0])
        cylinder(h = thread_len, d = thread_od, center = true, $fn = 24);
    translate([0, -3, 0])
        rotate([90, 0, 0])
        cylinder(h = 6, d = thread_od * 1.55, $fn = 6, center = true);
    translate([0, -length_mm/2, 0])
        cylinder(h = length_mm, d = body_dia_mm * 0.35, center = true, $fn = 20);
    translate([0, -length_mm - 1, 0])
        cylinder(h = 2, d = deflector_d, center = true, $fn = 32);
}}
"""


def geom_pipe(entry: dict) -> str:
    dims = entry.get("dims") or {}
    nps = float(dims.get("nominal_in", 2))
    length_ft = float(dims.get("length_ft", 10))
    length_m = length_ft * 0.3048
    return f"""size_in  = {nps};
length_m = {length_m:.4f};
schedule = "sch10";

function od_mm(nps) =
    nps ==  0.75 ? 26.7 :
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

function wall_mm(nps, sched) =
    sched == "sch40"
        ? (nps <= 1.5 ? 3.68 : nps <= 3 ? 5.49 : 6.02)
        : (nps <= 1.5 ? 2.77 : nps <= 3 ? 3.05 : 3.68);

od = od_mm(size_in);
id = od - 2 * wall_mm(size_in, schedule);
len_mm = length_m * 1000;

difference() {{
    cylinder(h = len_mm, d = od, center = true, $fn = 64);
    cylinder(h = len_mm + 1, d = id, center = true, $fn = 64);
}}
"""


def geom_fitting_coupling(entry: dict, nps: float) -> str:
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

od = od_mm(size_in);
len_mm = od * 1.6;

rotate([0, 90, 0])
    union() {{
        cylinder(h = len_mm, d = od * 1.18, center = true, $fn = 48);
        cylinder(h = len_mm + 4, d = od, center = true, $fn = 48);
    }}
"""


def geom_fitting_elbow(entry: dict, nps: float) -> str:
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

od = od_mm(size_in);
leg = od * 1.0;

union() {{
    // Inlet leg along -X
    translate([-leg/2, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = leg, d = od, center = true, $fn = 48);
    // Outlet leg along +Z
    translate([0, 0, leg/2])
        cylinder(h = leg, d = od, center = true, $fn = 48);
    // Knuckle
    sphere(d = od * 1.15, $fn = 32);
}}
"""


def geom_fitting_tee(entry: dict, nps: float) -> str:
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

od = od_mm(size_in);
run_len    = od * 2.2;
branch_len = od * 1.1;

union() {{
    // Run along X
    rotate([0, 90, 0])
        cylinder(h = run_len, d = od, center = true, $fn = 48);
    // Branch along +Z
    translate([0, 0, branch_len/2])
        cylinder(h = branch_len, d = od, center = true, $fn = 48);
}}
"""


def geom_fitting_cap(entry: dict, nps: float) -> str:
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 : 60.3;

od = od_mm(size_in);
h  = od * 0.9;

union() {{
    cylinder(h = h, d = od * 1.12, $fn = 48);
    translate([0, 0, h])
        cylinder(h = od * 0.2, d = od * 0.8, $fn = 48);
}}
"""


def geom_fitting_reducer(entry: dict, nps: float) -> str:
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   6  ? 168.3 : 60.3;

od_big   = od_mm(size_in);
od_small = od_big * 0.75;
len_mm   = od_big * 1.6;

rotate([0, 90, 0])
    cylinder(h = len_mm, d1 = od_big, d2 = od_small, center = true, $fn = 48);
"""


def geom_valve(entry: dict) -> str:
    dims = entry.get("dims") or {}
    nps = float(dims.get("nominal_in", 2.5))
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 : 73.0;

od = od_mm(size_in);
body_len = od * 2.4;
body_d   = od * 1.7;

union() {{
    // Valve body
    rotate([0, 90, 0])
        cylinder(h = body_len, d = body_d, center = true, $fn = 48);
    // Stem / handle indicator
    translate([0, body_d * 0.6, 0])
        cylinder(h = body_d * 0.5, d = body_d * 0.18, center = true, $fn = 16);
    translate([0, body_d * 0.95, 0])
        cube([body_d * 1.1, body_d * 0.08, body_d * 0.25], center = true);
    // End flanges
    translate([-body_len/2, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = body_d * 0.12, d = body_d * 1.05, center = true, $fn = 48);
    translate([ body_len/2, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = body_d * 0.12, d = body_d * 1.05, center = true, $fn = 48);
}}
"""


def geom_hanger(entry: dict) -> str:
    dims = entry.get("dims") or {}
    nps = float(dims.get("nominal_in", 2))
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 : 60.3;

od = od_mm(size_in);
ring_id = od * 1.05;
ring_od = ring_id + 8;
strap_w = 20;
rod_len = 140;

union() {{
    // Ring
    difference() {{
        cylinder(h = strap_w, d = ring_od, center = true, $fn = 48);
        cylinder(h = strap_w + 1, d = ring_id, center = true, $fn = 48);
    }}
    // Rod up +Y
    translate([0, rod_len/2 + ring_od/2, 0])
        cylinder(h = rod_len, d = 9.5, center = true, $fn = 12);
    // Top swivel eye
    translate([0, rod_len + ring_od/2, 0])
        rotate([90, 0, 0])
        difference() {{
            cylinder(h = 6, d = 22, center = true, $fn = 24);
            cylinder(h = 8, d = 12, center = true, $fn = 24);
        }}
}}
"""


def geom_device(entry: dict) -> str:
    """Generic electrical/sensor device — small enclosure with stub."""
    dims = entry.get("dims") or {}
    nps = float(dims.get("nominal_in", 1.0)) if dims.get("nominal_in") else 1.0
    return f"""size_in = {nps};

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 : 33.4;

od = od_mm(size_in);
box_w = 100;
box_h = 70;
box_d = 45;

union() {{
    // Enclosure
    translate([0, box_h/2 + od/2, 0])
        cube([box_w, box_h, box_d], center = true);
    // Pipe saddle stub
    rotate([0, 90, 0])
        cylinder(h = od * 2.2, d = od * 1.1, center = true, $fn = 32);
    // Conduit nipple
    translate([0, box_h + od/2, 0])
        cylinder(h = 20, d = 20, center = true, $fn = 16);
}}
"""


# ─── Port synthesis ─────────────────────────────────────────────────────


def synth_ports_for_kind(
    canonical_kind: str, category: str, nps_default: float, raw_style: str | None
) -> list[dict]:
    """Produce a list of port dicts when the manifest has none (or bogus ones)."""
    style = pick_style(canonical_kind, category, raw_style)

    if canonical_kind == "sprinkler_head":
        return [
            dict(
                name="inlet",
                position=(0.0, 0.014, 0.0),
                direction=(0.0, 1.0, 0.0),
                style=style,
                size_in=0.5,
                role="drop",
            )
        ]
    if canonical_kind == "pipe_segment":
        return [
            dict(
                name="end_a",
                position=(0.0, 0.0, -0.5),
                direction=(0.0, 0.0, -1.0),
                style=style,
                size_in=nps_default,
                role="run_a",
            ),
            dict(
                name="end_b",
                position=(0.0, 0.0, 0.5),
                direction=(0.0, 0.0, 1.0),
                style=style,
                size_in=nps_default,
                role="run_b",
            ),
        ]
    if canonical_kind == "fitting":
        # tee gets a branch, elbow has L-shape, coupling/cap/reducer inline
        if "tee" in category:
            return [
                dict(name="run_in",  position=(-0.05, 0, 0), direction=(-1, 0, 0),
                     style=style, size_in=nps_default, role="run_a"),
                dict(name="run_out", position=(0.05, 0, 0),  direction=(1, 0, 0),
                     style=style, size_in=nps_default, role="run_b"),
                dict(name="branch",  position=(0, 0, 0.05),  direction=(0, 0, 1),
                     style=style, size_in=nps_default, role="branch"),
            ]
        if "elbow" in category:
            return [
                dict(name="in",  position=(-0.05, 0, 0), direction=(-1, 0, 0),
                     style=style, size_in=nps_default, role="run_a"),
                dict(name="out", position=(0, 0, 0.05),  direction=(0, 0, 1),
                     style=style, size_in=nps_default, role="run_b"),
            ]
        if "cap" in category:
            return [
                dict(name="in", position=(0, 0, 0), direction=(0, 0, -1),
                     style=style, size_in=nps_default, role="run_a"),
            ]
        if "reducer" in category:
            return [
                dict(name="in",  position=(-0.05, 0, 0), direction=(-1, 0, 0),
                     style=style, size_in=nps_default,        role="run_a"),
                dict(name="out", position=(0.05, 0, 0),  direction=(1, 0, 0),
                     style=style, size_in=nps_default * 0.75, role="run_b"),
            ]
        # coupling / union / generic
        return [
            dict(name="in",  position=(-0.04, 0, 0), direction=(-1, 0, 0),
                 style=style, size_in=nps_default, role="run_a"),
            dict(name="out", position=(0.04, 0, 0),  direction=(1, 0, 0),
                 style=style, size_in=nps_default, role="run_b"),
        ]
    if canonical_kind == "valve":
        return [
            dict(name="in",  position=(-0.1, 0, 0), direction=(-1, 0, 0),
                 style=style, size_in=nps_default, role="run_a"),
            dict(name="out", position=(0.1, 0, 0),  direction=(1, 0, 0),
                 style=style, size_in=nps_default, role="run_b"),
        ]
    if canonical_kind == "hanger":
        return [
            dict(name="pipe", position=(0, 0, 0), direction=(0, 1, 0),
                 style=style, size_in=nps_default, role="run_a"),
        ]
    if canonical_kind == "device":
        return [
            dict(name="pipe", position=(0, 0, 0), direction=(-1, 0, 0),
                 style=style, size_in=nps_default, role="run_a"),
        ]
    return []


def normalise_manifest_ports(
    mports: list[dict],
    canonical_kind: str,
    category: str,
    nps_default: float,
) -> list[dict]:
    """Map manifest ports to canonical ports. Falls back to synth if unusable."""
    if not mports:
        return synth_ports_for_kind(canonical_kind, category, nps_default, None)

    # Tees: manifest only carries 2 ports on z-axis which conflicts with the
    # canonical X-run / Z-branch convention. Always regenerate.
    if canonical_kind == "fitting" and "tee" in category:
        raw_style = mports[0].get("style") if mports else None
        return synth_ports_for_kind(canonical_kind, category, nps_default, raw_style)
    # Elbows: manifest ports are both z-axis but canonical elbow convention
    # is inlet -X / outlet +Z. Regenerate.
    if canonical_kind == "fitting" and "elbow" in category:
        raw_style = mports[0].get("style") if mports else None
        return synth_ports_for_kind(canonical_kind, category, nps_default, raw_style)

    out = []
    seen_names: dict[str, int] = {}
    inlet_count = 0
    outlet_count = 0

    # Detect heads where the only port has direction -Z but schema wants +Y.
    # Normalise axes for sprinkler heads to match SCAD local convention
    # (thread points +Y for pendant).
    for i, p in enumerate(mports):
        role_raw = (p.get("role") or "inlet").lower()
        dir_raw = p.get("direction") or [0, 0, -1]
        pos_raw = p.get("position") or [0, 0, 0]
        size_num = parse_size_in(p.get("size"))
        if size_num is None:
            size_num = nps_default
        style_raw = p.get("style")
        style = pick_style(canonical_kind, category, style_raw)

        # Name
        base = role_raw
        idx = seen_names.get(base, 0)
        seen_names[base] = idx + 1
        name = base if idx == 0 else f"{base}_{idx+1}"

        # Role
        if role_raw == "inlet":
            inlet_count += 1
            role = "run_a"
        elif role_raw == "outlet":
            outlet_count += 1
            role = "run_b"
        else:
            role = ROLE_MAP.get(role_raw, "run_a")

        # Axis override for sprinkler heads
        if canonical_kind == "sprinkler_head":
            pos = (0.0, 0.014, 0.0)
            direction = (0.0, 1.0, 0.0)
            role = "drop"
            name = "inlet"
            if i > 0:
                continue  # only one port on heads
        # Axis override for pipes (manifest had length in feet along z
        # which is out-of-scale for our meter coordinate system)
        elif canonical_kind == "pipe_segment":
            if role_raw == "inlet":
                pos = (0.0, 0.0, -0.5)
                direction = (0.0, 0.0, -1.0)
            else:
                pos = (0.0, 0.0, 0.5)
                direction = (0.0, 0.0, 1.0)
        else:
            # Manifest sometimes puts two ports along +Z which is wrong for
            # valves / couplings that should be inline along X. Keep their
            # intent (two ends separated) but re-project to X for anything
            # that isn't a tee branch.
            pos = tuple(float(x) for x in pos_raw[:3])
            direction = tuple(float(x) for x in dir_raw[:3])
            # Re-project straight-through fittings/valves onto X axis:
            if canonical_kind in {"fitting", "valve"} and "tee" not in category:
                sign = -1.0 if role_raw == "inlet" else 1.0
                pos = (sign * 0.05, 0.0, 0.0)
                direction = (sign * 1.0, 0.0, 0.0)

        out.append(
            dict(
                name=name,
                position=pos,
                direction=direction,
                style=style,
                size_in=size_num,
                role=role,
            )
        )

    # Synthesise a branch port for tees if missing
    if canonical_kind == "fitting" and "tee" in category and all(
        p["role"] != "branch" for p in out
    ):
        out.append(
            dict(
                name="branch",
                position=(0.0, 0.0, 0.05),
                direction=(0.0, 0.0, 1.0),
                style=pick_style(canonical_kind, category, None),
                size_in=nps_default,
                role="branch",
            )
        )

    # Final safety: if everything got filtered out, fall back to synth
    if not out:
        return synth_ports_for_kind(canonical_kind, category, nps_default, None)
    return out


# ─── SCAD emission ──────────────────────────────────────────────────────


def fmt_vec3(v: tuple[float, float, float]) -> str:
    def f(x: float) -> str:
        if x == int(x):
            return str(int(x))
        return f"{x:.4g}"
    return f"[{f(v[0])},{f(v[1])},{f(v[2])}]"


def emit_scad(entry: dict, slug: str, report: list[str]) -> str | None:
    """Return SCAD source text for one entry, or None to skip."""
    raw_kind = entry.get("kind")
    canonical_kind = KIND_MAP.get(raw_kind or "")
    if canonical_kind is None:
        report.append(f"SKIP {slug}: unknown kind {raw_kind!r}")
        return None

    raw_cat = entry.get("category") or canonical_kind
    if canonical_kind == "sprinkler_head" and raw_cat == "head":
        orient = normalise_orientation(entry.get("orientation")) or "pendant"
        k = entry.get("k_factor")
        k_tag = f"k{int(round(float(k) * 10))}" if k else "kgen"
        raw_cat = f"head.{orient}.{k_tag}"
    category = normalise_category(raw_cat)
    display_name = normalise_display_name(entry.get("display_name") or slug)
    mfg = entry.get("mfg") or ""
    mfg_slug_val = slugify(mfg) if mfg else ""
    mfg_pn = entry.get("mfg_pn") or None

    dims = entry.get("dims") or {}
    nps_default = (
        parse_size_in(dims.get("nominal_in"))
        or parse_size_in(dims.get("body_dia_in"))
        or 2.0
    )

    ports = normalise_manifest_ports(
        entry.get("ports") or [], canonical_kind, category, nps_default
    )

    listing = entry.get("listing") or []
    listing_str = " ".join(listing) if listing else None
    hazards = entry.get("hazard_classes") or []
    price = entry.get("price_usd")
    install = entry.get("install_minutes")
    crew = normalise_crew(canonical_kind, price)
    k_factor = entry.get("k_factor") if canonical_kind == "sprinkler_head" else None
    orientation = (
        normalise_orientation(entry.get("orientation"))
        if canonical_kind == "sprinkler_head"
        else None
    )
    response = (
        normalise_response(entry.get("response"))
        if canonical_kind == "sprinkler_head"
        else None
    )
    temp_f = entry.get("temperature_f") if canonical_kind == "sprinkler_head" else None
    temperature = f"{int(temp_f)}F" if temp_f else None

    # Build annotation block
    ann = []
    ann.append(f"// Auto-generated by scripts/author_from_manifest.py (Phase D.3).")
    ann.append(f"// Source: data/phase_d_manifest.json (sku_intent={entry.get('sku_intent')!r}).")
    ann.append(f"// Do not hand-edit — regenerate from the manifest.")
    ann.append("//")
    ann.append(f"// @part {slug}")
    ann.append(f"// @kind {canonical_kind}")
    ann.append(f"// @category {category}")
    ann.append(f'// @display-name "{escape_q(display_name)}"')
    if mfg_slug_val:
        ann.append(f"// @mfg {mfg_slug_val}")
    if mfg_pn:
        # mfg-pn should be a single whitespace-free token for the parser —
        # replace spaces with underscores.
        safe_pn = re.sub(r"\s+", "_", mfg_pn.strip())
        ann.append(f"// @mfg-pn {safe_pn}")
    if listing_str:
        ann.append(f"// @listing {listing_str}")
    if hazards:
        ann.append(f"// @hazard-classes {' '.join(hazards)}")
    if price is not None:
        ann.append(f"// @price-usd {float(price):.2f}")
    if install is not None:
        ann.append(f"// @install-minutes {float(install):g}")
    ann.append(f"// @crew {crew}")
    if k_factor is not None:
        ann.append(f"// @k-factor {float(k_factor):g}")
    if orientation:
        ann.append(f"// @orientation {orientation}")
    if response:
        ann.append(f"// @response {response}")
    if temperature:
        ann.append(f"// @temperature {temperature}")

    # Standard size param (integers-ish)
    size_default = (
        0.5
        if canonical_kind == "sprinkler_head"
        else (nps_default if nps_default > 0 else 2)
    )
    ann.append(
        f'// @param size_in number default={size_default:g} label="Size" unit="in"'
    )

    # Ports
    for p in ports:
        ann.append(
            f"// @port {p['name']} position={fmt_vec3(p['position'])} "
            f"direction={fmt_vec3(p['direction'])} style={p['style']} "
            f"size_in={p['size_in']:g} role={p['role']}"
        )

    # Geometry
    if canonical_kind == "sprinkler_head":
        body = geom_head(entry)
    elif canonical_kind == "pipe_segment":
        body = geom_pipe(entry)
    elif canonical_kind == "fitting":
        if "tee" in category:
            body = geom_fitting_tee(entry, nps_default)
        elif "elbow" in category:
            body = geom_fitting_elbow(entry, nps_default)
        elif "cap" in category:
            body = geom_fitting_cap(entry, nps_default)
        elif "reducer" in category:
            body = geom_fitting_reducer(entry, nps_default)
        else:
            body = geom_fitting_coupling(entry, nps_default)
    elif canonical_kind == "valve":
        body = geom_valve(entry)
    elif canonical_kind == "hanger":
        body = geom_hanger(entry)
    elif canonical_kind == "device":
        body = geom_device(entry)
    else:
        report.append(f"SKIP {slug}: no geometry template for {canonical_kind}")
        return None

    return "\n".join(ann) + "\n\n" + body


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix=path.stem + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        finally:
            raise


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = manifest["entries"]
    report: list[str] = []
    counts: Counter[str] = Counter()
    skipped: list[tuple[str, str]] = []
    slugs_seen: dict[str, str] = {}
    written = 0

    for entry in entries:
        intent = entry.get("sku_intent") or ""
        if not intent:
            skipped.append(("<missing-sku>", "no sku_intent"))
            continue
        slug = slugify(intent)
        if slug in slugs_seen:
            skipped.append((slug, f"duplicate slug (first from {slugs_seen[slug]!r})"))
            continue
        slugs_seen[slug] = intent

        scad = emit_scad(entry, slug, report)
        if scad is None:
            skipped.append((slug, "no geometry template / kind mismatch"))
            continue

        out_path = SCAD_DIR / f"{slug}.scad"
        atomic_write(out_path, scad)
        written += 1
        counts[KIND_MAP[entry["kind"]]] += 1

    print(f"authored {written} .scad files into {SCAD_DIR}")
    print("by canonical kind:")
    for k, c in sorted(counts.items()):
        print(f"  {k:18s} {c}")
    if skipped:
        print(f"\nskipped {len(skipped)} entries:")
        for slug, reason in skipped:
            print(f"  {slug}: {reason}")
    if report:
        print("\ngenerator notes:")
        for line in report:
            print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
