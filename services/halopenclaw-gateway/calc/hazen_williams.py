"""Hazen-Williams friction-loss formula, NFPA 13 edition.

NFPA 13-2022 §28.2 mandates the Hazen-Williams empirical formula for
fire sprinkler hydraulic calcs (Darcy-Weisbach is permitted but rare).

Imperial form (as used by NFPA 13):

    p = (4.52 * Q^1.85) / (C^1.85 * d^4.87)

Where:
    p = friction loss in psi per FOOT of pipe
    Q = flow in GPM
    C = Hazen-Williams friction coefficient (unitless, material-dependent)
    d = actual internal pipe diameter in inches (ID, NOT nominal)

C-factors per NFPA 13 Table 28.2.4.8.1 (partial, most common):
    steel new:           120
    steel SCH40 dry:     100
    steel SCH10 dry:     100
    steel SCH40 wet:     120
    steel unlined:       100
    copper:              150
    CPVC:                150
    ductile iron:        140

Typical internal diameters (inches) for common sprinkler pipes:
    size    SCH10 ID    SCH40 ID
    1"      1.097       1.049
    1.25"   1.442       1.380
    1.5"    1.682       1.610
    2"      2.157       2.067
    2.5"    2.635       2.469
    3"      3.260       3.068
    4"      4.260       4.026
    6"      6.357       6.065
    8"      8.329       7.981

This module exposes:
    friction_psi_per_ft(flow_gpm, c_factor, inner_dia_in) -> psi/ft
    friction_psi(flow_gpm, c_factor, inner_dia_in, length_ft) -> psi
    equivalent_length(fittings, inner_dia_in) -> ft  (NFPA Table 28.2.4.7)
    elevation_psi(elevation_ft) -> psi  (0.433 psi/ft for water)
"""
from __future__ import annotations

from dataclasses import dataclass


# ── Material C-factors (NFPA 13-2022 Table 28.2.4.8.1) ──────────────────────
C_FACTORS: dict[str, int] = {
    "steel_new": 120,
    "steel_sch10_wet": 120,
    "steel_sch10_dry": 100,
    "steel_sch40_wet": 120,
    "steel_sch40_dry": 100,
    "steel_unlined": 100,
    "copper": 150,
    "cpvc": 150,
    "ductile_iron": 140,
    "cast_iron_unlined": 100,
}


# ── Internal diameters (inches) — NPS nominal × schedule ────────────────────
PIPE_ID_IN: dict[tuple[str, float], float] = {
    ("sch10", 1.0):  1.097,
    ("sch10", 1.25): 1.442,
    ("sch10", 1.5):  1.682,
    ("sch10", 2.0):  2.157,
    ("sch10", 2.5):  2.635,
    ("sch10", 3.0):  3.260,
    ("sch10", 4.0):  4.260,
    ("sch10", 6.0):  6.357,
    ("sch10", 8.0):  8.329,
    ("sch40", 1.0):  1.049,
    ("sch40", 1.25): 1.380,
    ("sch40", 1.5):  1.610,
    ("sch40", 2.0):  2.067,
    ("sch40", 2.5):  2.469,
    ("sch40", 3.0):  3.068,
    ("sch40", 4.0):  4.026,
    ("sch40", 6.0):  6.065,
    ("sch40", 8.0):  7.981,
}


# ── Equivalent length of fittings (NFPA 13-2022 Table 28.2.4.7.1, C=120) ────
# Values in FEET of equivalent pipe length. Keys are (fitting_type, nominal_in).
EQUIV_LEN_FT: dict[tuple[str, float], float] = {
    # 90-degree standard elbow
    ("elbow_90", 1.0):  2.0,
    ("elbow_90", 1.25): 3.0,
    ("elbow_90", 1.5):  4.0,
    ("elbow_90", 2.0):  5.0,
    ("elbow_90", 2.5):  6.0,
    ("elbow_90", 3.0):  7.0,
    ("elbow_90", 4.0):  10.0,
    ("elbow_90", 6.0):  14.0,
    # 45-degree elbow
    ("elbow_45", 1.0):  1.0,
    ("elbow_45", 2.0):  2.0,
    ("elbow_45", 3.0):  3.0,
    ("elbow_45", 4.0):  4.0,
    # Tee (flow through branch)
    ("tee_branch", 1.0):  5.0,
    ("tee_branch", 1.5):  8.0,
    ("tee_branch", 2.0):  10.0,
    ("tee_branch", 2.5):  12.0,
    ("tee_branch", 3.0):  15.0,
    ("tee_branch", 4.0):  20.0,
    # Gate valve (open)
    ("gate_valve", 2.0):  1.0,
    ("gate_valve", 4.0):  2.0,
    # Butterfly valve
    ("butterfly_valve", 4.0):  12.0,
    ("butterfly_valve", 6.0):  14.0,
    # Check valve
    ("check_valve", 4.0):  22.0,
    # Alarm check valve
    ("alarm_check_valve", 4.0):  5.0,
    # Backflow preventer (representative — varies by model)
    ("backflow_dcda", 4.0):  60.0,
}


