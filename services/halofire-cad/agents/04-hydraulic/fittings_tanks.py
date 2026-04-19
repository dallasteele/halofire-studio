"""Phase C.4 + C.5 — backflow / PIV equivalent length + tank supply.

C.4: Backflow preventers and Post-Indicator Valves add large
equivalent lengths (NFPA 13 §23.4.3 manufacturer tables).

C.5: Gravity tank supply. Pressure at the tank outlet is purely
elevation head from the water surface, adjusted for tank draw-down.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# §23.4.3 supplemental equivalent lengths — backflow preventers vary
# by device kind + size. Values are representative; production reads
# actual manufacturer cut-sheet.
BACKFLOW_EQ_LEN_FT: dict[str, dict[float, float]] = {
    "reduced_pressure": {
        2.0: 27.0, 2.5: 31.0, 3.0: 40.0, 4.0: 55.0, 6.0: 85.0,
    },
    "double_check": {
        2.0: 16.0, 2.5: 19.0, 3.0: 24.0, 4.0: 32.0, 6.0: 49.0,
    },
    "piv": {  # post-indicator valve (wedge gate)
        2.0: 1.0, 2.5: 1.2, 3.0: 1.5, 4.0: 2.0, 6.0: 3.0,
    },
    "detector_check": {
        2.0: 11.0, 2.5: 13.0, 3.0: 17.0, 4.0: 22.0, 6.0: 34.0,
    },
}


def backflow_equiv_length_ft(kind: str, size_in: float) -> float:
    """Return equivalent length (ft) for a backflow preventer / PIV."""
    table = BACKFLOW_EQ_LEN_FT.get(kind, {})
    # Nearest size at or above the requested
    candidates = sorted(table.keys())
    for s in candidates:
        if s >= size_in:
            return table[s]
    return table.get(candidates[-1], 0.0) if candidates else 0.0


# ── C.5 Tank supply ─────────────────────────────────────────────────


@dataclass
class GravityTank:
    """Elevated or ground-level gravity tank per NFPA 22.

    elevation_ft_surface: height of water surface above reference (grade)
    elevation_ft_outlet: height of tank outlet flange
    capacity_gal: total capacity
    usable_drawdown_fraction: fraction of capacity available in a
      design duration (NFPA 22 typically ≥ 0.8 for gravity tanks)
    """
    elevation_ft_surface: float
    elevation_ft_outlet: float
    capacity_gal: float
    usable_drawdown_fraction: float = 0.80

    def static_head_psi(self, reference_elevation_ft: float = 0.0) -> float:
        """Static pressure at the reference elevation from this tank.

        Returns 0 if reference is above surface (no gravity head).
        """
        dh = self.elevation_ft_surface - reference_elevation_ft
        if dh <= 0:
            return 0.0
        return dh * 0.433  # 1 ft of water ≈ 0.433 psi

    def usable_volume_gal(self) -> float:
        return self.capacity_gal * self.usable_drawdown_fraction

    def duration_at_flow_minutes(self, demand_gpm: float) -> float:
        """How many minutes the tank can sustain a given demand."""
        if demand_gpm <= 0:
            return float("inf")
        return self.usable_volume_gal() / demand_gpm

    def is_nfpa13_compliant(self, demand_gpm: float, duration_min: float) -> tuple[bool, list[str]]:
        """Check §11.2.3.1 duration requirement: 30 min light, 60 min
        ordinary, 90 min extra — caller supplies target."""
        issues: list[str] = []
        actual = self.duration_at_flow_minutes(demand_gpm)
        if actual < duration_min:
            issues.append(
                f"TANK_DURATION_INSUFFICIENT: {actual:.1f} min @ "
                f"{demand_gpm:.0f} gpm < {duration_min:.0f} min required"
            )
        if self.elevation_ft_surface <= self.elevation_ft_outlet:
            issues.append(
                f"TANK_SURFACE_BELOW_OUTLET: surface "
                f"{self.elevation_ft_surface} ≤ outlet "
                f"{self.elevation_ft_outlet} ft"
            )
        return not issues, issues
