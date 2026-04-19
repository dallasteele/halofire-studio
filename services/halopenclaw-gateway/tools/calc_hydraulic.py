"""halofire_calc — hydraulic calculations per NFPA 13.

M1 week 4: Hazen-Williams single-branch friction + elevation + K-factor
orifice flow. Real implementation using the calc/hazen_williams module.

M3 adds: density-area method, remote-area auto-identification,
water-supply demand-vs-supply curve comparison.
"""
from __future__ import annotations

from typing import Any

from .registry import Tool, register

# Absolute import: uvicorn runs main.py with the gateway dir on sys.path,
# so `calc` is importable as a top-level package, not `..calc`.
from calc.hazen_williams import (  # type: ignore[import-not-found]
    BranchSegment,
    evaluate_branch,
    friction_psi,
    k_factor_flow,
)


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": [
                "hazen_williams",
                "single_branch",
                "k_factor_flow",
                "density_area",
                "remote_area",
                "supply_check",
            ],
        },
        "flow_gpm": {"type": "number"},
        "c_factor": {"type": "integer", "default": 120},
        "inner_dia_in": {"type": "number"},
        "length_ft": {"type": "number"},
        "elevation_ft": {"type": "number"},
        "k_factor": {"type": "number"},
        "pressure_psi": {"type": "number"},
        "segments": {
            "type": "array",
            "description": (
                "For mode=single_branch: list of BranchSegment dicts with "
                "from_node, to_node, length_ft, pipe_schedule (sch10|sch40), "
                "nominal_size_in, optional material, fittings, elevation_change_ft."
            ),
        },
    },
    "required": ["mode"],
}


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")

    if mode == "hazen_williams":
        q = float(args.get("flow_gpm", 0))
        c = int(args.get("c_factor", 120))
        d = float(args.get("inner_dia_in", 0))
        L = float(args.get("length_ft", 1))
        p = friction_psi(q, c, d, L)
        return (
            f"HAZEN_WILLIAMS:\n"
            f"  Q={q} gpm  C={c}  d={d}in  L={L}ft\n"
            f"  friction loss = {p:.3f} psi ({(p / L if L else 0):.4f} psi/ft)\n"
            f"  [NFPA 13-2022 §28.2 friction loss formula]"
        )

    if mode == "k_factor_flow":
        k = float(args.get("k_factor", 5.6))
        p = float(args.get("pressure_psi", 7))
        q = k_factor_flow(k, p)
        return (
            f"K_FACTOR_FLOW:\n"
            f"  K={k}  P={p} psi\n"
            f"  flow Q = K * sqrt(P) = {q:.2f} gpm\n"
            f"  [NFPA 13-2022 §28.2.2]"
        )

    if mode == "single_branch":
        raw_segs = args.get("segments") or []
        if not raw_segs:
            return "single_branch: 'segments' array required"
        segments: list[BranchSegment] = []
        for s in raw_segs:
            segments.append(BranchSegment(
                from_node=str(s.get("from_node", "?")),
                to_node=str(s.get("to_node", "?")),
                length_ft=float(s.get("length_ft", 0)),
                pipe_schedule=str(s.get("pipe_schedule", "sch10")),
                nominal_size_in=float(s.get("nominal_size_in", 1.0)),
                material=str(s.get("material", "steel_new")),
                fittings=s.get("fittings"),
                elevation_change_ft=float(s.get("elevation_change_ft", 0)),
            ))
        q = float(args.get("flow_gpm", 0))
        result = evaluate_branch(segments, q)
        lines = [
            f"SINGLE_BRANCH (Q={q} gpm, {len(segments)} segments):",
            f"  Total friction loss:      {result.total_friction_psi:.3f} psi",
            f"  Total elevation:          {result.total_elevation_psi:.3f} psi",
            f"  Total equivalent fittings:{result.total_equivalent_length_ft:.2f} ft",
            f"  Total demand at inlet:    "
            f"{result.total_friction_psi + result.total_elevation_psi:.3f} psi",
            "",
            "Per-segment detail:",
        ]
        for s in result.per_segment:
            lines.append(
                f"  {s['from']} -> {s['to']:<15} {s['pipe']:<12} "
                f"L={s['length_ft']}ft (+{s['equivalent_length_ft']}ft eq) "
                f"dP={s['friction_psi']}psi dH={s['elevation_psi']}psi"
            )
        lines.append("")
        lines.append("[NFPA 13-2022 §28.2 Hazen-Williams + §28.2.4.7 equivalent length]")
        return "\n".join(lines)

    if mode == "density_area":
        return (
            "DENSITY_AREA (M3 scope): NFPA 13 §19.2.3 density-area method "
            "requires: (1) hazard-class design density from Fig 19.2.3.1.1, "
            "(2) design area (most hydraulically demanding), (3) flow at each "
            "head in the design area via K * sqrt(P), (4) iterate until all "
            "heads satisfy density × design area. Engine ships M3 week 16-18."
        )

    if mode == "remote_area":
        return (
            "REMOTE_AREA (M3 scope): auto-identify the most hydraulically "
            "demanding area. Algorithm: DFS from each head, compute total "
            "demand (friction + elevation + head K-factor outflow), compare "
            "against supply curve, return the area that maxes-out first. "
            "Ships M3 week 16-18."
        )

    if mode == "supply_check":
        return (
            "SUPPLY_CHECK (M3 scope): plot demand curve vs hydrant flow-test "
            "supply curve. Pass if demand < supply + 10% safety margin per "
            "NFPA 13 §11.2.3.5. Ships M3 week 19-20."
        )

    return f"unknown mode: {mode}. Valid: hazen_williams, single_branch, k_factor_flow, density_area, remote_area, supply_check"


register(
    Tool(
        name="halofire_calc",
        description=(
            "Hydraulic calculations per NFPA 13. M1 ships the Hazen-Williams "
            "friction-loss formula, single-branch evaluator with equivalent-"
            "length fittings, elevation head, and K-factor orifice flow. "
            "M3 adds density-area method, remote-area auto-identification, "
            "and supply-demand curve comparison. Every calc cites its NFPA "
            "section in the output."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)
