# Blueprint 05 — Tools & Interactions

**Scope:** Every tool the user interacts with in the viewport,
keyboard map, snaps, cursor states, context menus. This is the
AutoSPRINK-class interaction surface.

## 1. Tool lifecycle (Pascal's pattern)

Every tool implements:

```typescript
interface Tool {
  id: string                 // 'pipe-route', 'sprinkler-place', …
  label: string              // shown in ribbon
  shortcut?: string          // single keystroke activator
  onActivate(ctx: ToolContext): void
  onPointerMove(ev: PointerEvent, ctx: ToolContext): void
  onPointerDown(ev: PointerEvent, ctx: ToolContext): void
  onPointerUp(ev: PointerEvent, ctx: ToolContext): void
  onKey(ev: KeyboardEvent, ctx: ToolContext): void
  onDeactivate(ctx: ToolContext): void
  renderGhost(): JSX.Element | null     // drag-preview geometry
  renderCursorHint(): JSX.Element | null // crosshair/tooltip
}
```

Registered via `packages/editor/src/store/use-tool-registry.ts`.
Active tool stored in `useEditor((s) => s.activeToolId)`.

## 2. Tool inventory

### 2.1 Sprinkler Place (`sprinkler-place`)

Key: **H**
Location: Ribbon → Design → Heads → Place single.

States:
1. **Idle** — tool active, awaiting first click.
2. **Hovering ceiling** — ghost head at cursor with shadow
   circle showing coverage; violations panel shows
   distance-to-nearest-head + distance-to-nearest-wall warnings
   in real time.
3. **Click commits** — head created; tool stays active for next
   placement.
4. **Escape exits** — tool deactivates, returns to Select.

