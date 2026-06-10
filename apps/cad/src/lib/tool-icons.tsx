// HaloFire CAD — icon catalog. One lucide icon per ToolDef (plus ribbon-tab,
// file-action, view-mode, and status icons) so the workspace reads like a real
// CAD product instead of text-only buttons. Icons are decorative (aria-hidden):
// every button KEEPS its visible text label and aria attributes — the icons
// never replace the strings the test-suite queries.

import type { ReactElement } from 'react';
import {
  Box,
  BrickWall,
  Circle,
  Columns2,
  Dot,
  Eye,
  FileUp,
  FolderOpen,
  Gauge,
  Hand,
  History,
  Map,
  Minus,
  MousePointer2,
  Receipt,
  RectangleHorizontal,
  Redo2,
  Ruler,
  Save,
  Scaling,
  ShowerHead,
  SlidersHorizontal,
  Sparkles,
  Spline,
  SquareDashed,
  Undo2,
  Waypoints,
  Wrench,
  ZoomIn,
  Crosshair,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ToolDef, ToolId, ViewMode } from '../store';

/** Standard icon sizing for ribbon/tool chips per the showcase design language. */
export const ICON_SIZE = 15;
export const ICON_STROKE = 1.75;

/** One icon per tool in the store catalog. */
export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2,
  pan: Hand,
  measure: Ruler,
  'import-plan': FileUp,
  'set-scale': Scaling,
  wall: BrickWall,
  room: SquareDashed,
  'place-head': ShowerHead,
  'route-pipe': Waypoints,
  'draw-line': Minus,
  'draw-polyline': Spline,
  'draw-circle': Circle,
  'draw-rect': RectangleHorizontal,
  'draw-point': Dot,
};

/** Tool-group icons for the LeftPanel section headers. */
export const GROUP_ICONS: Record<ToolDef['group'], LucideIcon> = {
  edit: MousePointer2,
  plan: FileUp,
  draw: Spline,
  layout: ShowerHead,
  pipe: Waypoints,
};

/** Ribbon-tab icons (only data-bearing tabs get one; plain tabs stay text). */
export const TAB_ICONS: Partial<Record<string, LucideIcon>> = {
  Hydraulics: Gauge,
  Bid: Receipt,
};

/** View-mode segmented control icons. */
export const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  plan: Map,
  '3d': Box,
  split: Columns2,
};

// Named re-exports used by individual components (one import site per app area).
export {
  Eye,
  FolderOpen,
  Gauge,
  History,
  Redo2,
  Ruler,
  Save,
  Scaling,
  ShowerHead,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Wrench,
  ZoomIn,
  Crosshair,
  TriangleAlert,
  FileUp,
  type LucideIcon,
};

/** Render a lucide icon at the standard chip size, decorative-only. */
export function ChipIcon({
  icon: Icon,
  size = ICON_SIZE,
}: {
  icon: LucideIcon;
  size?: number;
}): ReactElement {
  return (
    <Icon
      size={size}
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
      style={{ flex: '0 0 auto', display: 'block' }}
    />
  );
}
