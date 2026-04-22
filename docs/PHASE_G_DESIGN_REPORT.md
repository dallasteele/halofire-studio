# Phase G — HaloFire Studio Design Report

Date: 2026-04-22
Branch: `claude/hal-makeover`
Scope: `apps/editor/**` styling layer (CSS, Tailwind, layout, typography,
tokens). Business logic untouched.

## Manifesto

HaloFire Studio is a fire-protection estimator's tool. People stake
their licenses on what it produces, and they bid six-figure jobs in it.
Every prior iteration called for "zero border-radius, IBM Plex Mono,
dark background" — bland direction, and no agent ever committed to a
real visual language. The result was generic dashboard dark-mode with
an orange button. Phase G commits: **engineer's drafting room meets
NASA mission console**. Warm-neutral paper-dark surfaces with a faint
grain, drafting hairlines and rule-tick bottom edges, Fraunces for
hero numeric data, IBM Plex Mono for chrome, JetBrains Mono for SKUs
and coordinates, a surgical `#e8432d` reserved for the active tool
indicator and a single primary CTA per screen, and earthen
within-spec / caution / violation data colors (`#6b8e3a` moss,
`#c89a3c` gold, `#9a3c3c` brick). No neon, no gradients-on-white, no
skeleton loaders, no red-alarm error bands — empty states speak in
prose.

## Type + color system

### Fonts (registered in `app/layout.tsx`)

| Role            | Family                | Use                                   |
| --------------- | --------------------- | ------------------------------------- |
| Display         | **Fraunces** (var)    | Bid total, pressure readout, section headings (`$538,792`, `55.0 psi`, "Auto-Design") |
| Body + chrome   | **IBM Plex Mono**     | Labels, buttons, ribbon tabs, prose   |
| Numeric figures | **JetBrains Mono**    | SKUs, coordinates, BOM rows, clock, dims |
| Legacy          | Barlow / Geist        | Preserved for Pascal-owned components |

Fraunces ships with `SOFT`, `WONK`, `opsz` axes — `SOFT 30`, `opsz 144`
used throughout to stay warm without feeling decorative.

### Colors (CSS custom properties in `app/globals.css`)

```
--color-hf-bg:         #0d0c0a   /* warm paper-dark, NOT #0a0a0b sterile */
--color-hf-surface:    #141210
--color-hf-surface-2:  #1b1815
--color-hf-edge:       rgba(255,255,255,0.06)
--color-hf-ink:        #f2ece0   /* warm paper-white */
--color-hf-ink-mute:   #a8a095
--color-hf-ink-dim:    #6b655c
--color-hf-ink-deep:   #413c36
--color-hf-accent:     #e8432d   /* surgical, one per screen */
--color-hf-accent-hot: #ff5533   /* live-pulse only */
--color-hf-gold:       #c89a3c   /* informational / caution */
--color-hf-moss:       #6b8e3a   /* within-spec */
--color-hf-brick:      #9a3c3c   /* critical violation */
```

A 3-4% SVG fractal-noise grain is painted on `body::before` at
`mix-blend-mode: overlay` — gives the shell the "drafting paper turned
dark" warmth without obstructing the 3D viewport (which owns its own
canvas).

Two utility classes do most of the work:

- `.hf-label` — 9px Plex small-caps, 0.22em tracking, muted ink. Every
  section header, every engineering-unit annotation (`PSI`, `GPM`,
  `cm`, `ms`).
- `.hf-num` — JetBrains Mono with `font-variant-numeric: tabular-nums`
  so figures don't shimmy when the solver updates.
- `.hf-hero` — Fraunces 500 weight at variable `opsz 144`, tight
  tracking, half line-height for the bid total and the pressure
  headline.

Drafting-specific extras: `.hf-rule-bottom` draws a 2px tick-mark
bottom edge mimicking an engineering drawing frame; `.hf-grid-overlay`
paints a 40px/160px red-orange-and-white grid behind the viewport at
3–4% opacity (reads only when the 3D scene is empty).

## Component-by-component changes

### `app/globals.css`
Replaced the shadcn `oklch` palette with explicit HaloFire hex
tokens, wired Fraunces/Plex/JetBrains into `@theme`, added drafting
utilities (`hf-label`, `hf-num`, `hf-hero`, `hf-rule-bottom`,
`hf-grid-overlay`, `hf-btn`, `hf-tab`, `hf-card`, `hf-pulse`,
`hf-pulse-hot`, `hf-scroll`, `hf-ring-select`) and the global grain
overlay. Pascal loaders preserved untouched — they're API for the
editor package.

### `app/layout.tsx`
Dropped the Barlow-only font setup in favour of a parallel mount of
three voices (Fraunces / Plex Mono / JetBrains Mono) registered as
CSS variables, forced the `dark` class on `<html>` so HaloFire is
never light-flash on cold boot, and set the body background + ink to
the new tokens.

### `components/halofire/Ribbon.tsx`
Full rewrite of the top band. Introduces:

- Wordmark: Fraunces italic "Halo Fire" with a pulsing `#e8432d`
  period-dot, followed by small-caps "Studio".