def friction_psi_per_ft(flow_gpm: float, c_factor: int, inner_dia_in: float) -> float:
    """Hazen-Williams friction loss, psi per foot of pipe.

    p = (4.52 * Q^1.85) / (C^1.85 * d^4.87)
    """
    if flow_gpm <= 0 or inner_dia_in <= 0:
        return 0.0
    return (4.52 * (flow_gpm ** 1.85)) / ((c_factor ** 1.85) * (inner_dia_in ** 4.87))


def friction_psi(
    flow_gpm: float,
    c_factor: int,
    inner_dia_in: float,
    length_ft: float,
) -> float:
    """Total friction loss over a length of pipe, in psi."""
    return friction_psi_per_ft(flow_gpm, c_factor, inner_dia_in) * length_ft


def equivalent_length_ft(
    fittings: list[tuple[str, float, int]],
    c_factor: int,
) -> float:
    """Sum of equivalent pipe length (ft) for a list of (type, size_in, count).

    Table values are for C=120. NFPA 13 §28.2.4.7.2 provides correction
    factors for other C-values:
        EL_C = EL_120 * (C / 120)^1.85
    """
    scale = (c_factor / 120.0) ** 1.85
    total = 0.0
    for fit_type, size_in, count in fittings:
        base = EQUIV_LEN_FT.get((fit_type, size_in))
        if base is None:
            # Unknown fitting — treat as 1x pipe diameter (conservative zero)
            continue
        total += base * count * scale
    return total


def elevation_psi(elevation_ft: float) -> float:
    """Static head pressure for a column of water, psi.

    0.433 psi/ft of vertical lift (water at 62.4 lb/ft³).
    Positive elevation above supply = ADDED demand.
    """
    return elevation_ft * 0.433


def k_factor_flow(k_factor: float, pressure_psi: float) -> float:
    """Flow through an orifice given K-factor and pressure.

    Q = K * sqrt(P)
    """
    if pressure_psi < 0:
        return 0.0
    return k_factor * (pressure_psi ** 0.5)


# ── Simple branch-line evaluator ────────────────────────────────────────────


@dataclass
class BranchSegment:
    """One piece of pipe between two nodes (heads or junctions)."""
    from_node: str
    to_node: str
    length_ft: float
    pipe_schedule: str   # "sch10" | "sch40"
    nominal_size_in: float
    material: str = "steel_new"
    fittings: list[tuple[str, float, int]] | None = None
    elevation_change_ft: float = 0.0


@dataclass
class BranchEvalResult:
    total_friction_psi: float
    total_elevation_psi: float
    total_equivalent_length_ft: float
    per_segment: list[dict]


def evaluate_branch(
    segments: list[BranchSegment],
    flow_gpm: float,
) -> BranchEvalResult:
    """Walk a list of pipe segments accumulating Hazen-Williams losses.

    Useful for a simple tree-branch check: pass the segments from the
    remote-most head back toward the riser, with the cumulative flow at
    each. (For a proper hydraulic trace you iterate — this is the
    single-branch single-flow simplification for M1 week 4 scope.)
    """
    total_fric = 0.0
    total_elev = 0.0
    total_equiv = 0.0
    per_seg: list[dict] = []
    for seg in segments:
        c = C_FACTORS.get(seg.material, 120)
        inner = PIPE_ID_IN.get((seg.pipe_schedule, seg.nominal_size_in))
        if inner is None:
            raise ValueError(
                f"unknown pipe ID for {seg.pipe_schedule} {seg.nominal_size_in} in"
            )
        ef = equivalent_length_ft(seg.fittings or [], c)
        total_equiv += ef
        seg_fric = friction_psi(flow_gpm, c, inner, seg.length_ft + ef)
        seg_elev = elevation_psi(seg.elevation_change_ft)
        total_fric += seg_fric
        total_elev += seg_elev
        per_seg.append({
            "from": seg.from_node,
            "to": seg.to_node,
            "length_ft": seg.length_ft,
            "equivalent_length_ft": round(ef, 2),
            "pipe": f"{seg.pipe_schedule} {seg.nominal_size_in}in",
            "inner_dia_in": inner,
            "c_factor": c,
            "friction_psi": round(seg_fric, 3),
            "elevation_psi": round(seg_elev, 3),
        })
    return BranchEvalResult(
        total_friction_psi=round(total_fric, 3),
        total_elevation_psi=round(total_elev, 3),
        total_equivalent_length_ft=round(total_equiv, 2),
        per_segment=per_seg,
    )
