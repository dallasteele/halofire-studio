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


def _chart_card(title: str, items: list[dict[str, Any]]) -> str:
    if not items:
        return (
            '<div class="chart-card">'
            f'<div class="chart-title">{_esc(title)}</div>'
            '<div class="plan-empty" style="margin: 0;">No chart data yet.</div>'
            '</div>'
        )

    max_value = max(1.0, max(float(item.get('value') or 0) for item in items))
    rows: list[str] = []
    for item in items[:6]:
        value = float(item.get('value') or 0)
        width = max(6.0, (value / max_value) * 100.0)
        rows.append(
            '<div class="chart-row">'
            f'<div class="chart-row-head">'
            f'<span class="chart-label">{_esc(item.get("label", title))}</span>'
            f'<span class="chart-meta">{_esc(item.get("meta") or f"{value:,.0f}")}</span>'
            '</div>'
            '<div class="chart-track">'
            f'<div class="chart-fill" style="width:{width:.1f}%; background:{_esc(item.get("color") or "#e8432d")}"></div>'
            '</div>'
            '</div>'
        )
    return (
        '<div class="chart-card">'
        f'<div class="chart-title">{_esc(title)}</div>'
        + ''.join(rows)
        + '</div>'
    )


def _artifact_downloads(data: dict[str, Any]) -> list[tuple[str, str]]:
    refs = data.get('artifact_refs')
    if isinstance(refs, dict):
        ordered = [
            ('proposal_html', 'Client HTML bid page'),
            ('proposal_json', 'Proposal JSON'),
            ('proposal_pdf', 'Proposal PDF'),
            ('proposal_xlsx', 'V-09 workbook'),
            ('design_json', 'Design JSON'),
            ('design_dxf', 'AutoCAD DXF'),
            ('design_ifc', 'IFC model'),
            ('design_glb', '3D model GLB'),
            ('evidence_upload_status', 'Evidence upload status'),
            ('manifest_json', 'Artifact manifest'),
        ]
        out: list[tuple[str, str]] = []
        for key, label in ordered:
            name = refs.get(key)
            if name:
                out.append((str(name), label))
        if out:
            return out
    return [
        ('proposal.html', 'Client HTML bid page'),
        ('proposal.json', 'Proposal JSON'),
        ('proposal.pdf', 'Proposal PDF'),
        ('proposal.xlsx', 'V-09 workbook'),
        ('design.json', 'Design JSON'),
        ('design.dxf', 'AutoCAD DXF'),
        ('design.ifc', 'IFC model'),
        ('design.glb', '3D model GLB'),
        ('evidence_upload_status.json', 'Evidence upload status'),
        ('manifest.json', 'Artifact manifest'),
    ]


def _download_grid(data: dict[str, Any]) -> str:
    cards = []
    for name, label in _artifact_downloads(data):
        cards.append(
            '<a class="download-link" href="./' + _esc(name) + '" target="_blank" rel="noopener">'
            f'<span class="download-label">{_esc(label)}</span>'
            f'<span class="download-path">{_esc(name)}</span>'
            '</a>'
        )
    return (
        '<div class="download-grid">'
        + ''.join(cards)
        + '</div>'
    )


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
.chart-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}}
.chart-card {{
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 14px;
}}
.chart-title {{
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #fff;
  margin-bottom: 10px;
}}
.chart-row {{
  margin-bottom: 10px;
}}
.chart-row:last-child {{
  margin-bottom: 0;
}}
.chart-row-head {{
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  margin-bottom: 4px;
}}
.chart-label {{
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}}
.chart-meta {{
  color: var(--muted);
  font-family: "JetBrains Mono", monospace;
  flex-shrink: 0;
}}
.chart-track {{
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: #202028;
}}
.chart-fill {{
  height: 100%;
  border-radius: 999px;
}}
.download-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}}
.download-link {{
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  text-decoration: none;
}}
.download-label {{
  color: #fff;
  font-weight: 600;
}}
.download-path {{
  color: var(--muted);
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
}}
.access-banner {{
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid rgba(232, 67, 45, 0.35);
  background: rgba(232, 67, 45, 0.08);
  color: #ffd9d4;
  font-size: 12px;
}}
.section-note {{
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 12px;
}}
.plan-svg {{ width: 100%; height: auto; display: block; border: 1px solid var(--border); }}
.hero {{ margin-top: 28px; }}
.hero-grid {{
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 20px;
}}
@media (max-width: 900px) {{ .hero-grid {{ grid-template-columns: 1fr; }} }}
.hero-label {{
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}}
.hero-caption {{
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}}
.hero .mv-shell {{ height: 420px; }}
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


