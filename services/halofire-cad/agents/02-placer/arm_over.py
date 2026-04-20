"""Obstruction-aware head placement — AutoSprink's "automatic arming
around obstructions" feature (Platinum tier).

NFPA 13 §14.2.9 requires a minimum clear distance between a sprinkler
and any obstruction (ceiling beam, HVAC duct, light fixture, column).
When the ideal grid position falls inside an obstruction's 3-ft
buffer, the head must be shifted to an allowable "arm-over" position:
move it laterally along the branch line by the smallest delta that
clears the buffer.

This module is pure geometry — placer calls shift_for_obstructions()
after it's built the raw grid but before it commits head positions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


# NFPA 13 §14.2.9: standard pendant sprinklers require a minimum
# 3 ft (0.91 m) horizontal separation from an obstruction against
# the ceiling. Specialty heads relax this — we store the default
# and let the caller pass a per-head override.
DEFAULT_CLEARANCE_M = 0.91

# Maximum lateral shift we're willing to apply before giving up and
# recommending the designer add a supplementary head. Anything more
# than ~1.5 m means the grid itself was wrong, not just the
# obstruction.
MAX_SHIFT_M = 1.5


@dataclass(frozen=True)
class Obstruction:
    """Axis-aligned bounding box in the ceiling plane (xy)."""
    x0: float
    y0: float
    x1: float
    y1: float

    def expanded(self, by: float) -> "Obstruction":
        return Obstruction(self.x0 - by, self.y0 - by,
                           self.x1 + by, self.y1 + by)

    def contains(self, x: float, y: float) -> bool:
        # Strict — a point exactly on the edge is considered clear
        # so a single shift that lands on the boundary isn't
        # re-entered on the next iteration.
        return self.x0 < x < self.x1 and self.y0 < y < self.y1


@dataclass(frozen=True)
class ShiftResult:
    x: float
    y: float
    shifted: bool
    distance_m: float   # how far we had to move the head
    reason: str         # 'clear', 'shifted_out_of_buffer', 'over_max_shift'


def _nearest_edge_delta(
    x: float, y: float, buf: Obstruction,
) -> tuple[float, float]:
    """Smallest (dx, dy) that pushes (x,y) outside `buf`.

    Returns the shift to the NEAREST of the four expanded edges.
    """
    d_left   = x - buf.x0        # positive → inside from left edge
    d_right  = buf.x1 - x        # positive → inside from right edge
    d_bottom = y - buf.y0
    d_top    = buf.y1 - y
    # Out-of-buffer distance for each direction (negative means outside
    # that way — free to go without moving). We want the minimum
    # positive distance — that's the closest edge to escape through.
    options = [
        (d_left,   "left",   -d_left,  0.0),   # move -dx
        (d_right,  "right",  +d_right, 0.0),   # move +dx
        (d_bottom, "bottom", 0.0,      -d_bottom),
        (d_top,    "top",    0.0,      +d_top),
    ]
    # Pick the direction with the smallest positive inside-distance
    best = min(options, key=lambda o: o[0])
    _, _, dx, dy = best
    return dx, dy


def shift_for_obstructions(
    x: float,
    y: float,
    obstructions: list[Obstruction],
    clearance_m: float = DEFAULT_CLEARANCE_M,
    max_shift_m: float = MAX_SHIFT_M,
) -> ShiftResult:
    """Shift (x, y) until it's outside every obstruction's buffer.

    Greedy: finds the nearest buffer edge, slides perpendicular to it.
    Repeats up to 4 iterations (handles overlapping buffers). Returns
    the final coord + how far we moved.

    If the required shift exceeds `max_shift_m`, returns the ideal
    position with `shifted=False` and reason='over_max_shift' so the
    caller can decide whether to flag the head as needing manual
    attention.
    """
    cx, cy = x, y
    total = 0.0
    # Tiny epsilon so a shift lands just OUTSIDE the buffer edge
    # rather than exactly on it.
    eps = 1e-3
    buffered = [o.expanded(clearance_m) for o in obstructions]
    for _ in range(8):
        hit = next((b for b in buffered if b.contains(cx, cy)), None)
        if hit is None:
            break
        dx, dy = _nearest_edge_delta(cx, cy, hit)
        step = math.hypot(dx, dy)
        if step == 0.0:
            # Stuck — no direction reduces the buffer. Give up.
            break
        # Push eps past the edge to prevent re-entry on next iteration.
        if dx != 0.0:
            dx += math.copysign(eps, dx)
        if dy != 0.0:
            dy += math.copysign(eps, dy)
        step = math.hypot(dx, dy)
        if total + step > max_shift_m:
            return ShiftResult(
                x=x, y=y, shifted=False,
                distance_m=total + step,
                reason="over_max_shift",
            )
        cx, cy = cx + dx, cy + dy
        total += step
    return ShiftResult(
        x=cx, y=cy,
        shifted=(cx, cy) != (x, y),
        distance_m=total,
        reason="shifted_out_of_buffer" if (cx, cy) != (x, y) else "clear",
    )


__all__ = [
    "DEFAULT_CLEARANCE_M",
    "MAX_SHIFT_M",
    "Obstruction",
    "ShiftResult",
    "shift_for_obstructions",
]
