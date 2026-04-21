# Blueprint 15 — Design System

**Scope:** Visual language — tokens, typography, color, spacing,
motion, iconography, component primitives. The visual side of the
AutoSPRINK-class GUI. Serves blueprint 08.

## 1. Design principles

1. **Utilitarian, not decorative.** Every pixel earns its place.
   This is CAD software; graphic flourish distracts from precision.
2. **Dense but legible.** AutoSPRINK-level information density;
   WCAG AA contrast.
3. **Accent with discipline.** Red-orange (#e8432d) is a precious
   resource; reserved for primary actions, active states, and
   fire-protection symbolism.
4. **Motion informs, doesn't entertain.** Pulse on active
   pipeline stage. Subtle drag-preview. No decorative transitions.
5. **Dark-first but light-capable.** Bid rooms favor dark themes;
   on-site drafting under daylight favors light.

## 2. Color tokens

Defined in `packages/ui/src/tokens.ts`:

### 2.1 Dark theme (default)

| Token | Hex | Use |
|---|---|---|
| `--hf-bg-0` | #0a0a0b | Page canvas |
| `--hf-bg-1` | #111113 | Panels + cards |
| `--hf-bg-2` | #1a1a1e | Raised surfaces (modals, dropdowns) |
| `--hf-bg-3` | #22222a | Input fields, active selection |
| `--hf-border` | rgba(255,255,255,0.08) | Hairlines |
| `--hf-border-strong` | rgba(255,255,255,0.15) | Button borders |
| `--hf-text-primary` | #f5f5f7 | Body text |
| `--hf-text-secondary` | #a1a1aa | Labels, captions |
| `--hf-text-muted` | #71717a | Placeholder, disabled |
| `--hf-accent` | #e8432d | Halo Fire brand, primary action |
| `--hf-accent-strong` | #ff5840 | Hover |
| `--hf-accent-muted` | rgba(232,67,45,0.2) | Active tab underline bg |
| `--hf-success` | #22c55e | Passing rules, green deltas |
| `--hf-warning` | #f59e0b | Warnings, amber deltas |
| `--hf-error` | #ef4444 | Errors, negative deltas |
| `--hf-info` | #3b82f6 | Information hints |
| `--hf-grid` | rgba(255,255,255,0.04) | Viewport grid overlay |

### 2.2 Light theme

Invert bg/text; keep accents identical for brand consistency.

### 2.3 High-contrast theme (WCAG AAA)

- Black-on-white text, 21:1 ratio.
- Accent → #c0321e (darker red; 7:1 contrast on white).
- All UI chrome rendered with 2px strokes.

## 3. Typography

### 3.1 Font families

| Role | Family | Weight | Fallback |
|---|---|---|---|
| Display (page titles, large numbers) | `"Playfair Display"` | 700 | `Georgia, serif` |
| Body (UI) | `"IBM Plex Sans"` | 400 / 600 | system-ui |
| Mono (numbers, IDs, SKUs, code) | `"IBM Plex Mono"` / `"JetBrains Mono"` | 400 / 600 | ui-monospace |

All bundled in `apps/editor/public/fonts/`.

### 3.2 Type scale

```css
--font-size-2xs: 10px;   /* badges, status ticks */
--font-size-xs:  11px;   /* labels in dense panels */
--font-size-sm:  12px;   /* body UI */
--font-size-md:  14px;   /* default body */
--font-size-lg:  16px;   /* section headers */
--font-size-xl:  20px;   /* page titles */
--font-size-2xl: 28px;   /* home screen hero */
--font-size-3xl: 40px;   /* marketing only */

--line-height-tight: 1.2;
--line-height-normal: 1.5;
--line-height-loose: 1.7;

--letter-spacing-tight: -0.02em;
--letter-spacing-normal: 0;
--letter-spacing-wide: 0.05em;
--letter-spacing-widest: 0.18em;  /* uppercase labels */
```

Labels and captions use `text-xs` with `uppercase` +
`letter-spacing-widest` to differentiate from content.

### 3.3 Code voice

Monospace fonts used for:
- Numeric fields (pipe size, K-factor, pressure)
- Node IDs, SKUs, job IDs
- Coordinates in Location Input
- Log viewers

## 4. Spacing

```css
--space-0: 0;
--space-1: 2px;
--space-2: 4px;
--space-3: 6px;
--space-4: 8px;
--space-5: 12px;
--space-6: 16px;
--space-7: 24px;
--space-8: 32px;
--space-9: 48px;
```

Base unit: 4px. Dense panels use 2-4-6; page layouts use 16-24-32.

## 5. Shape + radii

**Zero border-radius on major surfaces.** AutoSPRINK aesthetic;
mirrors engineering drawing drafting conventions.

- `--radius-0: 0` — panels, cards, the viewport, ribbon
- `--radius-1: 2px` — inputs, chips, secondary buttons
- `--radius-full: 9999px` — avatar, pill badges only

## 6. Elevation / shadows

Subtle, not decorative.

```css
--shadow-0: none;
--shadow-1: 0 1px 2px rgba(0,0,0,0.2);          /* buttons */
--shadow-2: 0 2px 8px rgba(0,0,0,0.3);          /* panels */
--shadow-3: 0 4px 20px rgba(0,0,0,0.5);         /* modals */
--shadow-glow-accent: 0 0 4px rgba(232,67,45,0.6);  /* active head dot */
```

## 7. Motion

Library: **Motion** (framer-motion successor). Timings:

```css
--ease-default: cubic-bezier(0.2, 0.7, 0.3, 1);
--ease-accent:  cubic-bezier(0.8, 0, 0.2, 1);

--dur-instant: 100ms;
--dur-fast:    200ms;
--dur-normal:  300ms;
--dur-slow:    500ms;
```

Use cases:

| Effect | Duration | Ease |
|---|---|---|
| Ribbon tab switch | 200ms | default |
| Panel collapse | 250ms | default |
| Tool ghost fade-in | 150ms | default |
| Pipeline stage check pulse | 600ms | accent (1 pulse per stage) |
| Error toast slide-in | 300ms | default |
| Modal open/close | 250ms | default |
| Layer toggle | 100ms | default |

**Never animate:** viewport content (scene stays 60 fps during
any UI animation).

## 8. Iconography

Custom SVG icon set in `packages/ui/src/icons/`. Consistent:

- 24×24 canvas, 2px stroke, rounded line caps.
- Monochrome; colored by CSS `currentColor`.
- File naming: `hf-<domain>-<name>.svg` (e.g.
  `hf-pipe-route.svg`, `hf-head-pendant.svg`).

Categories:
- Tools (one per tool; ~30 icons)
- Node types (head, pipe, valve, fitting; ~12)
- Actions (save, export, print, undo; ~20)
- States (error, warning, success, info; ~8)
- Domain (fire extinguisher, sprinkler, hose; ~10)

## 9. Component primitives

In `packages/ui/src/components/`. React, unstyled Radix
underneath, styled with tokens.

Inventory:
- `<Button variant="primary" | "secondary" | "ghost" | "danger">`
- `<IconButton>` — square, icon-only
- `<Input>` — text + number + dimension variants
- `<Select>` — native + searchable
- `<Combobox>` — searchable + creatable
- `<Checkbox>` / `<RadioGroup>` / `<Switch>`
- `<Slider>` — numeric range
- `<Dialog>` / `<Modal>` — accessible focus-trap
- `<Tooltip>` / `<Popover>`
- `<Menu>` / `<ContextMenu>`
- `<Tabs>` / `<Accordion>`
- `<Table>` — dense + sortable + filterable
- `<Toast>` — error / success / info / warning variants
- `<Progress>` — determinate + indeterminate
- `<Skeleton>` — loading placeholders
- `<Avatar>` — user identity
- `<Badge>` — counts + statuses
- `<Tag>` — removable labels
- `<Keyboard>` — renders a shortcut (Cmd+K)

Every component has:
- Storybook story (`packages/ui/.storybook/`)
- Playwright test (`packages/ui/tests/`)
- Axe a11y assertion

## 10. Layout primitives

```typescript
<Stack direction="row" | "column" gap={4}>
<Grid columns={3} rows="auto" gap={4}>
<Scroll height="full">
<Split direction="horizontal" initialSize="50%">
<Sidebar side="left" | "right" collapsible>
```

Implemented with CSS grid + flex; tokens for gap.

## 11. Viewport chrome

The 3D/2D viewport has its own overlay language:

- Floating panels (LayerPanel bottom-left, LiveCalc bottom-right,
  AutoPilot top-right during pipeline).
- Selection handles: 8×8 px squares, `--hf-accent` fill.
- Hover outline: 2px stroke, `--hf-accent`.
- Coverage circles (heads placement): translucent, dashed.
- Remote area: filled translucent `--hf-accent-muted` with
  solid accent border.
- Cursor hints: subtle text next to cursor, never blocks action.

## 12. Accessibility

- Every interactive element: focus ring = 2px solid
  `--hf-accent`, 2px offset.
- Disabled elements: 50 % opacity + `cursor: not-allowed`.
- Reduced-motion media query: honor `prefers-reduced-motion`;
  disable non-informational animations.
- Minimum click target: 32×32 px (44×44 on touch).

## 13. Tests

- Storybook visual regression via Chromatic (or Percy).
- Axe-core on every component Storybook story.
- Contrast-ratio lint on token values.
- Motion disable-respect test (reduced-motion simulation).

## 14. Open questions

- User-customizable accent color? — per-firm theme override,
  post-1.0.
- Icon vs text in ribbon (some apps icon-only, some text-only,
  AutoSPRINK mixes): default to **icon + label** (small label
  below icon); user toggle to icon-only for dense mode.
- Font subsetting for size — target ≤ 200 KB total font payload.
