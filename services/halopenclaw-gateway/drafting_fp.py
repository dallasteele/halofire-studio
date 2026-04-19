"""Fire-Protection AHJ sheet-set renderer.

Generates a multi-page PDF (FP-0 cover → FP-N per-level plans → FP-H
hydraulic placard) the AHJ reviewer actually expects for permit review.

Inputs are a `sheet_set` dict:
{
  "project": {
    "name": str,
    "address": str,
    "apn": str,
    "ahj": str,
    "construction_type": str,
    "code": str,
    "architect": str,
    "gc": str,
    "total_sqft": int,
  },
  "halofire": { "contact": str, "office_address": str, "office_phone": str,
                "license": str, "proposal_date": str, "proposal_price_usd": float },
  "systems": [{"id": str, "type": str, "serves": str, "hazard": str}, ...],
  "levels": [
    { "id": str, "name": str, "elevation_ft": float, "sqft": int,
      "hazard": str, "width_m": float, "length_m": float,
      "heads": [{"id": str, "x_m": float, "y_m": float, "sku": str}, ...],
      "pipes": [{"from": str, "to": str, "size_in": float,
                  "x1_m": float, "y1_m": float, "x2_m": float, "y2_m": float}, ...],
    }, ...
  ],
  "hydraulic": { "flow_gpm": float, "static_psi": float, "residual_psi": float,
                 "demand_psi": float, "safety_margin_psi": float, "notes": str },
}
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as patches
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

# Letter @ landscape (17×11 sheet = 24×36" D-size would be ideal but
# Letter prints clean on every office printer without tiling).
SHEET_W_IN = 17.0
SHEET_H_IN = 11.0
TITLE_H = 1.6  # inches reserved for title block at bottom


def _draw_title_block(fig, sheet_no: str, sheet_name: str, project: dict,
                       halo: dict, revision: str = "BID SET") -> None:
    """Halo Fire title block across the bottom 1.6" of every sheet."""
    # Title block axes cover the bottom strip
    ax = fig.add_axes([0.01, 0.01, 0.98, TITLE_H / SHEET_H_IN - 0.01])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 10)
    ax.axis("off")

    # Outer box
    ax.add_patch(patches.Rectangle((0, 0), 100, 10, fill=False,
                                     edgecolor="black", linewidth=1.5))

    # Sheet number (far right, large)
    ax.add_patch(patches.Rectangle((82, 0), 18, 10, fill=False,
                                     edgecolor="black", linewidth=1.0))
    ax.text(91, 6.5, sheet_no, ha="center", va="center",
             fontsize=26, fontweight="bold", family="monospace")
    ax.text(91, 2.2, sheet_name, ha="center", va="center",
             fontsize=8, family="sans-serif")

    # Halo Fire logo block (far left)
    ax.add_patch(patches.Rectangle((0, 0), 22, 10, fill=False,
                                     edgecolor="black", linewidth=1.0))
    ax.add_patch(patches.Rectangle((1, 7.5), 4.5, 1.8, facecolor="#e8432d",
                                     edgecolor="#e8432d"))
    ax.text(3.25, 8.4, "HF", ha="center", va="center",
             fontsize=10, fontweight="bold", color="white")
    ax.text(6.5, 8.4, "HALO FIRE PROTECTION, LLC",
             ha="left", va="center", fontsize=8, fontweight="bold")
    ax.text(1, 6.6, halo.get("office_address", ""), fontsize=6)
    ax.text(1, 5.6, halo.get("office_phone", ""), fontsize=6)
    ax.text(1, 4.6, halo.get("license", ""), fontsize=6)
    ax.text(1, 2.5, f"Contact: {halo.get('contact', '')}", fontsize=6)
    ax.text(1, 1.5, f"Date: {halo.get('proposal_date', '')}",
             fontsize=6, family="monospace")

    # Project info (center)
    ax.text(24, 8.8, project.get("name", ""), fontsize=11, fontweight="bold")
    ax.text(24, 7.2, project.get("address", ""), fontsize=8)
    ax.text(24, 5.8, f"APN: {project.get('apn', '')}    "
                      f"Code: {project.get('code', '')}",
             fontsize=7, family="monospace")
    ax.text(24, 4.4, f"AHJ: {project.get('ahj', '')}    "
                      f"Construction: {project.get('construction_type', '')}",
             fontsize=7, family="monospace")
    ax.text(24, 2.9, f"Architect: {project.get('architect', '')}",
             fontsize=7)
    ax.text(24, 1.6, f"GC: {project.get('gc', '')}", fontsize=7)

    # Revision block
    ax.add_patch(patches.Rectangle((62, 0), 20, 10, fill=False,
                                     edgecolor="black", linewidth=1.0))
    ax.text(72, 8.2, "REVISION", ha="center", fontsize=7, fontweight="bold")
    ax.text(72, 6.5, revision, ha="center", fontsize=9, family="monospace")
    ax.text(72, 4.5, "DEFERRED SUBMITTAL", ha="center",
             fontsize=7, fontweight="bold", color="#c00")
    ax.text(72, 3.0, "NOT FOR CONSTRUCTION", ha="center",
             fontsize=6, color="#c00", fontstyle="italic")
    ax.text(72, 1.3, datetime.now().strftime("%Y-%m-%d %H:%M"),
             ha="center", fontsize=6, family="monospace")