- 4 tabs (`DESIGN · ANNOTATE · ANALYZE · REPORT`) rendered as
  underline-only chrome via the new `.hf-tab` primitive; no fill, no
  bg pill. Active tab gets an `.hf-tab[data-active]` 2px accent line.
- **Three responsive tiers** (`useTier()` hook):
  - ≥1440 full labels
  - 1024–1439 abbreviations (Sprk/Pipe/Fit/Hang/Sway/Meas/Sect/Snap…)
  - <1024 icon-only with `title` tooltips
- Inline-SVG glyph set (25 shapes, 1.5 stroke weight) — CAD-style,
  consistent line density, zero icon-font dependency.
- Group labels moved to the right edge of each group as small-caps
  tags (was a duplicated "AUTO" chip with dead weight).
- File shortcuts (New/Load/Save) rebuilt as 28×28 square icon
  buttons in the top strip, hover reveals accent border.
- Drafting tick-mark bottom edge via `.hf-rule-bottom`.

### `components/halofire/StatusBar.tsx`
Now exactly **28px** (`style={{ height: 28 }}`) — no padding tricks.
Reads like a CAD command line: Plex small-caps labels (`GATEWAY`,
`JOB`, `NODES`, `P-RES`, `FLOW`, `UNITS`, `GRID`, `SNAP`) paired with
JetBrains tabular numerals. Moss/gold/brick dots replace the
dashboard-green and fire-truck-red. Tick separators (`|`) between
groups mimic the segment dividers on engineering title blocks. Margin
violations get an `.hf-pulse-hot` dot, never a full-width banner.

### `components/halofire/ProjectContextHeader.tsx`
The hero block at the top of every sidebar panel. Three zones:

1. Label row — a Fraunces-italic "hf" monogram in an accent-bordered
   square, small-caps "Active bid" and the project id.
2. Project line — project name in 13px medium ink, address in 10px
   dim.
3. **Bid hero** — `$538,792` rendered in Fraunces at 34px accent red.
   Thin accent rule underlines it; "BID TOTAL" in small-caps.
4. **Calm gateway chip** — moss/gold/brick 2×2 dot, lowercase status,
   "7 tools" readout when online. The prior red error band is gone
   entirely; when offline the chip shows a dotted-underline "help"
   link that reveals an opt-in code block. Empty states speak in
   prose.

### `components/halofire/LayerPanel.tsx`
Kept the same behavior (toggle / solo / all-none / hotkeys /
persisted collapse) but reframed the surface:
- Top edge now carries a 1px accent rule (inset box-shadow) — signals
  "active tool surface" without adding chrome.
- Hairline hairline-rule borders replace the previous `white/10`
  outlines so the panel harmonizes with the warm-neutral palette.
- Active layer dots use `#e8432d` with a 6px accent glow instead of
  the old hard shadow.
- Hotkey caps get `.hf-num` treatment so they always tabular-align.
- `text-neutral-500` preserved on dimmed rows (required by
  `LayerPanel.test.tsx`).

### `components/halofire/LiveCalc.tsx`
The single most important numerical readout in the product gets a
proper hero:
- **Residual pressure** as 46px Fraunces at the top of the panel,
  unit "psi" in Plex small-caps beside it. This is the number the
  estimator stares at — it should feel loud.
- Flow chip on a single line below in Plex small-caps + JetBrains
  numeric.
- Supporting metrics (static, base demand, margin, velocity, bid, Δ
  bid, heads, Δ heads) in a compact 2-column grid under a hairline.
- Tone dot top-right reflects the margin state (moss / gold / brick).
- Calculating pulse is the gold hot-pulse dot, never a yellow
  `animate-pulse` text block.
- Retry button rebuilt on the new `hf-btn-accent` primitive.

### `components/halofire/CatalogPanel.tsx`
- Section header switches to Fraunces "Components" / small-caps
  "Library".
- Rows get left-border accent strips on hover + active state,
  replacing the blue-fill selected state.
- Each row now has a 24×24 glyph square (gives a visual rhythm even
  before GLB thumbnails ship).
- `K=`, pipe size, and `cm` dims rendered via `.hf-num` + `.hf-label`
  to get drafting-drawing mimicry.
- Parts Catalog (HfCatalogBrowser) filter pills rebuilt as
  square-cornered accent-bordered chips; manufacturer chip picks up
  the gold palette for informational tone.
- SelectedDetail card carries a top accent rule and hero Fraunces
  title; spec table uses `DtDd` small-caps label + paper-ink value.
- PlaceButton input grid gets Plex small-caps axis labels, JetBrains
  numeric inputs, accent-bordered primary action.

### `components/halofire/ReportTab.tsx`
Full rewrite. Deliverables now read as a **submittal ledger** — the
piece of paper every AHJ approval hinges on:
- Hairline-divided rows numbered `01…10` in JetBrains.
- A `KindBadge` pill per row: PDFs brick, CSV/XLSX moss, GLB accent,
  DXF/IFC gold, JSON muted. Earthen, legible, never dashboard.
