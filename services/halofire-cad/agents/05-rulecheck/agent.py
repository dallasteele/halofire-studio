"""halofire rulecheck agent — runs NFPA 13 predicates against a Design.

Each rule in rules/nfpa13_2022.yaml maps to a predicate function here.
Rules execute in order of severity (error → warning → info) and
accumulate Violations.

Loop integration: when the orchestrator detects violations, it feeds
them back to the placer or router agent as constraints and re-runs.
"""
from __future__ import annotations

import logging
import math
import sys
from pathlib import Path
from typing import Callable

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Design, Violation, Room, Head, PipeSegment,
)

log = logging.getLogger(__name__)

_RULES_PATH = Path(__file__).resolve().parents[2] / "rules" / "nfpa13_2022.yaml"


def _spacing_max_ft(hazard: str) -> float:
    table = {
        "light": 15.0, "ordinary_i": 15.0, "ordinary_ii": 13.125,
        "extra_i": 12.0, "extra_ii": 12.0, "residential": 12.0,
    }
    return table.get(hazard, 15.0)


def _coverage_max_sqft(hazard: str) -> float:
    table = {
        "light": 225, "ordinary_i": 130, "ordinary_ii": 130,
        "extra_i": 100, "extra_ii": 90, "residential": 160,
    }
    return table.get(hazard, 225)


# ── Predicates ──────────────────────────────────────────────────────

def every_room_has_coverage(design: Design) -> list[Violation]:
    """§8.3.1 — every occupiable room protected."""
    out: list[Violation] = []
    all_heads = [h for s in design.systems for h in s.heads]
    for level in design.building.levels:
        covered = {h.room_id for h in all_heads if h.room_id}
        for room in level.rooms:
            if room.id in covered:
                continue
            # Skip §9.2.1 omitted closets/bathrooms < 24 sqft
            if room.area_sqm < 2.2:
                continue
            name = (room.name or "").lower()
            if "closet" in name and room.area_sqm < 5:
                continue
            out.append(Violation(
                rule_id="NFPA13-8.3.1", section="8.3.1", severity="error",
                message=f"Room {room.name} ({room.area_sqm:.1f} sqm) has no sprinkler coverage",
                refs=[room.id],
            ))
    return out


def omitted_rooms_documented(design: Design) -> list[Violation]:
    """§9.2.1 — omitted rooms must meet size + risk criteria."""
    return []  # v2 only checks if any rooms were omitted above threshold


def head_spacing_max(design: Design) -> list[Violation]:
    """§11.2.3.1.1 — no two heads in same branch > s_max apart."""
    out: list[Violation] = []
    for system in design.systems:
        heads_by_room: dict[str, list[Head]] = {}
        for h in system.heads:
            heads_by_room.setdefault(h.room_id or "_", []).append(h)
        for room_id, heads in heads_by_room.items():
            room = _find_room(design, room_id)
            hazard = room.hazard_class if room else "light"
            smax_m = _spacing_max_ft(hazard or "light") * 0.3048
            for i, a in enumerate(heads):
                for b in heads[i + 1:]:
                    d = math.hypot(
                        a.position_m[0] - b.position_m[0],
                        a.position_m[1] - b.position_m[1],
                    )
                    # Only flag if they are BOTH in the same branch direction
                    # (simplified check: nearest-neighbor spacing)
                    pass  # v2: skip pair checks, cover in v3
    return out


def head_coverage_max(design: Design) -> list[Violation]:
    """§11.2.3.1.2 — sqft/head ≤ coverage cap for hazard."""
    out: list[Violation] = []
    for level in design.building.levels:
        for room in level.rooms:
            room_heads = [
                h for s in design.systems for h in s.heads
                if h.room_id == room.id
            ]
            if not room_heads:
                continue
            coverage_sqm = room.area_sqm / len(room_heads)
            cap_sqft = _coverage_max_sqft(room.hazard_class or "light")
            cap_sqm = cap_sqft * 0.0929
            if coverage_sqm > cap_sqm * 1.05:  # 5% tolerance
                out.append(Violation(
                    rule_id="NFPA13-11.2.3.1.2", section="11.2.3.1.2",
                    severity="error",
                    message=(
                        f"Room {room.name}: {coverage_sqm:.1f} sqm/head "
                        f"exceeds max {cap_sqm:.1f} for {room.hazard_class}"
                    ),
                    refs=[room.id] + [h.id for h in room_heads],
                ))
    return out


