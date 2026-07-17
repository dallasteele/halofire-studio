# Cooperative 1881 A-121 to S-190 roof slope registration

The issued architectural `A-121 ROOF PLAN.dwg` is not treated as a generic
background image. Its `SLOPE 1/4" PER FOOT`, `SLOPE 1/2" PER FOOT`, and
`SLOPE 2" PER FOOT` annotations are retained only when their own native leader
has exactly one endpoint at the annotation origin. The opposite leader endpoint
is recorded as the source callout target; it is not interpreted as the slope
direction.

The target coordinates are registered to issued `S-190 OVERALL ROOF FRAMING
PLAN.dwg` through actual shared grid line geometry: twelve numeric identities
and three letter identities. The two fitted axes replay at zero native drawing
unit residual. A changed source hash, unknown entity, insufficient grid set,
excessive residual, ambiguous/missing leader, or transformed target outside the
S-190 roof-plan bounds rejects.

The artifact records 19 targets: 8 at `1/4 in/ft`, 4 at `1/2 in/ft`, and 7 at
`2 in/ft`. This proves only where those A-121 annotations land in the S-190
coordinate frame. It does not establish roof-face boundaries, a slope direction
vector, roof elevations, framing solids, sprinkler placement, pipe routing,
obstruction clearance, fabrication, code compliance, employee readiness, or a
VPS release.

Visual decision: the first receipt was rejected because full labels collided
over dense source linework. The accepted source receipt uses rate-colored
markers plus a readable legend; the hash-bound handle/text detail stays in the
JSON receipt.