def _hero_section(
    levels: list[dict[str, Any]],
    design: dict[str, Any] | None,
    design_glb: str,
    project: dict[str, Any],
) -> str:
    """Landing-page hero — big plan + 3D model side by side."""
    geom = _collect_level_geometry(design)
    # Pick the first level that has any geometry
    hero_level = None
    hero_svg = ""
    for lvl in levels:
        lid = lvl["id"]
        if lid in geom and (geom[lid]["heads"] or geom[lid]["pipes"]):
            hero_level = lvl
            hero_svg = _render_plan_svg(
                lid, geom[lid], width_px=1000, height_px=580,
                padding_px=24,
            )
            break
    if hero_level is None and levels:
        hero_level = levels[0]
        hero_svg = (
            f'<div class="plan-empty">'
            f'Plan view not available yet — intake is still processing.'
            f'</div>'
        )

    hero_meta = ""
    if hero_level:
        hero_meta = (
            f'<div class="hero-caption">'
            f'<strong>{_esc(hero_level.get("name") or hero_level.get("id", ""))}</strong>'
            f' · {_fmt_n(hero_level.get("head_count", 0))} heads · '
            f'{_fmt_n(hero_level.get("pipe_total_ft", 0), 1)} ft pipe'
            f'</div>'
        )

    return (
        '<section class="hero"><div class="hero-grid">'
        '<div class="hero-plan">'
        '<div class="hero-label">Plan view</div>'
        f'{hero_svg}'
        f'{hero_meta}'
        '</div>'
        '<div class="hero-3d">'
        '<div class="hero-label">3D model</div>'
        '<div class="mv-shell">'
        f'<model-viewer src="{_esc(design_glb)}" '
        'camera-controls touch-action="pan-y" '
        'shadow-intensity="1.2" '
        'exposure="0.95" '
        'environment-image="neutral" '
        'auto-rotate-delay="4000" '
        f'alt="3D sprinkler model — {_esc(project.get("name", ""))}">'
        '</model-viewer></div>'
        '<div class="hero-caption">'
        'Orbit: drag · Pan: shift-drag · Zoom: scroll. '
        'All pipes colored to the AutoSprink / NFPA size convention.'
        '</div>'
        '</div>'
        '</div></section>'
    )


def _access_banner() -> str:
    return (
        '<div class="access-banner">'
        'Signed client share delivery. The portal serves the HTML, PDF, '
        'workbook, and model artifacts from the same signed deliverable bundle '
        'so the bid page stays tied to real files.'
        '</div>'
    )


