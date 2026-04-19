---
name: halofire-placer
description: Per-room sprinkler head placement honoring NFPA 13 §11.2 spacing, with obstruction clearance checks and head-type selection. Replaces naive whole-building grid.
inputs: [Building with classified hazards]
outputs: [Head[] with per-room coverage]
model: rule-based (core), sonnet (head-type selector), opus (violation fixer)
---

# Placer Agent v2

## Per-room solver

For each Room in each Level:
1. Get max spacing `s` from `spacing_table[room.hazard_class]`
2. Shrink room polygon by `s/2` (safety margin from walls) → usable polygon
3. Fit a rectangular grid at spacing `s × s` (or smaller to cover tight
   corners) whose centroid lies inside the usable polygon
4. Drop a head at each grid cell center inside the usable polygon
5. For each head, check NFPA §11.2.3.2 beam rule against obstructions
   in its 18" radius — move head if clearance violated
6. Select head type (pendent / upright / sidewall / concealed /
   residential) from room context:
   - Residential + ceiling_tile → concealed pendent
   - Mech/garage + open deck → upright
   - Narrow corridor < 1.2 m wide → sidewall on long wall
7. Assign K-factor from hazard:
   - light → K5.6
   - ordinary → K8.0
   - extra → K11.2 or K14.0

## Spacing table (§11.2.3.1.1)

```
hazard          max_spacing_m   max_spacing_ft
light           4.57            15.0
ordinary_i      4.57            15.0
ordinary_ii     4.00            13.125
extra_i         3.66            12.0
extra_ii        3.66            12.0
residential     3.66            12.0 (or per listing)
```

Max coverage per head = max_spacing × max_spacing, clamped by
§11.2.3.1.2 coverage-table (light: 225 sqft, ord: 130, extra: 100/90).

## Obstruction check

For each proposed head `h` and each obstruction `o` in the level:
- If `o.bottom_z > ceiling - 150mm` → it's a beam/soffit; enforce the
  `3×d` rule (§11.2.3.2) — head must be at least 3× the obstruction's
  lateral dimension from its face, up to 60"
- If inside a shaft or elevator pit → skip placement (closets §9.2.1)

## Designer loop

When obstruction violations can't be resolved by moving the head
(e.g., tight mech room packed with equipment), escalate to Opus:
- Input: the room polygon + obstructions + current heads + violations
- Output: proposed head moves, head-type swaps, extra heads, or
  "omit this room and document" per §9.2.1

## Output

List of Head objects with position_m, sku (from catalog), K-factor,
temp_rating, orientation, room_id assignment.
