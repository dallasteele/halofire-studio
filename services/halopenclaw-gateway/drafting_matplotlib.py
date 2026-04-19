"""Render the equipment schedule to a PNG plan drawing via matplotlib."""
import sys, math, yaml
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.transforms import Affine2D


def draw(schedule, out_path, dpi=150):
    room = schedule["room"]
    W, L = room["width_cm"], room["length_cm"]

    fig, ax = plt.subplots(figsize=(14, 11), dpi=dpi)
    ax.set_xlim(-200, W + 200)
    ax.set_ylim(-200, L + 200)
    ax.set_aspect("equal")

    # Room walls
    ax.add_patch(patches.Rectangle((0, 0), W, L, fill=False,
                                     edgecolor="black", linewidth=2.0, zorder=3))

    # Zones (dashed)
    zone_colors = {
        "main_dining":    "#f0f8ff",
        "serving_alcove": "#fff0e0",
        "kitchen":        "#e8f5e0",
        "tray_return":    "#f8e8e8",
        "serving_bypass": "#fff8c0",
    }
    for zone in schedule.get("zones", []):
        (x0, y0), (x1, y1) = zone["bbox_cm"]
        c = zone_colors.get(zone["id"], "#f0f0f0")
        ax.add_patch(patches.Rectangle((x0, y0), x1-x0, y1-y0,
                                         facecolor=c, edgecolor="gray",
                                         linewidth=0.5, linestyle="--",
                                         alpha=0.7, zorder=1))
        ax.text((x0+x1)/2, (y0+y1)/2, zone["id"].upper().replace("_", " "),
                 ha="center", va="center", fontsize=9,
                 fontfamily="monospace", color="#666",
                 alpha=0.7, zorder=2)

    # Equipment
    MOUNTING_COLOR = {
        "floor-standing": "#2060c0",
        "tabletop":       "#c06020",
    }
    for e in schedule.get("equipment", []):
        if "plan_xy_cm" not in e:
            continue
        px, py = e["plan_xy_cm"]
        L_cm, D_cm, _ = e["dims_cm"]
        yaw = e.get("yaw", 0)
        mounting = e.get("mounting", "floor-standing")
        if mounting.startswith("on_top_of"):
            color = "#e04040"
        elif mounting == "tabletop":
            color = MOUNTING_COLOR["tabletop"]
        else:
            color = MOUNTING_COLOR["floor-standing"]

        # Rectangle rotated around (px, py)
        transform = Affine2D().rotate_deg_around(px, py, yaw) + ax.transData
        rect = patches.Rectangle((px - L_cm/2, py - D_cm/2), L_cm, D_cm,
                                   facecolor=color, edgecolor=color,
                                   alpha=0.55, linewidth=0.8, zorder=4,
                                   transform=transform)
        ax.add_patch(rect)
        ax.text(px, py, e["tag"], ha="center", va="center",
                 fontsize=7, fontfamily="monospace", fontweight="bold",
                 zorder=5)

    # Flow arrows for serving line
    serving = sorted([e for e in schedule.get("equipment", []) if "station_order" in e],
                      key=lambda e: e["station_order"])
    for i in range(len(serving) - 1):
        a, b = serving[i], serving[i+1]
        ax.annotate("", xy=b["plan_xy_cm"], xytext=a["plan_xy_cm"],
                     arrowprops=dict(arrowstyle="->", color="#00a000",
                                      lw=1.5, alpha=0.6), zorder=6)
    if serving:
        last = serving[-1]
        ax.text(last["plan_xy_cm"][0] + 200, last["plan_xy_cm"][1] + 80,
                 "STUDENT FLOW →", color="#008000", fontsize=9, fontweight="bold")

    # Title
    title = f"{schedule.get('project', 'untitled').upper().replace('_', ' ')} — PLAN VIEW"
    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)

    # Subtitle
    subtitle = f"Config: {schedule.get('config', '')}   |   Seats: {schedule.get('seats_target', 0)}   |   " \
                f"Room: {W/100:.1f}m × {L/100:.1f}m   |   Scale: drawing at 1:1 (cm)"
    ax.text(W/2, -150, subtitle, ha="center", fontsize=9, color="#333",
             fontfamily="monospace")

    # Grid
    ax.grid(True, linestyle=":", alpha=0.3, color="gray")
    ax.set_xticks(range(0, W+1, 400))
    ax.set_yticks(range(0, L+1, 400))
    ax.set_xlabel("X (cm, west→east)")
    ax.set_ylabel("Y (cm, south→north)")

    # North arrow in top-right
    ax.annotate("N", xy=(W + 100, L - 100), xytext=(W + 100, L - 350),
                 ha="center", fontsize=14, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color="black", lw=2))

    # Legend
    legend_entries = [
        patches.Patch(color="#2060c0", alpha=0.55, label="Floor-standing equipment"),
        patches.Patch(color="#c06020", alpha=0.55, label="Tabletop equipment"),
        patches.Patch(color="#e04040", alpha=0.55, label="Sneeze guard (stacked)"),
        patches.Patch(facecolor="none", edgecolor="#00a000", linewidth=2,
                       label="Student flow →"),
    ]
    ax.legend(handles=legend_entries, loc="lower right", fontsize=8,
               framealpha=0.9)

    # Watermark
    fig.text(0.99, 0.01, "AI DRAFT — ENGINEER REVIEW REQUIRED",
              ha="right", va="bottom", fontsize=8, color="#c00000",
              fontweight="bold", alpha=0.8)
    fig.text(0.01, 0.01, "OCE procedural-authoring skill  |  2026-04-18",
              ha="left", va="bottom", fontsize=7, color="#666")

    plt.tight_layout()
    plt.savefig(out_path, dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"PNG rendered: {out_path}")


if __name__ == "__main__":
    schedule = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2] if len(sys.argv) > 2 else "plan.png"
    draw(schedule, out)
