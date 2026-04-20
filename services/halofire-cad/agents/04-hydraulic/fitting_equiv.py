"""NFPA 13 fitting equivalent-length table + lookup.

Per NFPA 13 §23.4.3 / Table 28.2.4.1.1 (2022 edition numbering),
every fitting and valve adds an "equivalent length" of straight
pipe to the hydraulic pressure-drop calc. Ignoring these is the
most common source of under-priced bids — friction loss through
tees and valves is *not* negligible.

Values here are feet of straight pipe, referenced to Hazen-Williams
C = 120 (the NFPA baseline for steel). For other pipe types or new
steel, a correction multiplier is applied via `correction_factor`
following the (C_actual / 120) ** 1.852 identity.

This module is the single source of truth; the hydraulic agent
pulls its table from here. If we ever find Halo's as-built friction
losses don't match, the single fix-up is here.
"""
from __future__ import annotations

from typing import Iterable

# C-factor baseline used to normalize NFPA table values.
_NFPA_BASELINE_C = 120.0

# NFPA 13 Table 28.2.4.1.1 — Equivalent Schedule 40 Steel Pipe
# Length Chart (feet). Rounded to nearest foot per code presentation.
# Covers nominal sizes 3/4" through 10". Values for sizes we don't
# stock (3/4", 3.5") are present for completeness.
_TABLE_FT: dict[str, dict[float, float]] = {
    # ── 90° elbows (standard / long-turn / threaded vs welded) ──
    "elbow_90":       {0.75: 2, 1.0: 2, 1.25: 3, 1.5: 4, 2.0: 5, 2.5: 6, 3.0: 7, 3.5: 8, 4.0: 10, 5.0: 12, 6.0: 14, 8.0: 18, 10.0: 22},
    "elbow_90_long":  {0.75: 1, 1.0: 2, 1.25: 2, 1.5: 2, 2.0: 3, 2.5: 4, 3.0: 5, 3.5: 5, 4.0: 6,  5.0: 8,  6.0: 9,  8.0: 13, 10.0: 16},
    # ── 45° elbows ──
    "elbow_45":       {0.75: 1, 1.0: 1, 1.25: 1, 1.5: 2, 2.0: 2, 2.5: 3, 3.0: 3, 3.5: 3, 4.0: 4,  5.0: 5,  6.0: 7,  8.0: 9,  10.0: 11},
    # ── Tees ──
    "tee_run":        {0.75: 1, 1.0: 1, 1.25: 1, 1.5: 2, 2.0: 3, 2.5: 3, 3.0: 4, 3.5: 4, 4.0: 5,  5.0: 6,  6.0: 7,  8.0: 10, 10.0: 12},  # straight-through
    "tee_branch":     {0.75: 3, 1.0: 5, 1.25: 6, 1.5: 8, 2.0: 10, 2.5: 12, 3.0: 15, 3.5: 17, 4.0: 20, 5.0: 25, 6.0: 30, 8.0: 35, 10.0: 50},  # side leg
    # ── Couplings / reducers — usually negligible but documented ──
    "coupling_rigid": {0.75: 0, 1.0: 0, 1.25: 0, 1.5: 0, 2.0: 0, 2.5: 0, 3.0: 0, 4.0: 0, 5.0: 0, 6.0: 0, 8.0: 0, 10.0: 0},
    "coupling_flex":  {0.75: 0.5, 1.0: 0.5, 1.25: 1, 1.5: 1, 2.0: 1, 2.5: 1, 3.0: 2, 4.0: 2, 5.0: 3, 6.0: 3, 8.0: 4, 10.0: 5},
    "reducer_concentric": {0.75: 0.5, 1.0: 0.5, 1.25: 1, 1.5: 1, 2.0: 1, 2.5: 2, 3.0: 2, 4.0: 2, 5.0: 3, 6.0: 3, 8.0: 4, 10.0: 5},
    # ── Valves (Table 28.2.4.1.1) ──
    "gate_valve":     {0.75: 0, 1.0: 0, 1.25: 0, 1.5: 0, 2.0: 1,  2.5: 1, 3.0: 1, 3.5: 1, 4.0: 2,  5.0: 2,  6.0: 3,  8.0: 4,  10.0: 5},  # OS&Y open gate
    "butterfly_valve":{0.75: 0, 1.0: 0, 1.25: 0, 1.5: 0, 2.0: 6,  2.5: 7, 3.0: 10, 3.5: 12, 4.0: 12, 5.0: 9, 6.0: 10, 8.0: 12, 10.0: 19},
    "check_valve_swing": {0.75: 3, 1.0: 4, 1.25: 5, 1.5: 7, 2.0: 9, 2.5: 11, 3.0: 14, 3.5: 16, 4.0: 19, 5.0: 22, 6.0: 27, 8.0: 35, 10.0: 45},
    "ball_valve":     {0.75: 1, 1.0: 1, 1.25: 1, 1.5: 2, 2.0: 2, 2.5: 3, 3.0: 3, 4.0: 4, 5.0: 5, 6.0: 6, 8.0: 8, 10.0: 10},
    "backflow_dcda":  {2.0: 11, 2.5: 13, 3.0: 16, 4.0: 20, 5.0: 24, 6.0: 30, 8.0: 40, 10.0: 50},
    # ── Sprinkler riser items ──
    "flow_switch":    {1.5: 0, 2.0: 0, 2.5: 0, 3.0: 0, 4.0: 0, 6.0: 0},   # negligible — saddle mount
    "alarm_check":    {2.0: 11, 2.5: 13, 3.0: 17, 4.0: 22, 6.0: 30},
    # ── FDC piping ──
    "fdc_elbow":      {2.5: 6, 3.0: 7, 4.0: 10, 6.0: 14},
}

