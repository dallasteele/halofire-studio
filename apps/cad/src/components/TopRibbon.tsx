// HaloFire CAD — TopRibbon. The application title bar + tab strip + the active
// tab's tool buttons + the Plan/3D/Split view segmented control. Tabs are
// visual (File/Edit/View/Plan/Layout/Pipe/Hydraulics); the Edit/Plan/Layout/Pipe
// tabs surface the real tool buttons from the store's TOOLS catalog and wire
// each to setTool. Tools whose editing logic is unimplemented are honest — they
// set the active tool and the canvas shows its empty state.

import { useState, type CSSProperties, type ReactElement } from 'react';
import {
  TOOLS,
  VIEW_MODES,
  useCadStore,
  type ToolDef,
  type ToolId,
  type ViewMode,
} from '../store';
import { colors, radii, spacing, typeScale } from '../lib/tokens';
import { HydraulicsPanel } from './HydraulicsPanel';
import { BidPanel } from './BidPanel';

const TABS = [
  'File',
  'Edit',
  'View',
  'Plan',
  'Layout',
  'Pipe',
  'Hydraulics',
  'Bid',
] as const;
type Tab = (typeof TABS)[number];

/** Which tool group(s) a tab surfaces. Tabs not listed show no tool buttons yet. */
const TAB_GROUPS: Partial<Record<Tab, ToolDef['group'][]>> = {
  Edit: ['edit'],
  Plan: ['plan'],
  Layout: ['layout'],
  Pipe: ['pipe'],
};

const VIEW_LABEL: Record<ViewMode, string> = {
  plan: 'Plan',
  '3d': '3D',
  split: 'Split',
};

export function TopRibbon(): ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('Plan');
  const activeTool = useCadStore((s) => s.activeTool);
  const setTool = useCadStore((s) => s.setTool);
  const viewMode = useCadStore((s) => s.viewMode);
  const setViewMode = useCadStore((s) => s.setViewMode);

  const groups = TAB_GROUPS[activeTab] ?? [];
  const tabTools = TOOLS.filter((t) => groups.includes(t.group));

  return (
    <header style={ribbonStyle}>
      {/* Brand + tab strip row */}
      <div style={topRowStyle}>
        <div style={brandStyle}>
          <span style={brandMarkStyle} aria-hidden="true">
            ◭
          </span>
          <span style={brandTitleStyle}>HaloFire CAD</span>
          <span style={brandSubStyle}>Sprinkler Workspace</span>
        </div>

        <nav style={tabStripStyle} aria-label="Ribbon tabs">
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-pressed={active}
                style={tabStyle(active)}
              >
                {tab}
              </button>
            );
          })}
        </nav>

        <ViewSegmentedControl viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Tool buttons for the active tab */}
      {activeTab === 'Hydraulics' ? (
        <div style={hydraulicsWrapStyle} aria-label="Hydraulics tools">
          <HydraulicsPanel />
        </div>
      ) : activeTab === 'Bid' ? (
        <div style={hydraulicsWrapStyle} aria-label="Bid tools">
          <BidPanel />
        </div>
      ) : (
        <div style={toolRowStyle} aria-label={`${activeTab} tools`}>
          {tabTools.length === 0 ? (
            <span style={toolEmptyStyle}>{`No ${activeTab} tools in this slice.`}</span>
          ) : (
            tabTools.map((tool) => (
              <ToolButton
                key={tool.id}
                tool={tool}
                active={tool.id === activeTool}
                onSelect={setTool}
              />
            ))
          )}
        </div>
      )}
    </header>
  );
}

function ToolButton({
  tool,
  active,
  onSelect,
}: {
  tool: ToolDef;
  active: boolean;
  onSelect: (id: ToolId) => void;
}): ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={active}
      title={tool.hint}
      style={toolButtonStyle(active, hover)}
    >
      {tool.label}
    </button>
  );
}

function ViewSegmentedControl({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
}): ReactElement {
  return (
    <div style={segmentWrapStyle} role="group" aria-label="View mode">
      {VIEW_MODES.map((mode) => {
        const active = mode === viewMode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-pressed={active}
            style={segmentStyle(active)}
          >
            {VIEW_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- styles */

const ribbonStyle: CSSProperties = {
  background: colors.ribbon,
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  userSelect: 'none',
};

const topRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[4],
  padding: `${spacing[2]} ${spacing[4]}`,
  borderBottom: `1px solid ${colors.border}`,
};

const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: spacing[2],
  flex: '0 0 auto',
};

const brandMarkStyle: CSSProperties = {
  color: colors.accent,
  fontSize: typeScale.lg.size,
  lineHeight: 1,
  transform: 'translateY(2px)',
};

const brandTitleStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.lg.size,
  fontWeight: typeScale.lg.weight,
  letterSpacing: '-0.01em',
};

const brandSubStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const tabStripStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[1],
  flex: '1 1 auto',
  justifyContent: 'center',
};

function tabStyle(active: boolean): CSSProperties {
  return {
    background: active ? colors.surfaceRaised : 'transparent',
    color: active ? colors.textPrimary : colors.textSecondary,
    border: `1px solid ${active ? colors.borderStrong : 'transparent'}`,
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: active ? 600 : 500,
    transition: 'background 140ms, color 140ms, border-color 140ms',
  };
}

const toolRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  padding: `${spacing[2]} ${spacing[4]}`,
  minHeight: 44,
  flexWrap: 'wrap',
};

const toolEmptyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.sm.size,
  fontStyle: 'italic',
};

/** The Hydraulics tab expands into a scrollable panel (supply inputs + results). */
const hydraulicsWrapStyle: CSSProperties = {
  maxHeight: '48vh',
  overflowY: 'auto',
  borderTop: `1px solid ${colors.border}`,
  background: colors.surface,
};

function toolButtonStyle(active: boolean, hover: boolean): CSSProperties {
  const bg = active
    ? colors.interactiveActive
    : hover
      ? colors.surfaceHover
      : colors.surfaceRaised;
  return {
    background: bg,
    color: active ? '#ffffff' : colors.textPrimary,
    border: `1px solid ${active ? colors.interactive : colors.border}`,
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: 500,
    transition: 'background 140ms, border-color 140ms',
  };
}

const segmentWrapStyle: CSSProperties = {
  display: 'inline-flex',
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing.px,
  flex: '0 0 auto',
};

function segmentStyle(active: boolean): CSSProperties {
  return {
    background: active ? colors.interactiveActive : 'transparent',
    color: active ? '#ffffff' : colors.textSecondary,
    border: 'none',
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: active ? 600 : 500,
    transition: 'background 140ms, color 140ms',
  };
}
