# HaloFire Studio — HARD UX INVARIANTS + COMPREHENSIVE REGRESSION SUITE

Every wave's gate MUST run ALL of these on the LIVE site (headless + screenshots).
A wave that breaks ANY previously-passing invariant FAILS, even if its own feature
works. This exists because waves kept silently regressing prior work (dbl-click
zoom, selection, viewport cleanliness). NONE of these may be weakened to pass.

## 1. THE VIEWPORT IS SACRED — 3D/2D ONLY (user 2026-06-13, HARD RULE)
NO panels, windows, popups, banners, stat boxes, or the Inspector may EVER be
placed in or pop up over the 3D/2D viewport canvas. The viewport renders the
model and NOTHING else. Everything docks in the LEFT tools panel or the RIGHT
results panel:
- Level switcher ("LEVELS — BUILT FROM PLAN" L1..L8) → LEFT panel section.
- "extracted geometry" / plan-extraction stats → LEFT or RIGHT panel section.
- needs-verification banners → inside the relevant panel section (NOT floating on canvas).
- Inspector (part selection) → RIGHT results panel (already required; keep it there).
- The ONLY things allowed touching the viewport: the minimal view toolbar
  (3D/Top/Fit/Select) and the orientation cube + scale bar (top-right) — these are
  controls, not windows, and must be small/edge-anchored, never occluding content.
- GATE: in a live top + 3D screenshot, assert NO DOM panel/overlay element's
  bounding rect intersects the canvas rect, except the allowed toolbar + view cube.
  FAIL if the level switcher / stats / banner / inspector overlap the canvas.

## 2. SELECTION + INSPECTION CONTRACT (must always hold — W2b verified, do not regress)
- Plain click = select only; camera does NOT move; recolor highlight (reserved hue),
  NO bounding/wireframe box.
- Click a different part → selection moves (repeatable forever).
- F or single-purpose = frame; **DOUBLE-CLICK = zoom to front-facing + X-RAY isolate**
  (selected part opaque + visible through occluders; everything else ~15% opacity).
- **DOUBLE-CLICK AGAIN = exit X-ray + deselect all** (restore opacities + pivot exactly).
- Scroll zoom dollies toward the selected part; orbit pivots about it.
- Inspector renders in the RIGHT results panel, never over the viewport.
- Esc/empty-click deselects, restores. GATE: behavioral, real synthetic events.

## 3. SCALE + PARTS (both projects)
- True scale (1 unit=1ft), no exaggeration control. Building bbox matches plan;
  head spacing matches data; pipe ODs true; parts dimensioned + on-axis.

## 4. EDIT TOOLS (W1 — do not regress)
- Draw wall/pipe/head/door persists; move changes coords; delete removes; undo
  reverts exactly; snaps land on target.

## 5. EXTRACTION CORRECTNESS (recore)
- Real structure (plausible count, hundreds not thousands), parking paint EXCLUDED,
  underlay readable from above (text not mirrored), no clipping at any view angle.

## 6. PLATFORM
- Both autosprink.html hotfix markers present (#demoBtn{display:none + select option,
  select optgroup). Local test suite green. Live==committed (git cat-file verify in
  E:/ClaudeBot/halofire-studio). No new AHJ/PE/mfr-exact/parity claims; flags intact.

## ENFORCEMENT
Every ultramode wave's final gate runs §1–§6. The loop does not advance past a wave
until all pass, verified by screenshots Claude personally inspects for §1, §2, §5.