def _new_sheet(sheet_no: str, sheet_name: str, project: dict, halo: dict):
    fig = plt.figure(figsize=(SHEET_W_IN, SHEET_H_IN), facecolor="white")
    # Drawing area above the title block
    ax = fig.add_axes([0.04, (TITLE_H / SHEET_H_IN) + 0.01,
                        0.92, 1 - (TITLE_H / SHEET_H_IN) - 0.05])
    _draw_title_block(fig, sheet_no, sheet_name, project, halo)
    return fig, ax


def _draw_cover(pdf: PdfPages, data: dict) -> int:
    project = data.get("project", {})
    halo = data.get("halofire", {})
    levels = data.get("levels", [])
    systems = data.get("systems", [])

    fig, ax = _new_sheet("FP-0", "COVER SHEET", project, halo)
    ax.axis("off")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)

    ax.text(50, 92, "FIRE PROTECTION", ha="center", fontsize=32,
             fontweight="bold")
    ax.text(50, 85, "DEFERRED SUBMITTAL — PERMIT REVIEW", ha="center",
             fontsize=14, color="#c00")

    ax.text(50, 78, project.get("name", ""), ha="center", fontsize=18,
             fontweight="bold")
    ax.text(50, 74, project.get("address", ""), ha="center", fontsize=11)

    # Sheet index
    ax.text(5, 65, "SHEET INDEX", fontsize=12, fontweight="bold")
    ax.add_patch(patches.Rectangle((5, 20), 42, 43, fill=False, linewidth=1))
    idx_lines = [
        ("FP-0", "Cover sheet + sheet index + general notes"),
        ("FP-H", "Hydraulic placard + system summary"),
    ]
    for i, lvl in enumerate(levels):
        idx_lines.append((f"FP-{i + 1}",
                          f"{lvl.get('name', '')} — sprinkler plan"))
    y = 60
    for sh, desc in idx_lines:
        ax.text(7, y, sh, fontsize=9, fontweight="bold", family="monospace")
        ax.text(15, y, desc, fontsize=9)
        y -= 2.2

    # General notes
    ax.text(52, 65, "GENERAL NOTES", fontsize=12, fontweight="bold")
    ax.add_patch(patches.Rectangle((52, 5), 43, 58, fill=False, linewidth=1))
    notes = [
        "1. All work per NFPA 13 2022 edition and local AHJ amendments.",
        f"2. Building code: {project.get('code', '')}.",
        f"3. Construction type: {project.get('construction_type', '')}.",
        f"4. Total building area: {project.get('total_sqft', 0):,} sqft.",
        "5. Scope begins 6\" above finished floor at riser flange.",
        "6. Underground fire service by others (excluded from this submittal).",
        "7. Combination wet standpipe + sprinkler systems on residential levels.",
        "8. Dry-pipe systems in unheated garage levels.",
        "9. Hydraulic calculations on FP-H.",
        "10. Head spacing per NFPA 13 §11.2.3.1.1 for the hazard class shown.",
        "11. Pipe sizing per NFPA 13 §28.5 schedule method.",
        "12. Coordinate riser room location + FDC with GC prior to rough-in.",
        "13. FDC wall-mount on address side of building per SLC Fire Marshal.",
        "14. Halo Fire responsible for deferred-submittal design + install.",
        "15. Pipe + hanger extension to gridline 30.8 for Phase 2 tie-in.",
    ]
    y = 60
    for n in notes:
        ax.text(53, y, n, fontsize=7)
        y -= 2.0

    # Systems summary at bottom
    ax.text(50, 16, "FIRE PROTECTION SYSTEMS", ha="center", fontsize=11,
             fontweight="bold")
    ax.add_patch(patches.Rectangle((5, 3), 90, 11, fill=False, linewidth=1))
    ax.text(7, 12.5, "ID", fontsize=8, fontweight="bold", family="monospace")
    ax.text(18, 12.5, "TYPE", fontsize=8, fontweight="bold", family="monospace")
    ax.text(38, 12.5, "SERVES", fontsize=8, fontweight="bold", family="monospace")
    ax.text(75, 12.5, "HAZARD", fontsize=8, fontweight="bold", family="monospace")
    ax.plot([6, 94], [11.7, 11.7], color="black", linewidth=0.5)
    y = 10
    for s in systems:
        ax.text(7, y, s.get("id", ""), fontsize=7, family="monospace")
        ax.text(18, y, s.get("type", ""), fontsize=7, family="monospace")
        ax.text(38, y, s.get("serves", ""), fontsize=7)
        ax.text(75, y, s.get("hazard", ""), fontsize=7, family="monospace")
        y -= 1.6

    pdf.savefig(fig)
    plt.close(fig)
    return 1


