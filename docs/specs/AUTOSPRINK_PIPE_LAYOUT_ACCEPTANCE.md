# AutoSprink pipe-layout acceptance contract

This contract defines when Halo Fire may describe a generated sprinkler network as a proper pipe layout. It applies to flat, pitched, vaulted, and stepped roof or ceiling conditions.

## Required source bindings

Every accepted layout must remain bound to the actual project PDFs and their hashes. At minimum it needs the governing fire-protection plan, hydraulic calculation tables, architectural/structural plan, and the side, section, or elevation views used to solve Z. A generated overlay without the governing PDF underlay is not proof.

## Three directions that must never be conflated

1. **Calculation order** is the AutoSPRINK table traversal from the remote terminal toward the water source.
2. **Physical hydraulic flow** is water-source to terminal and normally reverses calculation-table order.
3. **Drainage grade** is the high-to-low vector toward the intended drain. It is independent of hydraulic flow and cannot be inferred from it.

## Per-edge acceptance fields

Every accepted primary pipe edge must have:

- exact canonical endpoints and an explicit approved-plan edge sequence;
- role: source feed, cross main, branch line, arm-over, drain, or test connection;
- nominal and actual diameter;
- calculation-node and hydraulic-flow binding where the edge participates in a calculation route;
- start and end elevation, routing plane, and vertical transition evidence;
- grade magnitude, high endpoint, low endpoint, and intended drain destination;
- fitting, coupling, valve, offset, penetration, and field-route status;
- roof/ceiling surface and obstruction-clearance evidence for pitched conditions.

## Hard rejection rules

- Do not choose a route with generic shortest-path, nearest-neighbor, Steiner, or tree fallback when the source topology contains a loop.
- Do not promote a 2D plan route to a graded pipe without source-bound start and end elevations.
- Do not derive drainage direction from hydraulic flow.
- Do not hide unresolved cut length, vertical offset, fitting, or masked-plan residuals inside a visually smooth line.
- Do not invent geometry for notes such as `FIELD ROUTE` or `LOCATE`.
- Do not call plan-only, elevation-only, or 3D-only output complete; all three views must resolve to the same pipe IDs and coordinates.

## Required verification loop

Acceptance requires all of the following on the same project artifact:

1. deterministic replay from hashed source PDFs;
2. exact topology, endpoint, size, role, and direction checks;
3. plan-to-elevation-to-3D coordinate closure;
4. hydraulic-table length/elevation reconciliation with explicit residual reasons;
5. pitched-roof surface and obstruction clearance checks;
6. adversarial mutations for alternate loop paths, reversed grade, wrong elevation, missing fitting, and displaced PDF registration;
7. rendered proof over the actual plan plus registered elevation and 3D views.

`properPipeLayoutReady`, `fabricationReady`, and `fieldReleaseReady` must remain false until every required item above is source-proved. Human review may be recorded, but it is not an independent acceptance blocker or a substitute for these machine verification loops.