Ghost rendering:
- Translucent GLB of chosen SKU.
- Coverage circle (per NFPA 13 §8.6 spacing table for the
  ceiling's hazard class) in red if overlapping another head's
  circle, orange if within 4" of a wall, green otherwise.

Error paths:
- No ceiling under cursor → ghost red, click blocked, tooltip
  "Need a ceiling surface".
- Overlap > 50% with existing head → click blocked, tooltip
  "Too close to {other head}".

Context menu on placed head:
- Move
- Duplicate
- Delete
- Change SKU
- Isolate
- Select system

### 2.2 Sprinkler Array (`sprinkler-array`)

Key: **Shift-H**

Drag-rectangle across a ceiling → fills with a grid of heads on
NFPA-compliant spacing.

- Hazard class read from the ceiling's tags.
- Grid orientation = rectangle's long axis.
- Rows offset per square or staggered per hazard class.
- Preview updates per-frame during drag; head count displayed
  inline ("72 heads, 256 ft² avg").
- Release commits all heads in one transaction.

### 2.3 Pipe Route (`pipe-route`)

Key: **P**

Click-click-click polyline.

States:
1. **Idle** — first click anchors start point.
2. **Routing** — rubber-band pipe segment follows cursor.
   - Hold **Shift** → snap to ortho axes.
   - Hold **Alt** → 45° increments.
   - **Tab** → cycle pipe size in ribbon combo.
3. **Dimensional input** — type while routing →
   Location Input chip captures input → on Enter, next vertex
   placed at that exact distance.
4. **Double-click / Enter** — ends polyline.
5. **Escape** — cancels in-progress polyline.

Auto-fitting: each vertex gets an elbow_90 (or elbow_45 based on
angle) fitting inserted automatically with matching size +
connection_style.

### 2.4 Pipe Modify (`pipe-modify`)

Key: **M**

Sub-modes: **Split**, **Join**, **Trim**, **Extend**.

- Split: click a point on a pipe → divides into two, inserting
  an appropriate coupling.
- Join: select two collinear pipes → merges, removing the
  coupling between.
- Trim: click a pipe past an intersection → shortens to the
  intersection.
- Extend: click a pipe end → drags to new point (same as
  endpoint handle drag on selection).

### 2.5 Sprinkler Connect (`sprinkler-connect`)

Key: **C**

Select a row of heads → click "Connect to branch". Branch pipe
routed along the row at the correct drop elevation, drops
inserted at each head.

Inputs:
- Branch size (auto-sized by hydraulic pre-check, overridable).
- Drop size (usually 1").
- Branch elevation (defaults: ceiling minus 1" for pendant).

### 2.6 Auto Route Branch (`auto-route`)

Key: **Shift-A**

Takes a selection of heads → runs the router agent (Python
sidecar call) with those heads as input. Returns branches +
fittings + drops. One-transaction commit.

### 2.7 Remote Area Draw (`remote-area-draw`)

Key: **R**

Click-click-click polygon on a floor plan. Defines a RemoteAreaNode
for NFPA §19 design-area hydraulic calc. Minimum area enforced per
hazard (1500 ft² LH, 2500 ft² EH1). Shows running ft² during
drag.

### 2.8 Dimension (`dimension`)

Key: **D**

Sub-modes:
- **Linear** — click two points, click dim line position.
- **Continuous** — chain dim strings.
- **Ordinate** — all dims from a datum.
- **Radial** / **Diameter** — on arcs / circles.
- **Aligned** — dim in arbitrary direction.

Dimensions live in the 2D floorplan view (Pascal's split view
supports 2D mode already). Exportable to DXF.

### 2.9 Text / Callout (`text`)

Key: **T**

Click placement → inline input box → leader line drag.

Styles: generic note, pipe size label, head SKU label, room name,
zone tag, revision cloud note.

### 2.10 Revision Cloud (`revision-cloud`)

Key: **Shift-R**

Drag freehand cloud around an area; auto-numbered bubble;
links to a revision entry.

### 2.11 Measure (`measure`)

Key: **Shift-M**

Click two points → readout of distance (with unit toggle) in a
floating chip. Non-destructive.

### 2.12 Orbit / Pan / Zoom

Pascal built-in. Middle mouse pan; right mouse orbit; scroll zoom.
Camera presets in viewer toolbar: Top, Iso, Front, Side, Reset.

## 3. Snap system

`packages/core/src/systems/snap/` (new).

Enabled snaps (toggleable via Snaps flyout in ribbon):

| Snap | Key | Priority |
|---|---|---|
| Grid | Shift-G | 1 |
| Endpoint | Shift-E | 2 |
| Midpoint | Shift-D | 3 |
| Center | Shift-C | 4 |
| Perpendicular | Shift-P | 5 |
| Intersection | Shift-X | 6 |
| Tangent | Shift-T | 7 |
| Ortho | Shift-O | 1 (modifier) |

Snap resolution:
- Project cursor ray into the active plane.
- For each enabled snap, compute a candidate point.
- Pick the lowest-priority-number hit within 10 px (screen space).
- Render a yellow dot + label ("ENDPT", "MID", "CEN") at the
  chosen snap.

Configurable in Preferences → Snaps.

## 4. Location Input chip

`components/halofire/LocationInput.tsx` — docked below viewport,
visible while any placement/routing tool is active.

3 fields: X, Y, Z. Keyboard-focusable; Tab cycles X→Y→Z.

During drag:
- Fields echo cursor position in project coords.
- User typing in a field overrides the cursor for that axis
  (constrained placement).

Supported input formats:
- Imperial: `12'6"`, `12'-6 1/2"`, `12.5 ft`, `12.5'`.
- Metric: `3.81 m`, `3810 mm`.
- Formula: `12*6+3'`.

Parser in `packages/hf-core/src/units/parse-dimension.ts`.

## 5. Keyboard map

Full shortcut surface. Stored in
`apps/editor/lib/keyboard-map.ts`.

### 5.1 Modes

| Key | Action |
|---|---|
| Esc | Exit current tool / cancel action |
| Enter | Confirm tool action |
| Tab | Cycle sub-options (e.g. pipe size) |
| Delete / Backspace | Delete selection |
| Space | Toggle pan mode (mouse drag = pan) |
| F9 | Run full hydraulic calc |
| F10 | Run NFPA rule check |
| F11 | Enter / exit fullscreen |
| F12 | Screenshot / export view |

### 5.2 Tool activators

(Single-key when no text field has focus.)

| Key | Tool |
|---|---|
| S | Select |
| H | Sprinkler place |
| Shift-H | Sprinkler array |
| P | Pipe route |
| M | Pipe modify |
| C | Sprinkler connect |
| Shift-A | Auto route |
| R | Remote area |
| D | Dimension |
| T | Text |
| Shift-R | Revision cloud |
| Shift-M | Measure |
| V | Valve place |
| F | Fitting place |
| Shift-F | FDC place |

### 5.3 Edit

| Key | Action |
|---|---|
| Cmd/Ctrl-Z | Undo |
| Cmd/Ctrl-Shift-Z | Redo |
| Cmd/Ctrl-X | Cut |
| Cmd/Ctrl-C | Copy |
| Cmd/Ctrl-V | Paste |
| Cmd/Ctrl-D | Duplicate |
| Cmd/Ctrl-A | Select all in level |
| Cmd/Ctrl-Shift-A | Deselect |
| Cmd/Ctrl-K | Command palette |
| Cmd/Ctrl-F | Find (by SKU, id, name) |

### 5.4 View

| Key | Action |
|---|---|
| 1 | Iso |
| 2 | Top |
| 3 | Front |
| 4 | Side |
| 5 | Reset camera |
| Z | Zoom to fit |
| Shift-Z | Zoom to selection |
| / | Toggle 2D / 3D / split |

### 5.5 Layers

| Key | Action |
|---|---|
| Shift-1 | Toggle heads |
| Shift-2 | Toggle pipes |
| Shift-3 | Toggle walls |
| Shift-4 | Toggle obstructions |
| Shift-5 | Toggle arch underlay |

## 6. Context menus

Right-click on a node → context menu relevant to its type.

- Head: Move / Duplicate / Delete / Change SKU / Isolate /
  Select system / Select floor / Show in remote area.
- Pipe: Move / Duplicate / Delete / Split / Join to selected /
  Resize / Change schedule / Add fitting mid-span / Select
  downstream / Select system.
- Fitting: Move / Delete / Swap SKU / Rotate / Select adjacent
  pipes.
- Valve: Move / Delete / Swap SKU / Open / Close / Supervise.
- System: Rename / Show hydraulic report / Change hazard /
  Recalc.

## 7. Cursor states

Cursor changes communicate tool state:

- Idle Select → arrow.
- Hovering selectable → arrow + glow on target.
- Placement tool → crosshair + ghost.
- Routing tool → crosshair + rubber-band segment.
- Invalid placement → crosshair with red slash.
- Drag in progress → fist / closed hand.
- Over a handle → direction arrow (N/S/E/W).

Implemented via CSS `cursor: url('...')` on the viewport
canvas, reactive to `useEditor((s) => s.cursorKind)`.

## 8. Tests

- `apps/editor/e2e/tool-sprinkler-place.spec.ts` — click a
  ceiling, assert head appears.
- `apps/editor/e2e/tool-pipe-route.spec.ts` — multi-click
  polyline, assert N pipes + N-1 elbow fittings.
- `apps/editor/e2e/snap-priority.spec.ts` — assertions for
  every priority combo.
- `packages/hf-core/tests/units/parse-dimension.spec.ts` —
  every input format above → expected value.
- `apps/editor/e2e/keyboard-map.spec.ts` — every shortcut fires
  the expected tool/action.

## 9. Open questions

- Should tools be persistent (stay active for repeated placement)
  or one-shot (snap back to Select after commit)? Config per
  user. Default = persistent for placement tools, one-shot for
  modify tools.
- Double-click-to-edit vs click-to-select — current Pascal is
  click-to-select; double-click is pan-to-focus.