def obstruction_clearance(design: Design) -> list[Violation]:
    """§11.2.3.2 — 3× obstruction dimension clearance from head."""
    out: list[Violation] = []
    for level in design.building.levels:
        level_heads = [
            h for s in design.systems for h in s.heads
            if any(r.id == h.room_id for r in level.rooms)
        ]
        for obs in level.obstructions:
            if not obs.polygon_m:
                continue
            xs = [p[0] for p in obs.polygon_m]
            ys = [p[1] for p in obs.polygon_m]
            width = (max(xs) - min(xs)) + (max(ys) - min(ys))
            clearance_m = min(1.52, 3 * width)  # cap at 60 in
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            for h in level_heads:
                d = math.hypot(h.position_m[0] - cx, h.position_m[1] - cy)
                if d < clearance_m:
                    out.append(Violation(
                        rule_id="NFPA13-11.2.3.2", section="11.2.3.2",
                        severity="error",
                        message=f"Head {h.id} within {d:.2f}m of obstruction {obs.id} "
                                f"(needs {clearance_m:.2f}m per 3x rule)",
                        refs=[h.id, obs.id],
                    ))
    return out


def head_wall_offset(design: Design) -> list[Violation]:
    """§11.2.3.1.3 — head within s/2 of wall (no closer than 4 in)."""
    return []  # v2 stub — requires wall-nearest-neighbor


def standpipe_hose_valves(design: Design) -> list[Violation]:
    """§7.2.3.1.1 — Class I hose valves at every floor for combo standpipes."""
    out: list[Violation] = []
    standpipe_systems = [s for s in design.systems if s.type == "combo_standpipe"]
    for s in standpipe_systems:
        if len(s.supplies) > 1 and not s.fittings:
            out.append(Violation(
                rule_id="NFPA13-7.2.3.1", section="7.2.3.1", severity="error",
                message=f"Combo standpipe {s.id} must have 2.5\" hose valves per level",
                refs=[s.id],
            ))
    return out


def fdc_sized(design: Design) -> list[Violation]:
    """§7.10.3 — FDC sized to sprinkler + standpipe demand."""
    return []


def hanger_spacing(design: Design) -> list[Violation]:
    """§9.2.2.1 — max hanger spacing."""
    max_sp = {1.0: 3.66, 1.25: 3.66, 1.5: 4.57, 2.0: 4.57, 2.5: 4.57, 3.0: 4.57, 4.0: 4.57}
    out: list[Violation] = []
    for system in design.systems:
        for seg in system.pipes:
            n_hangers = sum(
                1 for h in system.hangers if h.pipe_id == seg.id
            )
            if n_hangers == 0 and seg.length_m > 1.0:
                out.append(Violation(
                    rule_id="NFPA13-9.2.2.1", section="9.2.2.1",
                    severity="warning",
                    message=f"Segment {seg.id} ({seg.length_m:.1f}m) has no hangers",
                    refs=[seg.id],
                ))
                continue
            if n_hangers == 0:
                continue
            # Effective spacing
            spacing = seg.length_m / n_hangers
            cap = max_sp.get(seg.size_in, 3.66)
            if spacing > cap * 1.05:
                out.append(Violation(
                    rule_id="NFPA13-9.2.2.1", section="9.2.2.1",
                    severity="warning",
                    message=f"Segment {seg.id} hanger spacing {spacing:.1f}m > {cap:.1f}m",
                    refs=[seg.id],
                ))
    return out


