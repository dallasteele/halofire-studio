# Blueprint 08 — UX Shell

**Scope:** Everything outside the viewport canvas — home screen,
splash, new-project wizard, ribbon tabs, panels, properties,
command palette, layers, statusbar, multi-monitor, themes, a11y.

## 1. Application shell layout

```
┌──────────────────────────────────────────────────────────────┐
│ MENU BAR — File / Edit / View / Design / Analyze / Report / Help │
├──────────────────────────────────────────────────────────────┤
│ RIBBON                                                       │
│  [Home] [Design] [Annotate] [Analyze] [Report] [Coord]       │
│  ┌── Design tab ─────────────────────────────────────────┐   │
│  │ [Auto-Design] [Pipe] [Heads] [Valves] [Fittings] [Snap]│   │
│  └────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│ TAB BAR — Project · Bids · Catalog · Revisions               │
├────────┬─────────────────────────────────────────┬───────────┤
│ SIDEBAR│  VIEWPORT                               │ PROPERTIES│
│  Panel │  ┌───────────────┬────────────────────┐ │  Selected │
│        │  │   3D Model    │  2D Floor Plan     │ │  node's   │
│ Proj   │  │               │                    │ │  fields   │
│ Brief  │  │               │                    │ │           │
│        │  └───────────────┴────────────────────┘ │           │
│        │       ↑ Pascal split / stacked views    │           │
│        │                                         │           │
├────────┴─────────────────────────────────────────┴───────────┤
│ STATUSBAR — X,Y,Z · Units · Snaps · Layer visibility · Online│
└──────────────────────────────────────────────────────────────┘
  [Layer Panel, bottom-left]   [Live Calc, bottom-right]
```

## 2. First-launch flow

### 2.1 Splash

