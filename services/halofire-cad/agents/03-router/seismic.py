"""NFPA 13 §18 seismic bracing calculator.

Seismic brace requirements (simplified for Alpha — Halo reviews the
numbers before final submittal):

  §18.5.7  Lateral braces: max 40 ft (12.2 m) between braces on
           feed & cross mains >= 2.5". Last brace <= 20 ft (6.1 m)
           from the end of the main.
  §18.5.8  Longitudinal braces: max 80 ft (24.4 m) between braces
           on same mains. Last brace <= 40 ft (12.2 m) from end.
  §18.5.5.1  Branch lines >= 2.5" also require lateral braces at
             40-ft spacing.
  §18.5.3  4-way brace assemblies can count as both lateral and
           longitudinal.

The calculator:
  1. Walks every pipe segment on every system.
  2. Filters to segments meeting the brace-required size threshold.
  3. Reports a required brace count based on per-segment length
     and the NFPA spacings.
  4. Emits issues when an as-designed brace count from the router
     falls short.

Input: `design.systems[*]` with `pipes[*]` + `hangers[*].type`.
Output: BraceReport with per-system counts + issues list.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable


# NFPA 13 §18 spacings (metric conversions)
MAX_LATERAL_SPACING_M = 12.192      # 40 ft
MAX_LONGITUDINAL_SPACING_M = 24.384  # 80 ft
END_OFFSET_LATERAL_M = 6.096        # 20 ft
END_OFFSET_LONGITUDINAL_M = 12.192  # 40 ft

# Per §18.5 braces required on mains >= this nominal size.
MAIN_SIZE_THRESHOLD_IN = 2.5


@dataclass
class SeismicBraceReq:
    system_id: str
    pipe_id: str
    size_in: float
    length_m: float
    laterals_required: int
    longitudinals_required: int


@dataclass
class BraceReport:
    per_pipe: list[SeismicBraceReq] = field(default_factory=list)
    totals_by_system: dict[str, dict[str, int]] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)
    total_laterals: int = 0
    total_longitudinals: int = 0

    def add(self, req: SeismicBraceReq) -> None:
        self.per_pipe.append(req)
        self.total_laterals += req.laterals_required
        self.total_longitudinals += req.longitudinals_required
        s = self.totals_by_system.setdefault(
            req.system_id, {"laterals": 0, "longitudinals": 0,
                            "segments": 0},
        )
        s["laterals"] += req.laterals_required
        s["longitudinals"] += req.longitudinals_required
        s["segments"] += 1


def _brace_count(length_m: float, max_spacing_m: float,
                 end_offset_m: float) -> int:
    """How many braces are needed to hold a straight run of `length_m`
    at `max_spacing_m` between braces plus an end-offset clamp?

    NFPA treats the first brace as close to the pipe origin (within
    `end_offset`) and the rest stepping at max_spacing. A zero-length
    pipe requires zero braces. A pipe shorter than `end_offset` also
    requires none per §18.5.7.1 (the next main over covers it via the
    'rigid' coupling behavior at the joint).
    """
    if length_m <= end_offset_m:
        return 0
    # After the end-offset, remaining length needs braces every
    # max_spacing. Count = ceil((length - end_offset) / max_spacing)
    remaining = length_m - end_offset_m
    return max(1, math.ceil(remaining / max_spacing_m))


def calc_seismic(
    systems: Iterable[dict[str, Any]],
    *,
    main_size_threshold_in: float = MAIN_SIZE_THRESHOLD_IN,
    max_lateral_m: float = MAX_LATERAL_SPACING_M,
    max_longitudinal_m: float = MAX_LONGITUDINAL_SPACING_M,
    end_offset_lateral_m: float = END_OFFSET_LATERAL_M,
    end_offset_longitudinal_m: float = END_OFFSET_LONGITUDINAL_M,
) -> BraceReport:
    report = BraceReport()
    for s in systems:
        sid = str(s.get("id") or "SYS")
        pipes = s.get("pipes") or []
        hangers = s.get("hangers") or []
        brace_hangers = [
            h for h in hangers
            if str(h.get("type") or "").lower().startswith("seismic")
        ]
        lateral_ok = 0
        longitudinal_ok = 0
        for h in brace_hangers:
            t = str(h.get("type") or "").lower()
            if "longitudinal" in t:
                longitudinal_ok += 1
            elif "lateral" in t:
                lateral_ok += 1
            elif "4-way" in t or "four_way" in t:
                lateral_ok += 1
                longitudinal_ok += 1
            else:
                # Generic 'seismic_brace' counts as lateral
                lateral_ok += 1
        sys_laterals = 0
        sys_longitudinals = 0
        for p in pipes:
            size_in = float(p.get("size_in") or 0)
            length_m = float(p.get("length_m") or 0)
            if size_in < main_size_threshold_in or length_m <= 0:
                continue
            laterals = _brace_count(
                length_m, max_lateral_m, end_offset_lateral_m,
            )
            longs = _brace_count(
                length_m, max_longitudinal_m, end_offset_longitudinal_m,
            )
            if laterals == 0 and longs == 0:
                continue
            req = SeismicBraceReq(
                system_id=sid,
                pipe_id=str(p.get("id") or ""),
                size_in=size_in,
                length_m=length_m,
                laterals_required=laterals,
                longitudinals_required=longs,
            )
            report.add(req)
            sys_laterals += laterals
            sys_longitudinals += longs
        if sys_laterals > lateral_ok:
            report.issues.append(
                f"SEISMIC_LATERAL_SHORT:{sid}:"
                f"need {sys_laterals}, placed {lateral_ok}",
            )
        if sys_longitudinals > longitudinal_ok:
            report.issues.append(
                f"SEISMIC_LONGITUDINAL_SHORT:{sid}:"
                f"need {sys_longitudinals}, placed {longitudinal_ok}",
            )
    return report


__all__ = [
    "MAIN_SIZE_THRESHOLD_IN",
    "MAX_LATERAL_SPACING_M",
    "MAX_LONGITUDINAL_SPACING_M",
    "END_OFFSET_LATERAL_M",
    "END_OFFSET_LONGITUDINAL_M",
    "SeismicBraceReq",
    "BraceReport",
    "calc_seismic",
]


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path
    if len(sys.argv) < 2:
        print("usage: python seismic.py <design.json>")
        sys.exit(2)
    d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    r = calc_seismic(d.get("systems") or [])
    print(json.dumps({
        "total_laterals": r.total_laterals,
        "total_longitudinals": r.total_longitudinals,
        "totals_by_system": r.totals_by_system,
        "issues": r.issues[:10],
    }, indent=2))
