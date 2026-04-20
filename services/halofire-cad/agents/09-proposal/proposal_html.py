"""Self-contained proposal.html emitter.

This is the shippable artifact the VPS halo-fire demo embeds:
  - branded header (client + total price)
  - inline SVG plan view per level (heads + pipes, NFPA pipe colors)
  - embedded <model-viewer> rendering design.glb (user can orbit)
  - scope of work, inclusions, exclusions, acknowledgements
  - BOM table, labor table, per-system hydraulic summary
  - signature block

No external CSS. model-viewer loads from unpkg once at first render
(the one exception — it's a stable, versioned URL).

Usage:
    from html import write_proposal_html
    write_proposal_html(data, out_dir, design_glb='design.glb')

Produces proposal.html in out_dir. The GLB filename is relative so
the HTML can be served from the same deliverables directory.
"""
from __future__ import annotations

import html as htmlmod
import json
from pathlib import Path
from typing import Any, Iterable


# ── helpers ────────────────────────────────────────────────────────

_BRAND_RED = '#e8432d'
_BRAND_BG = '#0a0a0b'
_BRAND_PANEL = '#14141a'
_BRAND_BORDER = 'rgba(255,255,255,0.08)'
_BRAND_TEXT = '#e6e6e8'
_BRAND_MUTED = '#8a8a90'

# NFPA / AutoSprink pipe-size color convention
_PIPE_COLORS: dict[str, str] = {
    '1': '#ffd600',
    '1.25': '#ff4aa8',
    '1.5': '#00e5ff',
    '2': '#448aff',
    '2.5': '#00e676',
    '3': '#e8432d',
    '4': '#ffffff',
    '6': '#ffffff',
}


def _pipe_color(size_in: float | None) -> str:
    if size_in is None:
        return '#888'
    # Normalize "2.0" → "2" so the NFPA table (keyed "1", "1.25",
    # "1.5", "2", …) matches floats from the design JSON.
    key = f'{float(size_in):g}'
    return _PIPE_COLORS.get(key, '#888')


def _esc(s: Any) -> str:
    return htmlmod.escape(str(s), quote=True)


def _fmt_usd(x: float | int) -> str:
    try:
        return f"${float(x):,.2f}"
    except (TypeError, ValueError):
        return '$0.00'


def _fmt_n(x: Any, digits: int = 0) -> str:
    try:
        if digits:
            return f"{float(x):,.{digits}f}"
        return f"{int(x):,}"
    except (TypeError, ValueError):
        return '—'


# ── plan SVG per level ──────────────────────────────────────────────

def _collect_level_geometry(
    design: dict[str, Any] | None,
) -> dict[str, dict[str, list]]:
    """Return {level_id: {'heads': [...], 'pipes': [...]}} from the
    design.json payload. Falls back to an empty dict if design is
    unavailable — the HTML simply omits plan views in that case.
    """
    out: dict[str, dict[str, list]] = {}
    if not design:
        return out
    levels = (design.get('building') or {}).get('levels') or []
    systems = design.get('systems') or []
    # Build room → level lookup
    room_level: dict[str, str] = {}
    for lvl in levels:
        for r in (lvl.get('rooms') or []):
            room_level[r['id']] = lvl['id']
        out[lvl['id']] = {'heads': [], 'pipes': []}
    for s in systems:
        for h in (s.get('heads') or []):
            lid = room_level.get(h.get('room_id', ''))
            if lid and lid in out:
                out[lid]['heads'].append(
                    {
                        'x': h['position_m'][0],
                        'z': h['position_m'][2],
                        'sku': h.get('sku', ''),
                    },
                )
        # Pipes carry start/end 3D points; attribute to level by
        # average elevation vs level elevation (fallback: first
        # level).
        for p in (s.get('pipes') or []):
            start = p.get('start_m') or [0, 0, 0]
            end = p.get('end_m') or [0, 0, 0]
            y_mid = (start[1] + end[1]) / 2
            # Pick the level whose elevation is closest
            best_lvl = None
            best_d = 1e9
            for lvl in levels:
                d = abs((lvl.get('elevation_m') or 0) - y_mid)
                if d < best_d:
                    best_d = d
                    best_lvl = lvl['id']
            if best_lvl and best_lvl in out:
                out[best_lvl]['pipes'].append(
                    {
                        'x1': start[0],
                        'z1': start[2],
                        'x2': end[0],
                        'z2': end[2],
                        'size_in': p.get('size_in'),
                    },
                )
    return out