# Alias map: canonical fitting kinds that our placer / connectors
# might emit, normalized to the table keys above.
_ALIASES = {
    "elbow_90_grooved": "elbow_90",
    "elbow_90_threaded": "elbow_90",
    "elbow_45_grooved": "elbow_45",
    "tee_equal": "tee_branch",   # conservative default — worst case
    "tee_reducing": "tee_branch",
    "coupling_grooved": "coupling_rigid",
    "coupling_flexible": "coupling_flex",
    "valve_osy_gate": "gate_valve",
    "valve_butterfly": "butterfly_valve",
    "valve_check": "check_valve_swing",
    "valve_ball": "ball_valve",
    "valve_backflow": "backflow_dcda",
    "riser_flow_switch": "flow_switch",
    "riser_alarm_check": "alarm_check",
    "reducer": "reducer_concentric",
    "fitting_elbow_90": "elbow_90",
    "fitting_elbow_45": "elbow_45",
    "fitting_tee_equal": "tee_branch",
    "fitting_tee_reducing": "tee_branch",
    "fitting_reducer": "reducer_concentric",
    "fitting_coupling_grooved": "coupling_rigid",
    "fitting_coupling_flexible": "coupling_flex",
}


def canonical_kind(raw: str) -> str | None:
    """Normalize a fitting identifier to a key in the NFPA table."""
    if not raw:
        return None
    k = raw.strip().lower()
    return _ALIASES.get(k, k if k in _TABLE_FT else None)


def correction_factor(c_actual: float) -> float:
    """Hazen-Williams C correction per NFPA §14.4.4.2.

    Table values are tabulated at C=120 (steel); for CPVC (C=150),
    new copper (C=150), or lined ductile iron (C=140), the equivalent
    length scales by (C_actual / 120) ** 1.852. An effectively-longer
    equivalent-length makes sense because smoother pipe loses less to
    friction per foot, so the *relative* contribution of a fitting
    grows.
    """
    if c_actual <= 0:
        return 1.0
    return (c_actual / _NFPA_BASELINE_C) ** 1.852


def equiv_length_ft(kind: str, size_in: float, c_actual: float = 120.0) -> float:
    """Return the equivalent length in feet for `kind` at `size_in`,
    scaled for the given Hazen-Williams C.

    Returns 0.0 for unknown fittings so the caller degrades gracefully
    (but logs via caller if warranted). Unknown sizes interpolate
    linearly between the two nearest tabulated sizes.
    """
    canon = canonical_kind(kind)
    if canon is None:
        return 0.0
    row = _TABLE_FT.get(canon)
    if not row:
        return 0.0
    if size_in in row:
        le = float(row[size_in])
    else:
        # Linear interpolation between nearest sizes
        sizes = sorted(row.keys())
        if size_in < sizes[0]:
            le = float(row[sizes[0]])
        elif size_in > sizes[-1]:
            le = float(row[sizes[-1]])
        else:
            lo = max(s for s in sizes if s < size_in)
            hi = min(s for s in sizes if s > size_in)
            t = (size_in - lo) / (hi - lo)
            le = float(row[lo] + t * (row[hi] - row[lo]))
    return le * correction_factor(c_actual)


def total_equiv_length_ft(
    fittings: Iterable, size_in: float, c_actual: float = 120.0,
) -> float:
    """Sum Le for an iterable of fitting records or raw kind strings.

    Accepts either:
      * a list of strings ('elbow_90', 'tee_branch', ...)
      * a list of objects exposing `.kind` (dataclasses or pydantic)
    """
    total = 0.0
    for f in fittings:
        kind = getattr(f, "kind", f) if not isinstance(f, str) else f
        total += equiv_length_ft(str(kind), size_in, c_actual)
    return total


__all__ = [
    "canonical_kind",
    "correction_factor",
    "equiv_length_ft",
    "total_equiv_length_ft",
]