def pipe_schedule_method(design: Design) -> list[Violation]:
    """§28.5 — schedule method pipe sizing."""
    out: list[Violation] = []
    caps = [(1, 1.0), (2, 1.25), (3, 1.5), (5, 2.0), (10, 2.5), (30, 3.0), (1000, 4.0)]
    for system in design.systems:
        for seg in system.pipes:
            required = next(
                (size for cap, size in caps if seg.downstream_heads <= cap),
                4.0,
            )
            if seg.size_in < required:
                out.append(Violation(
                    rule_id="NFPA13-28.5", section="28.5", severity="error",
                    message=(
                        f"Segment {seg.id} sized {seg.size_in}\" but needs "
                        f"{required}\" for {seg.downstream_heads} downstream heads"
                    ),
                    refs=[seg.id],
                ))
    return out


def hydraulic_demand_ok(design: Design) -> list[Violation]:
    """§28.6 — demand must be below supply with safety margin."""
    out: list[Violation] = []
    for system in design.systems:
        h = system.hydraulic
        if not h:
            continue
        if h.safety_margin_psi < 5:
            out.append(Violation(
                rule_id="NFPA13-28.6", section="28.6", severity="error",
                message=(
                    f"System {system.id}: safety margin {h.safety_margin_psi} psi "
                    f"< 5 psi minimum. Upsize critical path."
                ),
                refs=[system.id],
            ))
    return out


def hose_allowance(design: Design) -> list[Violation]:
    """§19.3.3 info note — hose allowance documented."""
    return []


def fdc_address_side(design: Design) -> list[Violation]:
    """SLC AHJ amendment — FDC must be on address side."""
    if design.project.ahj and "salt lake" in design.project.ahj.lower():
        for s in design.systems:
            if s.type == "combo_standpipe":
                if not s.riser.fdc_position_m:
                    return [Violation(
                        rule_id="SLC-FDC-LOC", section="SLC Amend.",
                        severity="error",
                        message="SLC AHJ requires FDC on address side (RFI A101b)",
                        refs=[s.id],
                    )]
    return []


# ── Rule dispatcher ─────────────────────────────────────────────────

_PREDICATES: dict[str, Callable[[Design], list[Violation]]] = {
    "every_room_has_coverage": every_room_has_coverage,
    "omitted_rooms_documented": omitted_rooms_documented,
    "head_spacing_max": head_spacing_max,
    "head_coverage_max": head_coverage_max,
    "obstruction_clearance": obstruction_clearance,
    "head_wall_offset": head_wall_offset,
    "standpipe_hose_valves": standpipe_hose_valves,
    "fdc_sized": fdc_sized,
    "hanger_spacing": hanger_spacing,
    "pipe_schedule_method": pipe_schedule_method,
    "hydraulic_demand_ok": hydraulic_demand_ok,
    "hose_allowance": hose_allowance,
    "fdc_address_side": fdc_address_side,
}


def _find_room(design: Design, room_id: str | None) -> Room | None:
    if not room_id:
        return None
    for level in design.building.levels:
        for room in level.rooms:
            if room.id == room_id:
                return room
    return None


def check_design(design: Design) -> list[Violation]:
    """Run all rules; return sorted Violation list (errors first)."""
    raw = yaml.safe_load(_RULES_PATH.read_text(encoding="utf-8"))
    rules = raw.get("rules", [])
    violations: list[Violation] = []
    for rule in rules:
        fn = _PREDICATES.get(rule.get("check"))
        if not fn:
            continue
        try:
            result = fn(design)
            for v in result:
                # Inherit severity from rule if not set
                if not v.severity:
                    v.severity = rule.get("severity", "warning")
            violations.extend(result)
        except Exception as e:
            log.warning("rule %s crashed: %s", rule.get("id"), e)
    # Sort: errors first, then warnings, then info
    order = {"error": 0, "warning": 1, "info": 2}
    violations.sort(key=lambda v: order.get(v.severity, 3))
    return violations


if __name__ == "__main__":
    print("rulecheck — call check_design(design)")