def _render_plan_svg(
    level_id: str,
    level_geom: dict[str, list],
    width_px: int = 720,
    height_px: int = 420,
    padding_px: int = 24,
) -> str:
    heads = level_geom.get('heads') or []
    pipes = level_geom.get('pipes') or []
    if not heads and not pipes:
        return (
            f'<div class="plan-empty">No placed heads on '
            f'{_esc(level_id)} (level omitted from routing).</div>'
        )

    # Compute bounds
    xs: list[float] = []
    zs: list[float] = []
    for h in heads:
        xs.append(h['x'])
        zs.append(h['z'])
    for p in pipes:
        xs.extend([p['x1'], p['x2']])
        zs.extend([p['z1'], p['z2']])
    if not xs:
        return '<div class="plan-empty">No geometry.</div>'
    xmin, xmax = min(xs), max(xs)
    zmin, zmax = min(zs), max(zs)
    # Avoid divide-by-zero on degenerate runs
    span_x = max(xmax - xmin, 1.0)
    span_z = max(zmax - zmin, 1.0)
    # Fit-to-box
    avail_w = width_px - 2 * padding_px
    avail_h = height_px - 2 * padding_px
    scale = min(avail_w / span_x, avail_h / span_z)
    # Center
    offset_x = padding_px + (avail_w - span_x * scale) / 2
    offset_y = padding_px + (avail_h - span_z * scale) / 2

    def tx(x: float) -> float:
        return offset_x + (x - xmin) * scale

    def tz(z: float) -> float:
        # SVG y grows down — flip z so "north" of plan is up
        return height_px - (offset_y + (z - zmin) * scale)

    parts: list[str] = [
        f'<svg viewBox="0 0 {width_px} {height_px}" '
        f'xmlns="http://www.w3.org/2000/svg" class="plan-svg" '
        f'role="img" aria-label="Floor plan for {_esc(level_id)}">',
        f'<rect width="{width_px}" height="{height_px}" '
        f'fill="{_BRAND_PANEL}" stroke="{_BRAND_BORDER}"/>',
    ]
    # Pipes
    for p in pipes:
        col = _pipe_color(p.get('size_in'))
        sw = 2.2 if (p.get('size_in') or 0) >= 3 else 1.4
        parts.append(
            f'<line x1="{tx(p["x1"]):.1f}" y1="{tz(p["z1"]):.1f}" '
            f'x2="{tx(p["x2"]):.1f}" y2="{tz(p["z2"]):.1f}" '
            f'stroke="{col}" stroke-width="{sw}" '
            f'stroke-linecap="round" opacity="0.85"/>',
        )
    # Heads
    for h in heads:
        parts.append(
            f'<circle cx="{tx(h["x"]):.1f}" cy="{tz(h["z"]):.1f}" '
            f'r="3" fill="{_BRAND_RED}" stroke="#fff" '
            f'stroke-width="0.7"/>',
        )
    # Scale bar — 5 m
    bar_px = 5 * scale
    if bar_px < avail_w - 40:
        bx = width_px - padding_px - bar_px
        by = height_px - padding_px
        parts.append(
            f'<line x1="{bx:.1f}" y1="{by:.1f}" '
            f'x2="{bx + bar_px:.1f}" y2="{by:.1f}" '
            f'stroke="#fff" stroke-width="2"/>'
            f'<text x="{bx + bar_px / 2:.1f}" y="{by - 6:.1f}" '
            f'text-anchor="middle" fill="#fff" '
            f'font-family="monospace" font-size="11">5 m</text>',
        )
    # Legend
    legend_items = sorted({p.get('size_in') for p in pipes if p.get('size_in')})
    lx = padding_px
    ly = padding_px + 4
    for i, sz in enumerate(legend_items[:6]):
        col = _pipe_color(sz)
        parts.append(
            f'<line x1="{lx}" y1="{ly + i * 14:.0f}" '
            f'x2="{lx + 18}" y2="{ly + i * 14:.0f}" '
            f'stroke="{col}" stroke-width="2.2"/>'
            f'<text x="{lx + 24}" y="{ly + 4 + i * 14:.0f}" '
            f'fill="#ddd" font-family="monospace" font-size="10">'
            f'{f"{float(sz):g}"}"</text>',
        )
    parts.append('</svg>')
    return '\n'.join(parts)


# ── table + section helpers ─────────────────────────────────────────

def _table(headers: Iterable[str], rows: Iterable[Iterable[Any]]) -> str:
    th = ''.join(f'<th>{_esc(h)}</th>' for h in headers)
    body = ''.join(
        '<tr>' + ''.join(f'<td>{_esc(c)}</td>' for c in r) + '</tr>'
        for r in rows
    )
    return f'<table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table>'


