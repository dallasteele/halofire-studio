"""Phase C.3 — Pump curve + iteration support.

A fire pump's output pressure P is a function of its flow Q, given by
the manufacturer's curve. NFPA 20 requires the pump to deliver
rated capacity at rated pressure, 150% capacity at ≥65% rated
pressure, and the churn (no-flow) pressure at ≤140% rated.

We model the curve with three anchor points + quadratic fit. Caller
supplies the rated + 150% + churn points; we return P(Q) at any Q.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class PumpCurve:
    """Three-point NFPA 20 pump characterization.

    rated_q_gpm, rated_p_psi: nameplate operating point
    overload_q_gpm, overload_p_psi: 150% capacity @ ≥65% rated P
    churn_p_psi: pressure at zero flow (≤140% rated P)
    """
    rated_q_gpm: float
    rated_p_psi: float
    overload_q_gpm: float
    overload_p_psi: float
    churn_p_psi: float

    def is_nfpa20_compliant(self) -> tuple[bool, list[str]]:
        """Check the 3 NFPA 20 shape rules. Return (pass, violation list)."""
        issues: list[str] = []
        # Overload ≥ 65% of rated pressure
        if self.overload_p_psi < 0.65 * self.rated_p_psi:
            issues.append(
                f"PUMP_OVERLOAD_BELOW_65: {self.overload_p_psi:.1f} psi "
                f"< 65% × {self.rated_p_psi:.1f} psi"
            )
        # Churn ≤ 140% of rated pressure
        if self.churn_p_psi > 1.40 * self.rated_p_psi:
            issues.append(
                f"PUMP_CHURN_ABOVE_140: {self.churn_p_psi:.1f} psi "
                f"> 140% × {self.rated_p_psi:.1f} psi"
            )
        # Overload Q is 150% of rated
        if abs(self.overload_q_gpm - 1.5 * self.rated_q_gpm) > 1.0:
            issues.append(
                f"PUMP_OVERLOAD_Q_NOT_150: {self.overload_q_gpm} gpm "
                f"!= 1.5 × {self.rated_q_gpm} gpm"
            )
        return not issues, issues

    def pressure_at(self, q_gpm: float) -> float:
        """Return P (psi) at flow Q (gpm) via quadratic through 3 points.

        Uses Lagrange interpolation for simplicity; for real curves
        with many sample points, caller should replace with cubic spline.
        """
        if q_gpm < 0:
            q_gpm = 0
        x1, y1 = 0.0, self.churn_p_psi
        x2, y2 = self.rated_q_gpm, self.rated_p_psi
        x3, y3 = self.overload_q_gpm, self.overload_p_psi

        def L(x: float, xi: float, xj: float) -> float:
            return (x - xi) * (x - xj)

        try:
            return (
                y1 * L(q_gpm, x2, x3) / L(x1, x2, x3)
                + y2 * L(q_gpm, x1, x3) / L(x2, x1, x3)
                + y3 * L(q_gpm, x1, x2) / L(x3, x1, x2)
            )
        except ZeroDivisionError:
            return self.rated_p_psi
