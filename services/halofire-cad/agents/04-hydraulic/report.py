"""Phase C.6 — NFPA 13 §28.6-compliant hydraulic calc report.

Renders a `HydraulicResult` into:
  1. Plain-text node-by-node trace (AHJ reviewers still love this)
  2. HTML report with color-coded safety margin
  3. Data dict for the proposal JSON

Per AGENTIC_RULES §13 honesty: the report always surfaces
Alpha limitations (tree-only solver, naive remote-area, no pump
iteration). A licensed PE must review before any AHJ submittal.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import HydraulicResult, System  # noqa: E402


ALPHA_DISCLAIMER = (
    "INTERNAL ALPHA REPORT — NOT FOR PERMIT SUBMITTAL. Computed by "
    "HaloFire CAD with approximations documented in the issues list. "
    "A licensed fire-protection engineer must review before AHJ use."
)


def render_plain_text(system: System, result: HydraulicResult) -> str:
    """NFPA §28.6-style node trace. Line length kept ≤ 80 chars."""
    lines: list[str] = []
    lines.append(f"HaloFire Hydraulic Calculation Report — System {system.id}")
    lines.append("=" * 78)
    lines.append("")
    lines.append(ALPHA_DISCLAIMER)
    lines.append("")
    lines.append(f"Design area        : {result.design_area_sqft:>8.1f} sqft")
    lines.append(f"Design density     : {result.density_gpm_per_sqft:>8.3f} gpm/sqft")
    lines.append(f"Required flow      : {result.required_flow_gpm:>8.1f} gpm")
    lines.append(f"Required pressure  : {result.required_pressure_psi:>8.1f} psi")
    lines.append("-" * 78)
    lines.append(f"Supply static      : {result.supply_static_psi:>8.1f} psi")
    lines.append(f"Supply residual    : {result.supply_residual_psi:>8.1f} psi")
    lines.append(f"Supply flow        : {result.supply_flow_gpm:>8.1f} gpm")
    lines.append("-" * 78)
    lines.append(f"Demand at riser    : {result.demand_at_base_of_riser_psi:>8.1f} psi")
    lines.append(f"Safety margin      : {result.safety_margin_psi:>8.1f} psi")
    lines.append(f"Converged          : {result.converged}")
    lines.append(f"Iterations         : {result.iterations}")
    lines.append("")
    if result.critical_path:
        lines.append(f"Critical path ({len(result.critical_path)} segments):")
        for seg_id in result.critical_path[:20]:
            lines.append(f"  {seg_id}")
        if len(result.critical_path) > 20:
            lines.append(f"  ... +{len(result.critical_path) - 20} more")
        lines.append("")
    if result.issues:
        lines.append("Issues + limitations:")
        for issue in result.issues:
            lines.append(f"  * {issue}")
        lines.append("")
    return "\n".join(lines)


def render_html(system: System, result: HydraulicResult) -> str:
    """Minimal self-contained HTML calc sheet.

    Styling is inline so the file opens anywhere. Color-codes safety
    margin: green ≥10, amber 5-10, red <5.
    """
    margin = result.safety_margin_psi
    color = "#16a34a" if margin >= 10 else ("#f59e0b" if margin >= 5 else "#dc2626")
    converged_badge = (
        '<span style="color: #16a34a">CONVERGED</span>' if result.converged
        else '<span style="color: #dc2626">NOT CONVERGED</span>'
    )
    issue_html = "".join(
        f'<li style="color: #dc2626"><code>{i}</code></li>'
        for i in result.issues
    )
    critical_html = "".join(
        f"<li><code>{s}</code></li>" for s in result.critical_path[:30]
    )
    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>Hydraulic Calc — {system.id}</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif;
    max-width: 900px; margin: 2em auto; padding: 0 1em; color: #111; }}
  h1 {{ border-bottom: 3px solid #111; padding-bottom: 0.3em; }}
  .alpha {{ background: #fff7ed; border: 2px solid #ea580c;
    padding: 1em; margin: 1em 0; color: #9a3412; }}
  table.numbers {{ border-collapse: collapse; margin: 1em 0; width: 100%; }}
  table.numbers td {{ padding: 0.4em 0.8em;
    border-bottom: 1px solid #e5e7eb; }}
  table.numbers td:first-child {{ color: #6b7280; }}
  .margin-box {{ background: {color}15; border-left: 6px solid {color};
    padding: 1em; margin: 1em 0; font-size: 1.2em; }}
  code {{ font-family: "JetBrains Mono", Consolas, monospace;
    font-size: 0.9em; background: #f3f4f6; padding: 1px 4px; }}
  ul {{ padding-left: 1.5em; }}
</style>
</head><body>
<h1>Hydraulic Calculation Report</h1>
<p><strong>System:</strong> <code>{system.id}</code> ({system.type})</p>
<div class="alpha">{ALPHA_DISCLAIMER}</div>

<h2>Design basis</h2>
<table class="numbers">
  <tr><td>Design area</td><td>{result.design_area_sqft:.1f} sqft</td></tr>
  <tr><td>Design density</td><td>{result.density_gpm_per_sqft:.3f} gpm/sqft</td></tr>
  <tr><td>Required flow</td><td>{result.required_flow_gpm:.1f} gpm</td></tr>
  <tr><td>Required pressure</td><td>{result.required_pressure_psi:.1f} psi</td></tr>
</table>

<h2>Supply</h2>
<table class="numbers">
  <tr><td>Static</td><td>{result.supply_static_psi:.1f} psi</td></tr>
  <tr><td>Residual</td><td>{result.supply_residual_psi:.1f} psi</td></tr>
  <tr><td>Flow</td><td>{result.supply_flow_gpm:.1f} gpm</td></tr>
</table>

<h2>Demand</h2>
<table class="numbers">
  <tr><td>At base of riser</td><td>{result.demand_at_base_of_riser_psi:.1f} psi</td></tr>
  <tr><td>Status</td><td>{converged_badge} ({result.iterations} iterations)</td></tr>
</table>

<div class="margin-box">
  <strong>Safety margin: {margin:.1f} psi</strong>
</div>

<h2>Critical path ({len(result.critical_path)} segments)</h2>
<ul>{critical_html or '<li><em>none reported</em></li>'}</ul>

<h2>Issues &amp; limitations</h2>
<ul>{issue_html or '<li><em>none</em></li>'}</ul>
</body></html>"""


def render_report_bundle(
    system: System, result: HydraulicResult, out_dir: Path,
) -> dict[str, str]:
    """Write both text + HTML reports to disk. Return path dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    txt_path = out_dir / f"hydraulic_{system.id}.txt"
    html_path = out_dir / f"hydraulic_{system.id}.html"
    txt_path.write_text(render_plain_text(system, result), encoding="utf-8")
    html_path.write_text(render_html(system, result), encoding="utf-8")
    return {"txt": str(txt_path), "html": str(html_path)}