def _bullet_list(items: Iterable[str]) -> str:
    lis = ''.join(f'<li>{_esc(it)}</li>' for it in items)
    return f'<ul>{lis}</ul>'


# ── main entry ──────────────────────────────────────────────────────

_CSS = f"""
:root {{
  --bg: {_BRAND_BG};
  --panel: {_BRAND_PANEL};
  --border: {_BRAND_BORDER};
  --text: {_BRAND_TEXT};
  --muted: {_BRAND_MUTED};
  --accent: {_BRAND_RED};
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.55 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  padding-bottom: 48px;
}}
a {{ color: var(--accent); }}
.wrap {{ max-width: 1080px; margin: 0 auto; padding: 0 24px; }}
header.top {{
  border-bottom: 2px solid var(--accent);
  padding: 28px 24px;
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 24px;
  background: linear-gradient(180deg, #1b1b22 0%, var(--bg) 100%);
}}
header.top .brand {{
  font-family: "Playfair Display", Georgia, serif;
  font-weight: 700;
  letter-spacing: -0.5px;
  font-size: 28px;
}}
header.top .brand em {{
  color: var(--accent); font-style: normal;
}}
header.top .client {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }}
header.top .project {{ font-size: 22px; font-weight: 600; margin-top: 4px; }}
header.top .price {{
  text-align: right;
}}
header.top .price .label {{ color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }}
header.top .price .amount {{
  font-size: 40px;
  font-weight: 700;
  font-family: "JetBrains Mono", "Menlo", monospace;
  color: var(--accent);
  line-height: 1;
}}
section {{
  margin-top: 40px;
}}
section h2 {{
  font-size: 18px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 16px;
  color: #fff;
}}
.kpi-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}}
.kpi {{
  background: var(--panel); border: 1px solid var(--border);
  padding: 14px 16px;
}}
.kpi .label {{ color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }}
.kpi .value {{ font-size: 22px; font-weight: 600; font-family: "JetBrains Mono", monospace; margin-top: 6px; }}
table {{
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--border);
  font-size: 13px;
}}
th, td {{
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}}
th {{ color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }}
tr:last-child td {{ border-bottom: 0; }}
td.num, th.num {{ text-align: right; font-family: "JetBrains Mono", monospace; }}
ul {{ margin: 0 0 0 18px; padding: 0; }}
ul li {{ margin-bottom: 4px; }}
.two-col {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}}
@media (max-width: 760px) {{ .two-col {{ grid-template-columns: 1fr; }} }}
.plan-svg {{ width: 100%; height: auto; display: block; border: 1px solid var(--border); }}
.plan-empty {{ padding: 18px; color: var(--muted); background: var(--panel); border: 1px dashed var(--border); }}
.level-card {{
  margin-top: 20px; background: var(--panel); border: 1px solid var(--border); padding: 16px;
}}
.level-card h3 {{ margin: 0 0 8px; font-size: 15px; }}
.level-card .stats {{ color: var(--muted); font-size: 12px; font-family: monospace; margin-bottom: 10px; }}
.mv-shell {{
  position: relative; width: 100%; height: 520px;
  background: var(--panel); border: 1px solid var(--border);
}}
model-viewer {{ width: 100%; height: 100%; --poster-color: transparent; background-color: var(--panel); }}
.system-row td {{ font-family: "JetBrains Mono", monospace; font-size: 12px; }}
.system-row td.ok {{ color: #6cd36c; }}
.system-row td.bad {{ color: #ff6464; }}
footer {{ color: var(--muted); font-size: 11px; text-align: center; margin-top: 48px; }}
"""


def _level_plan_section(
    levels: list[dict[str, Any]],
    design: dict[str, Any] | None,
) -> str:
    level_geom = _collect_level_geometry(design)
    if not level_geom:
        return (
            '<section><h2>Floor plans</h2>'
            '<div class="plan-empty">Design JSON not available '
            '— plan views omitted.</div></section>'
        )
    cards: list[str] = []
    for lvl in levels:
        lid = lvl['id']
        svg = _render_plan_svg(lid, level_geom.get(lid, {}))
        cards.append(
            '<div class="level-card">'
            f'<h3>{_esc(lvl.get("name") or lid)} · {_esc(lvl.get("use", ""))}</h3>'
            f'<div class="stats">'
            f'elev {_esc(lvl.get("elevation_ft", 0))} ft · '
            f'{_fmt_n(lvl.get("head_count", 0))} heads · '
            f'{_fmt_n(lvl.get("pipe_total_ft", 0), 1)} ft pipe · '
            f'{_fmt_n(lvl.get("room_count", 0))} rooms'
            '</div>'
            f'{svg}'
            '</div>',
        )
    return (
        '<section><h2>Floor plans — per level</h2>'
        + ''.join(cards)
        + '</section>'
    )


