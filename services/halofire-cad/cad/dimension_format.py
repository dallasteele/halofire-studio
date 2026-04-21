"""R10.6 — Python mirror of ``packages/hf-core/src/drawing/dimension.ts``
``formatDimensionText``.

Keeps TS and Python dimension-text formatting byte-for-byte aligned so
that DXF annotations emitted by ``dxf_export.py`` match the text the
on-screen sheet renderer shows. Parity is enforced by
``tests/test_golden_parity.py`` against shared fixtures under
``packages/hf-core/tests/golden/dimension-format/``.

Any edit here must land with a matching edit in ``dimension.ts`` —
that's the CI contract.

See blueprints:
  - 07_DRAWING_SHEET_MANAGEMENT.md §5 (dimension formatting)
  - 14_TEST_STRATEGY.md §3 (cross-engine parity CI)
"""
from __future__ import annotations

import math
from math import gcd
from typing import Literal

UnitDisplay = Literal["ft_in", "decimal_ft", "m", "mm"]

_METRES_PER_INCH = 0.0254
_METRES_PER_FOOT = 0.3048


def format_dimension_text(
    length_m: float,
    unit_display: UnitDisplay,
    precision: int,
) -> str:
    """Format ``length_m`` metres under the given unit mode + precision.

    Behaviour must match the TS ``formatDimensionText``:

    - ``m``          → ``"{length_m:.{precision}f} m"``
    - ``mm``         → ``"{round(length_m * 1000)} mm"`` (precision ignored)
    - ``decimal_ft`` → ``"{length_m/0.3048:.{precision}f} ft"``
    - ``ft_in``      → feet-and-inches with fractional denominator
                       ``1 << clamp(precision, 0, 4)``.
    """
    if unit_display == "m":
        return f"{length_m:.{precision}f} m"
    if unit_display == "mm":
        return f"{round(length_m * 1000)} mm"
    if unit_display == "decimal_ft":
        ft = length_m / _METRES_PER_FOOT
        return f"{ft:.{precision}f} ft"
    if unit_display == "ft_in":
        return _format_feet_inches(length_m, precision)
    raise ValueError(f"unknown unit_display: {unit_display!r}")


def _format_feet_inches(length_m: float, precision: int) -> str:
    total_inches = length_m / _METRES_PER_INCH
    # Clamp precision to [0..4] → fractional denominator {1, 2, 4, 8, 16}.
    p = max(0, min(4, int(precision)))
    denom = 1 << p
    snapped = round(total_inches * denom) / denom
    # Truncation toward zero, matching TS ``Math.trunc``.
    feet = math.trunc(snapped / 12)
    inches = snapped - feet * 12
    if snapped < 0 and inches != 0:
        inches = 12 + inches
        feet -= 1
    whole = math.trunc(inches + 1e-9)
    frac = inches - whole
    frac_numer = round(frac * denom)
    if frac_numer == 0:
        return f"{feet}'-{whole}\""
    g = gcd(int(abs(frac_numer)), denom) or 1
    n = int(frac_numer // g)
    d = int(denom // g)
    if whole == 0:
        return f"{feet}'-{n}/{d}\""
    return f"{feet}'-{whole} {n}/{d}\""


__all__ = ["format_dimension_text", "UnitDisplay"]