def _portal_bundle_section(violations: list[dict[str, Any]]) -> str:
    blocked_count = len(violations)
    return (
        '<section style="margin-top:24px;padding:18px 20px;border:1px solid rgba(126,211,255,0.22);border-radius:14px;background:linear-gradient(180deg,#08121c,#0a0c12);">'
        '<div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#7ed3ff;margin-bottom:8px">Bid deliverables</div>'
        '<div style="font-size:20px;font-weight:700;line-height:1.25;margin-bottom:8px">Signed portal, workbook, proposal, and design artifacts for bid 1881</div>'
        '<div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#ffb800;margin-bottom:8px">Access-Controlled Bid Bundle</div>'
        '<div style="font-size:14px;line-height:1.55;color:#d0d0d6;margin-bottom:12px">This portal opens as a client-facing bid bundle: access-controlled HTML, estimator workbook, proposal PDF, proposal HTML, and design downloads all read from the same real Halo Forge artifacts.</div>'
        '<div class="download-grid" style="margin-bottom:12px">'
        '<a class="download-link" href="./proposal.html" target="_blank" rel="noopener"><span class="download-label">Client HTML bid page</span><span class="download-path">proposal.html</span></a>'
        '<a class="download-link" href="./proposal.xlsx" target="_blank" rel="noopener"><span class="download-label">Estimator workbook</span><span class="download-path">proposal.xlsx</span></a>'
        '<a class="download-link" href="./proposal.pdf" target="_blank" rel="noopener"><span class="download-label">Proposal PDF</span><span class="download-path">proposal.pdf</span></a>'
        '<a class="download-link" href="./proposal.json" target="_blank" rel="noopener"><span class="download-label">Proposal JSON</span><span class="download-path">proposal.json</span></a>'
        '<a class="download-link" href="./design.glb" target="_blank" rel="noopener"><span class="download-label">Design GLB</span><span class="download-path">design.glb</span></a>'
        '<a class="download-link" href="./design.ifc" target="_blank" rel="noopener"><span class="download-label">Design IFC</span><span class="download-path">design.ifc</span></a>'
        '<a class="download-link" href="./design.dxf" target="_blank" rel="noopener"><span class="download-label">Design DXF</span><span class="download-path">design.dxf</span></a>'
        '<a class="download-link" href="./evidence_workbench.json" target="_blank" rel="noopener"><span class="download-label">Approval/evidence workbench</span><span class="download-path">evidence_workbench.json</span></a>'
        '<a class="download-link" href="./missing_evidence_ledger.json" target="_blank" rel="noopener"><span class="download-label">Missing-evidence ledger</span><span class="download-path">missing_evidence_ledger.json</span></a>'
        '<a class="download-link" href="./missing_evidence_resolver_queue.json" target="_blank" rel="noopener"><span class="download-label">AI-guided correction tasks</span><span class="download-path">missing_evidence_resolver_queue.json</span></a>'
        '</div>'
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:12px">'
        '<div style="padding:12px 13px;border-radius:12px;border:1px solid rgba(126,211,255,0.16);background:rgba(126,211,255,0.05)">'
        '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#7ed3ff;margin-bottom:6px">Client portal</div>'
        '<div style="font-size:13px;line-height:1.5;color:#f5f5f7">Signed, access-controlled HTML bid page with visible caveats and the current blocked claims overlay.</div>'
        '</div>'
        '<div style="padding:12px 13px;border-radius:12px;border:1px solid rgba(255,184,0,0.18);background:rgba(255,184,0,0.05)">'
        '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#ffcf6d;margin-bottom:6px">Estimator workbook</div>'
        '<div style="font-size:13px;line-height:1.5;color:#f5f5f7">Workbook download, proposal PDF, and proposal HTML stay tied to the same bid state for review and client handoff.</div>'
        '</div>'
        '<div style="padding:12px 13px;border-radius:12px;border:1px solid rgba(110,230,162,0.16);background:rgba(110,230,162,0.05)">'
        '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#9ef0bf;margin-bottom:6px">Design artifacts</div>'
        '<div style="font-size:13px;line-height:1.5;color:#f5f5f7">GLB, IFC, and DXF downloads are available for internal review, estimate support, and downstream correction workflows.</div>'
        '</div>'
        '<div style="padding:12px 13px;border-radius:12px;border:1px solid rgba(255,184,0,0.20);background:rgba(255,184,0,0.06)">'
        '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#ffcf6d;margin-bottom:6px">Approval/evidence workbench</div>'
        '<div style="font-size:13px;line-height:1.5;color:#f5f5f7">Open the exact ledger rows, rejected candidates, and AI-guided correction tasks that keep client and company workflows anchored to real Halo Forge artifacts.</div>'
        '</div>'
        '</div>'
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">Visible caveats: missing approval gates stay visible</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(232,67,45,0.14);color:#ffb4aa;font-size:11px">Blocked claims: {_esc(blocked_count)} rule-check row(s)</span>'
        '<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(126,211,255,0.10);color:#d9f2ff;font-size:11px">Client and company workflows stay on real Halo Forge artifacts</span>'
        '</div>'
        '</section>'
    )


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if str(item)]
    text = str(value).strip()
    return [text] if text else []