def _systems_table(systems: list[dict[str, Any]]) -> str:
    rows = []
    for s in systems:
        h = s.get('hydraulic') or {}
        ok = (
            h.get('safety_margin_psi') is not None
            and h.get('safety_margin_psi') > 0
        )
        margin = h.get('safety_margin_psi')
        rows.append(
            [
                s.get('id', ''),
                s.get('type', ''),
                _fmt_n(s.get('head_count', 0)),
                _fmt_n(s.get('pipe_count', 0)),
                _fmt_n(s.get('pipe_total_m', 0), 1) + ' m',
                f"{_fmt_n(h.get('required_flow_gpm'), 1)} gpm"
                if h
                else '—',
                f"{_fmt_n(h.get('required_pressure_psi'), 1)} psi"
                if h
                else '—',
                (
                    f"{_fmt_n(margin, 1)} psi ({'ok' if ok else 'SHORT'})"
                    if margin is not None
                    else '—'
                ),
            ],
        )
    return _table(
        [
            'System', 'Type', 'Heads', 'Pipes',
            'Pipe length', 'Demand (Q)',
            'Demand (P)', 'Safety margin',
        ],
        rows,
    )


def build_proposal_html(
    data: dict[str, Any],
    design: dict[str, Any] | None = None,
    design_glb: str = 'design.glb',
) -> str:
    """Return the full HTML document as a string.

    `data` is the proposal.json payload (from build_proposal_data).
    `design` is optional design.json — used for plan SVGs. If absent,
    the floor-plans section shows a placeholder.
    `design_glb` is the GLB filename relative to the HTML file.
    """
    project = data.get('project') or {}
    pricing = data.get('pricing') or {}
    building = data.get('building_summary') or {}
    levels = data.get('levels') or []
    systems = data.get('systems') or []
    bom = data.get('bom') or []
    labor = data.get('labor') or []
    violations = data.get('violations') or []

    kpi_cards = [
        ('Total price', _fmt_usd(pricing.get('total_usd', 0))),
        ('Total sqft', _fmt_n(building.get('total_sqft', 0))),
        ('Levels', _fmt_n(building.get('level_count', len(levels)))),
        (
            'Heads',
            _fmt_n(sum(int(lv.get('head_count', 0)) for lv in levels)),
        ),
        ('Systems', _fmt_n(len(systems))),
        ('Violations', _fmt_n(len(violations))),
    ]
    kpi_html = ''.join(
        f'<div class="kpi"><div class="label">{_esc(label)}</div>'
        f'<div class="value">{_esc(value)}</div></div>'
        for label, value in kpi_cards
    )

    def _flags(r: dict[str, Any]) -> str:
        bits: list[str] = []
        if r.get('do_not_fab'):
            bits.append('DO NOT FAB')
        if r.get('price_stale'):
            bits.append('stale price')
        if r.get('price_missing'):
            bits.append('price missing')
        return ' · '.join(bits)

    bom_rows = [
        [
            r.get('sku', ''),
            r.get('description', '')[:90],
            _fmt_n(r.get('qty', 0)),
            r.get('unit', ''),
            _fmt_usd(r.get('unit_cost_usd', 0)),
            _fmt_usd(r.get('extended_usd', 0)),
            _flags(r),
        ]
        for r in bom
    ]
    labor_rows = [
        [
            r.get('role', ''),
            _fmt_n(r.get('hours', 0), 1),
            _fmt_usd(r.get('rate_usd_hr', 0)),
            _fmt_usd(r.get('extended_usd', 0)),
        ]
        for r in labor
    ]

    pricing_rows = [
        ['Materials', _fmt_usd(pricing.get('materials_usd', 0))],
        ['Labor', _fmt_usd(pricing.get('labor_usd', 0))],
        ['Permit allowance', _fmt_usd(pricing.get('permit_allowance_usd', 0))],
        ['Taxes', _fmt_usd(pricing.get('taxes_usd', 0))],
        ['Subtotal', _fmt_usd(pricing.get('subtotal_usd', 0))],
        ['Total', _fmt_usd(pricing.get('total_usd', 0))],
    ]

    return (
        '<!doctype html>\n'
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>Halo Fire Protection — {_esc(project.get("name", "Bid"))}</title>'
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=JetBrains+Mono&display=swap" rel="stylesheet">'
        '<script type="module" src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>'
        f'<style>{_CSS}</style>'
        '</head><body>'
        '<header class="top"><div>'
        '<div class="brand">Halo Fire<em>.</em></div>'
        f'<div class="client">{_esc(project.get("client", "Client"))}</div>'
        f'<div class="project">{_esc(project.get("name", "Project"))}</div>'
        f'<div class="client">{_esc(project.get("address", ""))}</div>'
        '</div><div class="price">'
        '<div class="label">Bid total</div>'
        f'<div class="amount">{_fmt_usd(pricing.get("total_usd", 0))}</div>'
        f'<div class="label" style="margin-top:4px">as of {_esc(data.get("generated_at", ""))}</div>'
        '</div></header>'
        '<div class="wrap">'
        f'<section><h2>Project summary</h2><div class="kpi-grid">{kpi_html}</div></section>'
        # 3D model
        '<section><h2>3D model</h2>'
        '<div class="mv-shell">'
        f'<model-viewer src="{_esc(design_glb)}" '
        'camera-controls touch-action="pan-y" '
        'shadow-intensity="1.2" '
        'exposure="0.95" '
        'environment-image="neutral" '
        'auto-rotate-delay="4000" '
        f'alt="3D sprinkler model — {_esc(project.get("name", ""))}">'
        '</model-viewer></div>'
        '<p style="color:var(--muted); font-size:12px; margin-top:8px;">Click and drag to orbit. Shift-drag or two-finger drag to pan. Scroll to zoom. All pipes colored to the AutoSprink / NFPA size convention.</p>'
        '</section>'
        # Floor plans
        + _level_plan_section(levels, design)
        # Systems table
        + '<section><h2>Systems + hydraulics</h2>'
        + _systems_table(systems)
        + '</section>'
        # Pricing
        + '<section><h2>Pricing</h2>'
        + _table(['Line', 'Amount'], pricing_rows)
        + '</section>'
        # Scope / inclusions / exclusions — two-col
        + '<section><div class="two-col">'
        '<div><h2>Scope of work</h2>'
        + _bullet_list(data.get('scope_of_work') or [])
        + '<h2 style="margin-top:28px">Inclusions</h2>'
        + _bullet_list(data.get('inclusions') or [])
        + '</div>'
        '<div><h2>Exclusions</h2>'
        + _bullet_list(data.get('exclusions') or [])
        + '<h2 style="margin-top:28px">Acknowledgements</h2>'
        + _bullet_list(data.get('acknowledgements') or [])
        + '</div></div></section>'
        # BOM
        + '<section><h2>Bill of materials</h2>'
        + _table(
            ['SKU', 'Description', 'Qty', 'Unit', 'Unit $', 'Extended', 'Flags'],
            bom_rows,
        )
        + '</section>'
        # Labor
        + '<section><h2>Labor</h2>'
        + _table(['Role', 'Hours', 'Rate', 'Extended'], labor_rows)
        + '</section>'
        # Violations (if any)
        + (
            '<section><h2>Rule-check violations</h2>'
            + _table(
                ['Code', 'Severity', 'Message'],
                [
                    [
                        v.get('code', ''),
                        v.get('severity', ''),
                        v.get('message', '')[:160],
                    ]
                    for v in violations
                ],
            )
            + '</section>'
            if violations
            else ''
        )
        + '<footer>Halo Fire Protection · generated by the HaloFire CAD Studio pipeline</footer>'
        '</div></body></html>'
    )


def write_proposal_html(
    data: dict[str, Any],
    out_dir: Path,
    design: dict[str, Any] | None = None,
    design_glb: str = 'design.glb',
    filename: str = 'proposal.html',
) -> Path:
    """Serialize proposal.html next to the other deliverables."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / filename
    out.write_text(
        build_proposal_html(data, design=design, design_glb=design_glb),
        encoding='utf-8',
    )
    return out


__all__ = [
    'build_proposal_html',
    'write_proposal_html',
]


# ── CLI: regenerate from existing deliverables ──────────────────────
if __name__ == '__main__':
    import sys as _sys
    if len(_sys.argv) < 2:
        print(
            'usage: python html.py <deliverables_dir>\n'
            '  reads proposal.json + design.json, writes proposal.html',
        )
        _sys.exit(2)
    d = Path(_sys.argv[1]).resolve()
    data = json.loads((d / 'proposal.json').read_text(encoding='utf-8'))
    design_path = d / 'design.json'
    design = (
        json.loads(design_path.read_text(encoding='utf-8'))
        if design_path.exists()
        else None
    )
    out = write_proposal_html(data, d, design=design)
    print(f'wrote {out}')