- 1.5 s branded image (dark bg, #e8432d logo spark animation).
- Boot tasks behind: catalog.json load, hf-core hydrate, Python
  sidecar handshake.
- Progress line shows "Loading catalog (412 parts)…" / "Warming
  hydraulic engine…" / "Ready".

### 2.2 Home screen (`apps/editor/app/home/page.tsx`)

Shown when no project is open. Four panels:

1. **Recent Projects** — list with thumbnail, name, date,
   status pill (Draft / Submitted / Approved). Click opens.
2. **Quick Start** — buttons: New Bid / Open File /
   Import from AutoSPRINK DWG / Import from IFC.
3. **Templates** — project templates for common job types:
   Commercial Warehouse, Residential Light-Hazard, Parking
   Garage, Hospital, Data Center.
4. **News + updates** — release notes + NFPA code change alerts
   (pulled from the catalog crawler metadata).

### 2.3 New-project wizard

5-step modal:

1. **Basics** — Project name, address, client GC, contract type.
2. **Drawings** — Upload PDF / DWG / IFC or paste a server path.
3. **Hazard** — Pick dominant hazard class with examples
   (LH = offices, OH2 = parking, etc).
4. **Firm + team** — Drafter name, PE name, project manager.
5. **Preview** — Summary of choices + "Create" button.

On create: spawns `.hfproj` directory, starts AutoPilot if
drawings attached, opens the editor.

## 3. Ribbon design

Pure AutoSPRINK parity but modernized. 6 tabs:

### 3.1 Home tab

File / project operations: New / Open / Save / Save As / Export /
Print / Recent. Mirrors the File menu for quick access.

### 3.2 Design tab

Drafting tools:
- **Auto** group: Auto-Design (run pipeline), Auto-Route, Auto-Hangers.
- **Pipe** group: Route, Modify, Resize, Match.
- **Heads** group: Place, Array, Connect, Swap SKU.
- **Valves** group: Place valve (dropdown by kind), Test valve.
- **Fittings** group: Place tee / elbow / cross / reducer / cap.
- **Snaps** group: fly-out with per-snap toggles.

### 3.3 Annotate tab

Dimensions, text, leaders, revision clouds, hatches, legends.

### 3.4 Analyze tab

Hydraulic calc (full / quick), NFPA rule check, seismic brace,
hanger spacing, flow test data entry, pump curve, tank sizing.

### 3.5 Report tab

Stocklist, Hydralist, NFPA 8-report, Proposal, Submittal bundle,
Approve & Submit.

### 3.6 Coord tab

IFC import, Revit link, clash detection, obstruction layer,
reference plans, coordinate with other disciplines.

## 4. Command palette (Cmd-K)

`components/halofire/CommandPalette.tsx` already exists. Command
registry at `apps/editor/lib/commands.ts`:

```typescript
export interface Command {
  id: string                     // 'pipe.resize'
  label: string                  // 'Resize pipe'
  group: string                  // 'Pipe'
  keywords: string[]             // fuzzy-match terms
  shortcut?: string
  enabled?: () => boolean        // context gate
  invoke: () => void | Promise<void>
}
```

Every menu item, ribbon button, tool activator has a registered
Command. Palette shows fuzzy-matched commands + their shortcuts.

## 5. Panels (sidebar tabs)

Left-side collapsible sidebar. Pascal's `SidebarTab` pattern.

Current tabs: **Scene**, **Auto-Design**, **Project**, **Catalog**,
**Manual FP**.

Additions needed:
- **Sheets** — list of SheetNodes; click to switch active sheet.
- **Rule Check** — violations sorted by severity; click to jump.
- **Revisions** — V0 / V1 / R1 list; diff viewer.
- **Comments** — pinned node notes; click to pan-to.
- **Sidecar Log** — pipeline events tail (dev mode).

## 6. Properties panel (right sidebar)

Context-sensitive. `components/halofire/HalofireProperties.tsx`
exists; extend per node type:

- SprinklerHeadNode → SKU, K, orientation, response, temp,
  deflector height, coverage area, system.
- PipeNode → size, schedule, role, length (read), flow (read),
  pressure loss (read), system.
- FittingNode → SKU, kind, size, branch size (reducing), style,
  connected pipes.
- ValveNode → SKU, kind, size, state (open/closed/throttled),
  supervised.
- SystemNode → kind, hazard, supply (static/residual/flow),
  design (density/area/hose), demand (read).

Every field:
- Inline edit (click to edit).
- Dimensional input parser (accepts feet-inches, decimal-feet,
  metric).
- Validation warning adjacent (NFPA rule violated?).

## 7. Layer panel

Already exists (`components/halofire/LayerPanel.tsx`). Extend:

- Per-category visibility: Heads / Pipes / Fittings / Valves /
  Hangers / Devices / Walls / Ceilings / Obstructions /
  Dimensions / Annotations / Arch underlay.
- Per-system visibility (list of SystemNodes).
- Per-level visibility.
- "Solo" mode (alt-click isolates one layer).

## 8. Status bar

Bottom strip, ~24 px tall. Zones:

- Cursor XYZ (live updating).
- Active units + quick-toggle.
- Snap status (which snaps enabled).
- Layer summary (how many hidden).
- Tool status (which tool is active, with shortcut reminder).
- Connection status (online / offline / sidecar alive).
- Autosave indicator (pulse when saving).

## 9. Multi-monitor / pop-out

- Pop-out panels: right-click tab → "Pop out to new window".
  Tauri creates a second Webview with the panel mounted.
- Linked selection: state shared via Tauri event bus. Select in
  2D → highlights in 3D in the main window AND popped-out
  3D window.

## 10. Themes

- **Dark** (default) — `#0a0a0b` bg, `#e8432d` accent, IBM Plex
  Mono body.
- **Light** — reverse, for daylight offices.
- **High contrast** — WCAG AAA palette for accessibility mode.

Tokens in `packages/ui/src/tokens.ts`. Swap via
`document.documentElement.dataset.theme = 'dark' | 'light' | 'hc'`.

## 11. Accessibility

- Every button has aria-label.
- Tab order follows visual flow.
- Every focusable element has a visible focus ring.
- Tool shortcuts announced by screen reader.
- Color never the sole carrier of meaning (icons + text labels).
- 4.5 : 1 min contrast ratio (WCAG AA).

## 12. Error / empty / loading states

### 12.1 Empty

- Blank viewport + call to action: "New project" /
  "Open recent".

### 12.2 Loading

- Skeleton panels while catalog boots.
- Overlaid progress bar when pipeline running.

### 12.3 Error

- Toast (bottom-right) for transient; 6 s auto-dismiss.
- Error modal for recoverable (with suggestion + action).
- Full-page error for fatal (catalog corrupt, schema too new).

All errors go through `components/halofire/error-surface.tsx`
which consumes the error taxonomy (blueprint 02 §4).

## 13. Onboarding

- First-run coach marks on 6 tools (close individually or
  dismiss-all).
- Keyboard overlay on `?` press — floating card of current-tool
  shortcuts.
- Sample 1881 project ships in templates for end-to-end demo.

## 14. Tests

- Playwright: navigation through every ribbon tab, sidebar tab,
  command palette.
- Keyboard-map integration: every shortcut fires.
- Theme swap: verify tokens applied.
- Accessibility: axe-core audit on each major view.

## 15. Open questions

- Ribbon customization? (Drag groups, hide tabs, user-saved
  layouts.) — v1.5.
- Window docking? (Dock Properties panel under Sheets tab.) —
  post-1.0.