def _draw_level_plan(pdf: PdfPages, data: dict, idx: int, level: dict) -> int:
    project = data.get("project", {})
    halo = data.get("halofire", {})
    fig, ax = _new_sheet(f"FP-{idx + 1}",
                          f"{level.get('name', '').upper()} PLAN",
                          project, halo)

    W = max(1.0, float(level.get("width_m", 30.0)))
    L = max(1.0, float(level.get("length_m", 30.0)))
    ax.set_xlim(-2, W + 2)
    ax.set_ylim(-2, L + 2)
    ax.set_aspect("equal")
    ax.grid(True, linestyle=":", alpha=0.3, color="gray")

    # Building outline
    ax.add_patch(patches.Rectangle((0, 0), W, L, fill=False,
                                     edgecolor="black", linewidth=2.0, zorder=3))
    # Hazard shading
    hz = level.get("hazard", "light")
    hz_colors = {
        "light": "#eaf5ff",
        "ordinary_i": "#fff6d6",
        "ordinary_ii": "#ffe9b5",
        "extra_i": "#ffd6c0",
        "extra_ii": "#ffb8a0",
    }
    ax.add_patch(patches.Rectangle((0, 0), W, L,
                                     facecolor=hz_colors.get(hz, "#f5f5f5"),
                                     edgecolor="none", alpha=0.5, zorder=1))

    # Pipes first (under heads)
    size_to_color = {
        1.0: "#d0d0ff", 1.25: "#a0a0ff", 1.5: "#7070ff",
        2.0: "#4040dd", 2.5: "#2020bb", 3.0: "#000099",
    }
    for p in level.get("pipes", []):
        sz = float(p.get("size_in", 1.0))
        col = size_to_color.get(sz, "#555555")
        lw = 0.8 + sz  # 1" -> 1.8, 3" -> 3.8
        ax.plot([p["x1_m"], p["x2_m"]], [p["y1_m"], p["y2_m"]],
                color=col, linewidth=lw, zorder=4, solid_capstyle="round")

    # Heads
    for h in level.get("heads", []):
        ax.plot(h["x_m"], h["y_m"], marker="o", markersize=6,
                 markerfacecolor="#e8432d", markeredgecolor="black",
                 markeredgewidth=0.5, zorder=5)

    # Legend
    legend_patches = [
        patches.Patch(color=hz_colors.get(hz, "#f5f5f5"),
                       alpha=0.5, label=f"Hazard: {hz}"),
    ]
    for sz in sorted(size_to_color):
        legend_patches.append(
            patches.Patch(color=size_to_color[sz], label=f'{sz}" pipe'))
    ax.legend(handles=legend_patches, loc="upper right", fontsize=7,
               framealpha=0.9)

    # Counts
    hc = len(level.get("heads", []))
    pc = len(level.get("pipes", []))
    total_len = sum(
        ((p["x2_m"] - p["x1_m"]) ** 2
         + (p["y2_m"] - p["y1_m"]) ** 2) ** 0.5
        for p in level.get("pipes", [])
    )
    ax.set_title(
        f"{level.get('name', '')}  —  "
        f"{hc} heads, {pc} segments, {total_len:.1f} m ({total_len * 3.281:.1f} ft) pipe",
        fontsize=11, fontweight="bold", loc="left")

    # N arrow
    ax.annotate("N", xy=(W + 1, L - 0.5), xytext=(W + 1, L - 2.5),
                 ha="center", fontsize=12, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color="black", lw=1.5))
    ax.set_xlabel("meters (west → east)")
    ax.set_ylabel("meters (south → north)")

    pdf.savefig(fig)
    plt.close(fig)
    return 1


