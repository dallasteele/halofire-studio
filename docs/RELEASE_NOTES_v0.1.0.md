# HaloFire Studio v0.1.0 — Release Notes

> **Ship date target:** 2026-04-21
> **Status:** Pre-tag — awaiting final MSI smoke on a clean Windows VM.

This is a ship note, not a marketing page. If you are a fire-protection
engineer evaluating HaloFire Studio for your own bid desk, this is the
honest picture of what you are getting, what works well, and what is
still a known rough edge.

---

## What HaloFire Studio is

HaloFire Studio is a desktop CAD application, purpose-built for
fire-protection design — sprinkler systems, standpipes, FDCs, risers,
and their bid paperwork.

The core workflow is:

1. **Drop** an architect PDF (or DXF) into the editor.
2. **Auto-Design** lays out heads, pipes, systems, risers, and FDCs
   against the building envelope inside spec tolerance.
3. **Edit** the design with native CAD-feeling tools (place, route,
   dimension, text, revision-cloud) while a streaming pipeline keeps
   hydraulic demand, BOM, labor hours, and the proposal number
   consistent with every change.
4. **Export** the submittal package — a bound PDF with title-block
   sheets, DXF for the plan-check workflow, and DWG (when required)
   via the bundled ODA File Converter.

The entire stack runs on your laptop. There is no cloud service, no
SaaS subscription, and no `localhost:*` port you have to keep alive.
HaloFire Studio is a Tauri 2 desktop app — Rust IPC in the front,
Python sidecar (CAD pipeline) and an OpenSCAD subprocess (catalog
rebuild) in the back — so it runs air-gapped on a jobsite laptop
without a network connection.

---

## Headline features

**Auto-Design against a real PDF.** Drop an architect's PDF into the
editor and get a compliant sprinkler plan inside spec tolerance. On
the 1881 truth fixture we validated with the first ship gate:
- head count within 0.8% of the truth,
- bid within 10.5%,
- system count and level count exact.

**Pascal-style editor with 12 first-class fire-protection nodes.**
The editor's node graph is typed end-to-end for our world:
`SprinklerHead`, `Pipe`, `System`, `Fitting`, `Valve`, `Hanger`,
`Device`, `FDC`, `RiserAssembly`, `RemoteArea`, `Obstruction`,
`Sheet`. TypeScript (front) and Python Pydantic (pipeline) share
the same schema, locked in CI with golden parity fixtures.

**Streaming 10-stage pipeline with LiveCalc.** Every edit flows
through `intake → classify → place → route → hydraulic →
rulecheck → bom → labor → proposal → submittal`. You see the
demand psi update as you reroute a main. The BOM reflects the part
you just swapped. The proposal dollar figure moves with the heads
you added.

**40-part OpenSCAD-authored catalog.** Catalog parts are authored in
real OpenSCAD with structured annotations. The build pipeline
compiles `catalog.json` that the app consumes — so adding a new
valve is a pull request, not a DBA ticket. The in-app `CatalogPanel`
shows each part with a thumbnail, searchable facets, and drag-to-
place.

**Sheet-set renderer → bound submittal PDF.** Drop a `SheetNode`
and the renderer produces a title-block-stamped PDF page, then binds
the sheet set into a single submittal PDF the permit office will
accept. DXF (paper-space + dims) and DWG (via ODA File Converter)
are the same pipeline with different back-end renderers.

**60fps at 1500+ heads.** The viewer's `InstancedCatalogRenderer`
uses instanced meshes so a warehouse with 1500 sprinkler heads
scrolls at 60fps on a mid-range laptop GPU. You can pan and zoom
without the viewport freezing.

**`.hfproj` single-file projects.** Atomic saves with crash-recovery
autosave, undo/redo history, and embedded IFC + catalog version
stamps so a project re-opened a year later renders identically.

**403 Python tests + 274 Playwright tests + parity CI.** The
pipeline is covered at the unit and golden level. The editor is
covered at the E2E level. A dedicated CI job asserts the TS and
Python schemas produce bit-identical output on a shared fixture —
so drift between front and back is a broken build, not a ship
surprise.

---

## Install + first bid

**Windows (primary platform).**

1. Download `HaloFire-Studio-0.1.0-x64.msi` from the release page.
2. Double-click, accept the default install path, launch.
3. First run opens the `warehouse-example` project pre-seeded.
4. `File → Import → PDF` and pick an architect set (the 1881 fixture
   ships with the install at `examples/1881-truth/1881.pdf`).
5. Press `Auto-Design`. Wait ~30 seconds for the first pass.
6. `File → Export → Submittal PDF`. You have a bid-ready package.

**macOS + Linux.** DMG + AppImage artifacts build in the same
release matrix. macOS ships the x86 2021.01 OpenSCAD via Rosetta
(native arm64 OpenSCAD is still unreleased upstream — see below).

---

## Known limits (read these before you trust a bid)

- **Real second-project validation is pending real customer PDF.**
  The scaffold is proven against the synthetic
  `gomez-warehouse-az` fixture. The ship-gate DoD-#11 closes with
  the first real customer intake. Until then, treat Auto-Design's
  output on an unfamiliar building geometry as a starting point,
  not a submission.
- **Clean-VM MSI install smoke is manual-only.** DoD-#12 closes
  with the first tagged release artifact's full
  `install → launch → open example → build submittal` pass on a
  bare Windows 11 VM. The release script exists; the smoke is the
  gate.
- **Cold-launch time is unmeasured.** We will stopwatch the first
  `.msi` and record the number in the v0.1.1 release notes. Expect
  a few seconds on a modern SSD.
- **LiveCalc hydraulic is re-READ, not re-SOLVE.** Edits to an
  upstream input (e.g. a pipe diameter) update the panel's
  displayed numbers but do not re-run the solver. For now, after a
  material change, hit `Recalculate` in the pipeline toolbar. A
  future version will re-solve incrementally.
- **OpenSCAD on Apple Silicon ships x86 2021.01 via Rosetta.**
  Native arm64 OpenSCAD is still upstream-unreleased. We will
  switch the bundle the first stable arm64 cut lands.
- **DWG export uses ODA File Converter.** We bundle a placeholder
  fallback for the case where ODA is not on the install path; in
  that fallback, DWG files open but are missing paper-space
  dimension blocks. If a plan-check office requires DWG, verify
  ODA is present (`Tools → Environment`).

---

## What's next

The v0.1.x patch line will close the four open ship-gate DoD rows
(cold-launch time, real second-project, clean-VM MSI, LiveCalc
re-solve) and land any field-reported crash fixes.

v0.2.0 will open:
- incremental hydraulic re-solve on upstream edits,
- a second catalog family (standpipe + hose-valve) authored the same
  way as the sprinkler parts,
- a first-pass plan-check rule engine that lets a city's local
  amendments plug into the `rulecheck` stage.

The full roadmap lives at `HALOFIRE_ROADMAP.md`.

---

## Thanks

To Wade at Halo Fire Protection for the bid data, the pricebooks,
and the patience to watch the first ten Auto-Design runs come back
wrong before one came back right. This ship is as much yours as
ours.