def _approval_workbench_section(data: dict[str, Any], violations: list[dict[str, Any]]) -> str:
    evidence_workbench = data.get("evidence_workbench") or {}
    if not isinstance(evidence_workbench, dict):
        evidence_workbench = {}
    missing_evidence_ledger = data.get("missing_evidence_ledger") or {}
    if not isinstance(missing_evidence_ledger, dict):
        missing_evidence_ledger = {}

    ledger_rows = evidence_workbench.get("ledger_rows")
    if not isinstance(ledger_rows, list):
        ledger_rows = missing_evidence_ledger.get("rows") if isinstance(missing_evidence_ledger.get("rows"), list) else []

    portal_workflows = data.get("portal_workflows")
    if not isinstance(portal_workflows, list):
        portal_workflows = []

    visible_caveats = evidence_workbench.get("visible_caveats")
    if not isinstance(visible_caveats, list) or not visible_caveats:
        visible_caveats = data.get("warnings") if isinstance(data.get("warnings"), list) else []
    if not visible_caveats:
        visible_caveats = [str(v.get("message") or "") for v in violations if isinstance(v, dict) and v.get("message")]

    claims_blocked = evidence_workbench.get("claims_blocked")
    if not isinstance(claims_blocked, list) or not claims_blocked:
        claims_blocked = [str(v.get("code") or "") for v in violations if isinstance(v, dict) and v.get("code")]

    def _safe_join(values: Any, *, empty: str = "none") -> str:
        items = _string_list(values)
        return " | ".join(items) if items else empty

    row_cards: list[str] = []
    for row in ledger_rows:
        if not isinstance(row, dict):
            continue
        rejected_candidates = row.get("rejected_candidates") if isinstance(row.get("rejected_candidates"), list) else []
        rejected_items: list[str] = []
        for candidate in rejected_candidates[:2]:
            if not isinstance(candidate, dict):
                continue
            rejected_items.append(
                (
                    '<div style="padding:10px 12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);display:grid;gap:4px">'
                    f'<div style="font-size:12px;font-weight:700;color:#f5f5f7;overflow-wrap:anywhere">{_esc(candidate.get("candidate_ref"))}</div>'
                    f'<div style="font-size:11px;line-height:1.45;color:rgba(245,245,247,0.72)">{_esc(candidate.get("evidence_kind"))}</div>'
                    f'<div style="font-size:11px;line-height:1.45;color:rgba(245,245,247,0.72)">{_esc(candidate.get("rejection_reason"))}</div>'
                    f'<div style="font-size:10px;line-height:1.45;color:rgba(245,245,247,0.5);overflow-wrap:anywhere">{_esc(" | ".join(_string_list(candidate.get("source_refs"))))}</div>'
                    '</div>'
                )
            )
        rejected_html = (
            '<div style="display:grid;gap:8px">'
            '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">Rejected candidates</div>'
            f'<div style="display:grid;gap:8px">{"".join(rejected_items)}</div>'
            '</div>'
        ) if rejected_items else ""
        row_summary_display = str(row.get("ledger_row_summary") or "").replace("Gate ID:", "Gate")
        row_cards.append(
            (
                '<article style="border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);padding:12px 14px;display:grid;gap:8px">'
                '<details open style="display:grid;gap:8px">'
                '<summary style="cursor:pointer;list-style:none">'
                f'<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">{_esc(row.get("gate_kind"))}</div>'
                f'<div style="font-size:14px;font-weight:700;color:#f5f5f7;line-height:1.4">{_esc(row.get("human_label"))}</div>'
                f'<div style="font-size:11px;line-height:1.5;color:rgba(245,245,247,0.5);overflow-wrap:anywhere">{_esc(row.get("ledger_ref"))}</div>'
                '</summary>'
                '<div style="display:grid;gap:8px">'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.78)">{_esc(row.get("next_action"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72);overflow-wrap:anywhere">Row summary: {_esc(row_summary_display)}</div>'
                '<div style="display:grid;gap:8px">'
                '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">Gate / artifact</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Gate ID: {_esc(row.get("gate_id"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Missing artifact: {_esc(row.get("missing_artifact_ref"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Missing ref: {_esc(row.get("missing_ref"))}</div>'
                '</div>'
                '<div style="display:grid;gap:8px">'
                '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">Evidence and signature</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Acceptable evidence: {_esc(_safe_join(row.get("acceptable_evidence")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Acceptable evidence formats: {_esc(_safe_join(row.get("acceptable_evidence_formats")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Required fields: {_esc(_safe_join(row.get("required_fields")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Signature metadata: {_esc(json.dumps(row.get("signature_metadata") or {}, sort_keys=True))}</div>'
                '</div>'
                '<div style="display:grid;gap:8px">'
                '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">Roles and scans</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Who can satisfy: {_esc(_safe_join(row.get("who_can_satisfy")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Satisfying roles: {_esc(_safe_join(row.get("satisfying_roles")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Role authority: {_esc(_safe_join(row.get("role_authority")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Scanned paths: {_esc(_safe_join(row.get("scanned_paths")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Scanned source refs: {_esc(_safe_join(row.get("scanned_source_refs")))} </div>'
                '</div>'
                '<div style="display:grid;gap:8px">'
                '<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,245,247,0.5)">Blockers and candidates</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Claims blocked: {_esc(_safe_join(row.get("claims_blocked")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Blocked claims: {_esc(_safe_join(row.get("blocked_claims")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Blocked claim gates: {_esc(_safe_join(row.get("blocked_claim_gates")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">AI fallback: {_esc(row.get("ai_fallback"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Next collection action: {_esc(row.get("next_collection_action"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Rejected candidate summary: {_esc(row.get("rejected_candidate_summary"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Rejected candidate count: {_esc(row.get("rejected_candidate_count"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Rejected candidate refs: {_esc(_safe_join(row.get("rejected_candidate_refs")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Rejected candidate reasons: {_esc(_safe_join(row.get("rejected_candidate_reasons")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8);overflow-wrap:anywhere">Rejected candidate source refs: {_esc(_safe_join(row.get("rejected_candidate_source_refs")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.8)">Current candidates: {_esc(row.get("current_candidate_count"))} scanned · {_esc(row.get("usable_evidence_count"))} usable</div>'
                '</div>'
                f'{rejected_html}'
                '</div>'
                '</details>'
                '</article>'
            )
        )

    workflow_cards: list[str] = []
    for workflow in portal_workflows:
        if not isinstance(workflow, dict):
            continue
        workflow_cards.append(
            (
                '<article style="border:1px solid rgba(126,211,255,0.16);background:rgba(126,211,255,0.04);padding:12px 14px;display:grid;gap:6px">'
                f'<div style="font-size:11px;font-weight:700;color:#b9ecff;letter-spacing:0.08em;text-transform:uppercase">{_esc(workflow.get("workflow_id"))}</div>'
                f'<div style="font-size:13px;font-weight:700;color:#f5f5f7">{_esc(workflow.get("title"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.76)">{_esc(workflow.get("summary"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72)">Audience: {_esc(workflow.get("audience"))} · Status: {_esc(workflow.get("status"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72)">Current gate: {_esc(workflow.get("current_gate"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72)">Next action: {_esc(workflow.get("next_action"))}</div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72)">Visible caveats: {_esc(_safe_join(workflow.get("visible_caveats")))} </div>'
                f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.72)">Claims blocked: {_esc(_safe_join(workflow.get("claims_blocked")))} </div>'
                '</article>'
            )
        )

    if not row_cards and not workflow_cards:
        return (
            '<section style="margin-top:16px;padding:16px 18px;border:1px solid rgba(255,184,0,0.20);border-radius:14px;background:rgba(255,184,0,0.04);">'
            '<div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#ffcf6d;margin-bottom:8px">Approval/evidence workbench</div>'
            '<div style="font-size:14px;line-height:1.55;color:#f5f5f7">No evidence workbench rows were supplied yet. The portal bundle still exposes the signed artifact downloads and blocked caveats.</div>'
            '</section>'
        )

    workflow_html = (
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px">'
        f'{"".join(workflow_cards)}'
        '</div>'
        if workflow_cards
        else ''
    )
    row_html = (
        '<div style="display:grid;gap:10px">'
        f'{"".join(row_cards)}'
        '</div>'
        if row_cards
        else ''
    )
    return (
        '<section style="margin-top:16px;padding:18px 20px;border:1px solid rgba(255,184,0,0.20);border-radius:14px;background:rgba(255,184,0,0.04);">'
        '<div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#ffcf6d;margin-bottom:8px">Approval/evidence workbench</div>'
        '<div style="font-size:18px;font-weight:700;line-height:1.25;margin-bottom:8px">Exact missing-evidence ledger rows for bid 1881</div>'
        '<div style="font-size:14px;line-height:1.55;color:#d0d0d6;margin-bottom:10px">Use the row cards to review gate id, missing artifact/ref, acceptable evidence formats, required fields, signature metadata, who can satisfy it, scanned paths, rejected candidates, blocked claims, and next action.</div>'
        f'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">{_esc(len(ledger_rows))} exact ledger row(s)</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(232,67,45,0.14);color:#ffb4aa;font-size:11px">{_esc(len(claims_blocked))} blocked claim(s)</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(126,211,255,0.10);color:#d9f2ff;font-size:11px">Current gate: {_esc(evidence_workbench.get("current_gate") or missing_evidence_ledger.get("current_gate") or "n/a")}</span>'
        '</div>'
        f'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">Visible caveats: {_esc(_safe_join(visible_caveats))}</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(232,67,45,0.14);color:#ffb4aa;font-size:11px">Blocked claims: {_esc(_safe_join(claims_blocked))}</span>'
        '</div>'
        f'{row_html}'
        '<div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#ffcf6d;margin:16px 0 8px">Client and company workflows</div>'
        f'<div style="font-size:13px;line-height:1.55;color:#d0d0d6;margin-bottom:10px">{_esc(len(workflow_cards))} workflow card(s) keep the client share, delivery workflow, catalog approval, capture preflight, hydraulic replay, correction tasks, upload status, and obstruction review aligned to the same signed bid state.</div>'
        f'{workflow_html}'
        '</section>'
    )


