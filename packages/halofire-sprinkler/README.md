# @halofire/sprinkler

NFPA 13 sprinkler placement rules + head catalog for Halofire Studio.

Part of the Halofire fork of Pascal Editor. See repository root
[HALOFIRE_ROADMAP.md](../../HALOFIRE_ROADMAP.md) for the product plan.

## Status

**Phase 3 (scaffold only).** Types + hazard-class table in place. Rule
validator is a stub. Head catalog is empty. Full implementation scheduled
for the 3-week Phase 3 window per the roadmap.

## Exports (planned)

- `HazardClass` — NFPA 13 occupancy classifications (Light / Ordinary I+II / Extra I+II)
- `SPACING_LIMITS_FT` — max spacing, wall distance, coverage per class
- `DENSITY_GPM_PER_SQFT` — design density curves for hydraulic calcs
- `Head` type + catalog of manufacturer SKUs (Victaulic, Tyco, Reliable, Viking)
- `validatePlacement(ctx)` — returns PASS/FAIL + rule violations for a proposed head location

## Compliance disclaimer

Rule values cited here approximate NFPA 13 2022. A live subscription to
the current code is required for production design work. Every bid must be
reviewed and stamped by a licensed fire protection engineer before submittal.
No automated validation replaces that review.