def _draw_hydraulic_placard(pdf: PdfPages, data: dict) -> int:
    project = data.get("project", {})
    halo = data.get("halofire", {})
    hydraulic = data.get("hydraulic", {}) or {}
    fig, ax = _new_sheet("FP-H", "HYDRAULIC PLACARD", project, halo)
    ax.axis("off")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)

    ax.text(50, 92, "HYDRAULIC DATA PLACARD", ha="center",
             fontsize=22, fontweight="bold")
    ax.text(50, 86, "Post at main riser per NFPA 13 §28.6",
             ha="center", fontsize=10, style="italic")

    # Box with key values
    ax.add_patch(patches.Rectangle((10, 20), 80, 60, fill=False, linewidth=2))
    rows = [
        ("System flow demand",
         f"{hydraulic.get('flow_gpm', 0):.1f} gpm"),
        ("Static pressure",
         f"{hydraulic.get('static_psi', 0):.1f} psi"),
        ("Residual pressure (flow test)",
         f"{hydraulic.get('residual_psi', 0):.1f} psi"),
        ("Demand pressure at base of riser",
         f"{hydraulic.get('demand_psi', 0):.1f} psi"),
        ("Safety margin",
         f"{hydraulic.get('safety_margin_psi', 0):.1f} psi"),
        ("Hose allowance (§19.3.3)", "100 gpm"),
        ("Design area", "Most remote 1,500 sqft"),
        ("Density (light hazard)", "0.10 gpm/sqft"),
    ]
    y = 76
    for k, v in rows:
        ax.text(14, y, k, fontsize=11)
        ax.text(86, y, v, fontsize=11, fontweight="bold",
                 family="monospace", ha="right")
        ax.plot([12, 88], [y - 1.5, y - 1.5], color="#ccc", linewidth=0.3)
        y -= 7

    if hydraulic.get("notes"):
        ax.text(50, 14, hydraulic["notes"], ha="center", fontsize=9,
                 style="italic", wrap=True)
    pdf.savefig(fig)
    plt.close(fig)
    return 1


def render_sheet_set(data: dict[str, Any], out_path: str) -> int:
    """Render the full FP sheet-set to a multi-page PDF.

    Returns the number of pages written.
    """
    pages = 0
    with PdfPages(out_path) as pdf:
        pages += _draw_cover(pdf, data)
        for i, lvl in enumerate(data.get("levels", [])):
            pages += _draw_level_plan(pdf, data, i, lvl)
        pages += _draw_hydraulic_placard(pdf, data)
    return pages