def _evidence_upload_status_section(data: dict[str, Any]) -> str:
    upload_status = data.get("evidence_upload_status")
    if not isinstance(upload_status, dict):
        return (
            '<section style="margin-top:16px;padding:16px 18px;border:1px solid rgba(126,211,255,0.18);border-radius:14px;background:rgba(126,211,255,0.04);">'
            '<div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#7ed3ff;margin-bottom:8px">Evidence upload status</div>'
            '<div style="font-size:14px;line-height:1.55;color:#f5f5f7">No upload-status payload was supplied yet. The signed bundle still exposes the downloads and blocked caveats, but the upload lane remains visible as a separate gate.</div>'
            '</section>'
        )

    summary = upload_status.get("summary") if isinstance(upload_status.get("summary"), dict) else {}
    uploads = [
        upload for upload in upload_status.get("uploads", [])
        if isinstance(upload, dict)
    ] if isinstance(upload_status.get("uploads"), list) else []
    rejected_uploads = [
        upload for upload in upload_status.get("rejected_uploads", [])
        if isinstance(upload, dict)
    ] if isinstance(upload_status.get("rejected_uploads"), list) else []

    def _upload_card(upload: dict[str, Any], *, label: str, border: str, background: str) -> str:
        fields = [
            ("File", upload.get("file_name")),
            ("Upload ref", upload.get("upload_ref")),
            ("Evidence lane", upload.get("evidence_lane")),
            ("Status", upload.get("status")),
            ("Saved path", upload.get("saved_path")),
            ("SHA256", upload.get("sha256")),
            ("Size bytes", upload.get("size_bytes")),
            ("Source ref", upload.get("source_ref")),
            ("Note", upload.get("note")),
            ("Rejection reason", upload.get("rejection_reason")),
        ]
        details = "".join(
            f'<div style="font-size:12px;line-height:1.5;color:rgba(245,245,247,0.78);overflow-wrap:anywhere"><strong>{_esc(field_label)}:</strong> {_esc(field_value)}</div>'
            for field_label, field_value in fields
            if field_value not in (None, "", [])
        )
        return (
            f'<article style="border:1px solid {border};background:{background};padding:12px 14px;display:grid;gap:6px">'
            f'<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#7ed3ff">{_esc(label)}</div>'
            f'{details}'
            '</article>'
        )

    staged_cards = [
        _upload_card(
            upload,
            label="Staged upload",
            border="rgba(126,211,255,0.16)",
            background="rgba(126,211,255,0.04)",
        )
        for upload in uploads
    ]
    rejected_cards = [
        _upload_card(
            upload,
            label="Rejected upload",
            border="rgba(232,67,45,0.22)",
            background="rgba(232,67,45,0.05)",
        )
        for upload in rejected_uploads
    ]

    staged_html = (
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">'
        f'{"".join(staged_cards)}'
        '</div>'
        if staged_cards
        else '<div style="font-size:13px;line-height:1.55;color:rgba(245,245,247,0.72)">No staged uploads yet.</div>'
    )
    rejected_html = (
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">'
        f'{"".join(rejected_cards)}'
        '</div>'
        if rejected_cards
        else '<div style="font-size:13px;line-height:1.55;color:rgba(245,245,247,0.72)">No rejected uploads recorded.</div>'
    )

    status = str(upload_status.get("status") or "missing")
    artifact_dir = str(upload_status.get("artifact_dir") or "")
    source_ref = str(upload_status.get("source_ref") or "")
    upload_lane_ready = bool(upload_status.get("upload_lane_ready"))
    claims_cleared = bool(upload_status.get("claims_cleared"))
    upload_count = int(upload_status.get("upload_count") or len(uploads))
    staged_upload_count = int(upload_status.get("staged_upload_count") or len(uploads))
    rejected_upload_count = int(upload_status.get("rejected_upload_count") or len(rejected_uploads))
    overwritten_upload_count = int(upload_status.get("overwritten_upload_count") or 0)
    claims_cleared_count = int(upload_status.get("claims_cleared_count") or summary.get("claims_cleared_count") or 0)
    next_action = str(summary.get("next_action") or upload_status.get("next_action") or "").strip()

    return (
        '<section style="margin-top:16px;padding:18px 20px;border:1px solid rgba(126,211,255,0.18);border-radius:14px;background:rgba(126,211,255,0.04);">'
        '<div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#7ed3ff;margin-bottom:8px">Evidence upload status</div>'
        '<div style="font-size:18px;font-weight:700;line-height:1.25;margin-bottom:8px">Upload lane and rejected-file truth</div>'
        '<div style="font-size:14px;line-height:1.55;color:#d0d0d6;margin-bottom:10px">Use this lane to inspect staged uploads, rejected uploads, saved paths, hashes, source refs, and rejection reasons before asking anyone to treat a file as cleared evidence.</div>'
        f'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(126,211,255,0.10);color:#d9f2ff;font-size:11px">Status: {_esc(status)}</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(126,211,255,0.10);color:#d9f2ff;font-size:11px">Upload lane ready: {_esc(upload_lane_ready)}</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">{_esc(upload_count)} total upload(s)</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">{_esc(staged_upload_count)} staged</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(232,67,45,0.14);color:#ffb4aa;font-size:11px">{_esc(rejected_upload_count)} rejected</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">{_esc(overwritten_upload_count)} overwritten</span>'
        f'<span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:#f5f5f7;font-size:11px">Claims cleared: {_esc(claims_cleared)} · { _esc(claims_cleared_count) } cleared claim(s)</span>'
        '</div>'
        f'<div style="font-size:12px;line-height:1.55;color:rgba(245,245,247,0.72);margin-bottom:10px;overflow-wrap:anywhere">Artifact dir: {_esc(artifact_dir)}</div>'
        f'<div style="font-size:12px;line-height:1.55;color:rgba(245,245,247,0.72);margin-bottom:10px;overflow-wrap:anywhere">Source ref: {_esc(source_ref)}</div>'
        f'<div style="display:grid;gap:12px;margin-bottom:10px"><div><div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#7ed3ff;margin-bottom:6px">Staged uploads</div>{staged_html}</div><div><div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#ffcf6d;margin-bottom:6px">Rejected uploads</div>{rejected_html}</div></div>'
        f'<div style="font-size:12px;line-height:1.55;color:rgba(245,245,247,0.72)">Next action: {_esc(next_action or "Review staged uploads and rejected-file reasons before clearing any claim.")}</div>'
        '</section>'
    )