- "DOWNLOAD" CTA in the reserved accent.
- Empty state is prose in Fraunces ("Nothing to deliver yet.") plus a
  sentence explaining how to trigger the pipeline. No stack trace, no
  red banner.

### `components/halofire/AutoDesignPanel.tsx`
The primary user-facing entry point in the whole app:
- Small-caps "PRIMARY ACTION" crumb + Fraunces 26px "Auto-Design"
  title + prose paragraph describing what the pipeline actually does.
- Preset select and file picker adopt the square-cornered, warm-edge
  style.
- "Run Auto-Design" CTA is the one primary accent-filled button on
  the screen — border, gradient fill, uppercase Plex tracking.
- "Render last" and "Clear scene" collapse to a 2-column secondary
  row so they never compete with the primary.
- Error state becomes a calm left-accented brick strip with a
  small-caps label and Plex prose — no red alarm.
- Job status pill uses the tone dots + earthen background chips.
- Completed deliverables render as accent-bordered ledger rows; the
  "Open bid viewer" CTA is the lone accent-filled action.

### `app/page.tsx`
Single change: wrap the Pascal `<Editor>` container with
`.hf-grid-overlay` so the drafting grid reads behind the viewport.
No business logic touched.

## Layout + responsive rules

- Ribbon never horizontally overflows at ≥1024px — verified at 1280,
  1440, 1920 (screenshots below). Below 1024px the CAD group folds to
  icon-only; everything else keeps labels.
- StatusBar height is fixed at 28px; overflow is handled by
  truncation on the job-name field only.
- Sidebar panels use `.hf-scroll` for custom scrollbars (hover:
  accent).
- Drafting grid overlay sits behind Pascal's sidebars + viewport at
  ~3% opacity — reads on empty canvas, invisible when a 3D scene is
  loaded.

## Decisions made unilaterally

- **Brand dot is `#e8432d`**, not `#ff3333`. The brief left both in
  scope; `#e8432d` is warmer and reads at all sizes without going
  fluorescent. `#ff5533` stays for the 1-of-100 live-pulse moment.
- **Background `#0d0c0a`** instead of `#0a0a0b`. The warmer tone
  pairs with Fraunces/Plex and the gold/moss/brick data palette;
  a cooler `#0a0a0b` would clash.
- **Pascal's sidebar tab row is out of scope.** The visible tab chrome
  (Scene / Auto-Design / Project / Catalog / Manual FP / Report) is
  owned by `@pascal-app/editor`. On viewports narrower than
  ~1280 × 800 those tabs wrap, which is Pascal's decision and a
  separate fix. HaloFire's own Ribbon/StatusBar/LiveCalc/LayerPanel/
  ProjectContextHeader all respect the responsive contract.
- **No red alarm band for gateway offline.** The prior UX treated a
  missing backend like an incident. The redesigned chip treats it like
  a status — dot turns brick, small "help" link opens the opt-in
  explainer; nothing dominates the surface.
- **Fraunces over Playfair Display.** The brief listed Fraunces
  explicitly; it's warmer and has `SOFT`/`WONK` variable axes that
  give the product a distinctive fingerprint.
- **Bid total stays in accent red.** The single loudest thing a fire
  estimator does is commit to a number. Keeping the bid total in the
  surgical accent honors that — and because nothing else on the
  screen uses the accent at 34px, there's no color collision.

## Verification

- `bun test apps/editor/components/halofire/__tests__/` → **77 / 77
  pass** (Ribbon, LayerPanel, LiveCalc, NodeTags, PhaseF, Ribbon,
  SystemOptimizer, ToolOverlay, Tools, CommandPalette, RemoteAreaDraw,
  useLiveHydraulics).
- `tsc --noEmit` against my touched files → zero new errors.
  Pre-existing errors in Pascal packages and `bun:test` type
  resolution are unchanged.
- Dev server at `http://localhost:3002` returns HTTP 200 with all
  expected SSR markers (`halofire-ribbon`, `halofire-status-bar`,
  `Halo Fire`, `Auto-Design`).

## Screenshots

Generated by `apps/editor/scripts/phase-g-screenshots.mjs` against the
live `npm run start:dev` stack. Raw PNGs live in
`apps/editor/docs/phase-g-shots/`:

- `1280x800.png` / `-auto.png` / `-report.png` / `-catalog.png`
- `1440x900.png` / `-auto.png` / `-report.png` / `-catalog.png`
- `1920x1080.png` / `-auto.png` / `-report.png` / `-catalog.png`

Key confirmations from those captures:

- **1280×800** — the pre-redesign "broken UI" breakpoint. Ribbon
  tabs + tools fit in the toolbar (CAD group goes icon-only below
  1024). LiveCalc hero visible bottom-right. Bid total visible
  top-left of sidebar.
- **1440×900** — abbreviated labels, every group fits cleanly.
  Auto-Design hero ("$538,792" + Fraunces "Auto-Design" + prose)
  reads as the single dominant element on screen.
- **1920×1080** — full labels, drafting grid reads behind viewport,
  Report "Submittal ledger" renders as numbered rows with earthen
  kind-badges.