def _chart_section(data: dict[str, Any], levels: list[dict[str, Any]], systems: list[dict[str, Any]]) -> str:
    pricing = data.get('pricing') or {}
    cost_items = [
        {'label': 'Materials', 'value': float(pricing.get('materials_usd', 0) or 0), 'color': '#e8432d'},
        {'label': 'Labor', 'value': float(pricing.get('labor_usd', 0) or 0), 'color': '#f6a04d'},
        {'label': 'Permit', 'value': float(pricing.get('permit_allowance_usd', 0) or 0), 'color': '#7cc6fe'},
        {'label': 'Taxes', 'value': float(pricing.get('taxes_usd', 0) or 0), 'color': '#8dd36b'},
        {'label': 'Subtotal', 'value': float(pricing.get('subtotal_usd', 0) or 0), 'color': '#d9d9d9'},
        {'label': 'Total', 'value': float(pricing.get('total_usd', 0) or 0), 'color': '#ffffff'},
    ]
    level_items = [
        {
            'label': lvl.get('name') or lvl.get('id') or 'Level',
            'value': float(lvl.get('head_count', 0) or 0),
            'meta': f"{lvl.get('pipe_count', 0)} pipes",
            'color': '#7cc6fe',
        }
        for lvl in levels
    ]
    system_items = [
        {
            'label': system.get('type') or system.get('id') or 'System',
            'value': float(system.get('head_count', 0) or 0),
            'meta': f"{float(system.get('pipe_total_m', 0) or 0):.1f} m pipe",
            'color': '#f6a04d',
        }
        for system in systems
    ]
    return (
        '<section><h2>Charts</h2>'
        '<p class="section-note">The cost, level, and system charts are derived from the same proposal JSON that feeds the gateway portal.</p>'
        '<div class="chart-grid">'
        f'{_chart_card("Cost breakdown", cost_items)}'
        f'{_chart_card("Heads by level", level_items)}'
        f'{_chart_card("Heads by system", system_items)}'
        '</div></section>'
    )


def _download_section(data: dict[str, Any]) -> str:
    return (
        '<section><h2>Downloads</h2>'
        '<p class="section-note">These are the real bid artifacts generated beside this HTML page.</p>'
        f'{_download_grid(data)}'
        '</section>'
    )


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
        + _access_banner()
        + _portal_bundle_section(violations)
        + _approval_workbench_section(data, violations)
        + _evidence_upload_status_section(data)
        # Hero band — landing page moment. Two-panel: big plan SVG
        # (first level that has any geometry) on the left, the
        # live 3D model-viewer on the right. Falls back gracefully
        # when a design payload isn't available.
        + _hero_section(levels, design, design_glb, project)
        + f'<section><h2>Project summary</h2><div class="kpi-grid">{kpi_html}</div></section>'
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
        + _chart_section(data, levels, systems)
        + _download_section(data)
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
    render_data = dict(data)
    if not render_data.get('violations'):
        violations_path = out_dir / 'violations.json'
        if violations_path.exists():
            try:
                render_data['violations'] = json.loads(violations_path.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                render_data['violations'] = []
    out.write_text(
        build_proposal_html(render_data, design=design, design_glb=design_glb),
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
