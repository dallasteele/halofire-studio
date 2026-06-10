// HaloFire CAD — TopRibbon. The application title bar + tab strip + the active
// tab's tool buttons + the Plan/3D/Split view segmented control. Tabs are
// visual (File/Edit/View/Plan/Layout/Pipe/Hydraulics); the Edit/Plan/Layout/Pipe
// tabs surface the real tool buttons from the store's TOOLS catalog and wire
// each to setTool. Tools whose editing logic is unimplemented are honest — they
// set the active tool and the canvas shows its empty state.
//
// SHOWCASE: Apple-glass chrome (translucent layered ribbon, blur, inner-light
// edges) + lucide icons on every tool/file/view control, with the Halo Fire
// ember-amber accent glowing on active states. All visible labels and aria
// attributes are unchanged — the tests' query surface is identical.

import { useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { deserializeProject, serializeProject } from '../lib/project-io';
import {
  TOOLS,
  VIEW_MODES,
  useCadStore,
  type ToolDef,
  type ToolId,
  type ViewMode,
} from '../store';
import { colors, radii, spacing, typeScale } from '../lib/tokens';
import { accentGlow, glassEdge, glassSheen, glassSurface, hoverLift } from '../lib/glass';
import {
  ChipIcon,
  FolderOpen,
  History,
  Redo2,
  Save,
  Sparkles,
  TAB_ICONS,
  TOOL_ICONS,
  Undo2,
  VIEW_ICONS,
} from '../lib/tool-icons';
import { HydraulicsPanel } from './HydraulicsPanel';
import { BidPanel } from './BidPanel';

const TABS = [
  'File',
  'Edit',
  'View',
  'Plan',
  'Draw',
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
  Draw: ['draw'],
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
            const TabIcon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-pressed={active}
                style={tabStyle(active)}
              >
                {TabIcon && <ChipIcon icon={TabIcon} size={14} />}
                {tab}
              </button>
            );
          })}
        </nav>

        <UndoRedoControl />
        <ViewSegmentedControl viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Tool buttons for the active tab */}
      {activeTab === 'File' ? (
        <div style={toolRowStyle} aria-label="File tools">
          <FileTabTools />
        </div>
      ) : activeTab === 'Hydraulics' ? (
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

/**
 * File-tab tools. The "Load sample project" CTA drives the WHOLE vertical from a
 * fresh page (heads -> pipe -> hydraulics -> bid) using CLEARLY-LABELLED example
 * data, so a new operator can try the flow before importing a real plan.
 */
export const AUTOSAVE_KEY = 'hfcad-autosave';

function FileTabTools(): ReactElement {
  const loadSampleProject = useCadStore((s) => s.loadSampleProject);
  const project = useCadStore((s) => s.project);
  const setProject = useCadStore((s) => s.setProject);
  const openRef = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const hasAutosave =
    typeof localStorage !== 'undefined' && localStorage.getItem(AUTOSAVE_KEY) !== null;

  function onSave(): void {
    const text = serializeProject(project);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'project'}.hfcad`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Saved (.hfcad downloaded)');
  }

  async function onOpen(file: File | null): Promise<void> {
    if (!file) return;
    const out = deserializeProject(await file.text());
    if (out.ok) {
      setProject(out.project);
      setMsg(`Opened ${file.name}${out.savedAt ? ` (saved ${out.savedAt})` : ''}`);
    } else {
      setMsg(`Open failed: ${out.reason}`);
    }
  }

  function onRestoreAutosave(): void {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return setMsg('No autosave found');
    const out = deserializeProject(text);
    if (out.ok) {
      setProject(out.project);
      setMsg(`Autosave restored${out.savedAt ? ` (from ${out.savedAt})` : ''}`);
    } else {
      setMsg(`Autosave unreadable: ${out.reason}`);
    }
  }

  return (
    <div style={fileToolsWrapStyle}>
      <input
        ref={openRef}
        type="file"
        accept=".hfcad,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onOpen(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <FileChip
        onClick={onSave}
        icon={<ChipIcon icon={Save} />}
        dataAttr="data-cad-save"
        title="Download the current project as a .hfcad file"
      >
        Save
      </FileChip>
      <FileChip
        onClick={() => openRef.current?.click()}
        icon={<ChipIcon icon={FolderOpen} />}
        dataAttr="data-cad-open"
        title="Open a .hfcad project file"
      >
        Open…
      </FileChip>
      {hasAutosave && (
        <FileChip
          onClick={onRestoreAutosave}
          icon={<ChipIcon icon={History} />}
          dataAttr="data-cad-restore"
          title="Restore the most recent in-browser autosave"
        >
          Restore autosave
        </FileChip>
      )}
      <FileChip
        onClick={() => {
          void loadSampleProject();
        }}
        icon={<ChipIcon icon={Sparkles} />}
        title="Load CLEARLY-LABELLED example data (not your plan, not a real building)."
      >
        Load sample project
      </FileChip>
      <span style={fileToolsNoteStyle}>
        {msg ?? 'Autosave runs every few seconds in this browser; Save downloads a portable .hfcad.'}
      </span>
    </div>
  );
}

/** Filled (interactive-blue) file-action chip with an icon + hover lift. */
function FileChip({
  onClick,
  icon,
  title,
  dataAttr,
  children,
}: {
  onClick: () => void;
  icon: ReactElement;
  title: string;
  dataAttr?: string;
  children: string;
}): ReactElement {
  const [hover, setHover] = useState(false);
  const data: Record<string, string> = dataAttr ? { [dataAttr]: 'true' } : {};
  return (
    <button
      type="button"
      style={fileChipStyle(hover)}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      {...data}
    >
      {icon}
      {children}
    </button>
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
      <ChipIcon icon={TOOL_ICONS[tool.id]} />
      {tool.label}
    </button>
  );
}

/**
 * E0 Undo/Redo control. Reactive: subscribes to the history stacks so the buttons
 * enable/disable as edits are made/undone. Buttons mirror the Ctrl+Z / Ctrl+Y
 * keyboard shortcuts wired in App.
 */
function UndoRedoControl(): ReactElement {
  const history = useCadStore((s) => s.history);
  const undo = useCadStore((s) => s.undo);
  const redo = useCadStore((s) => s.redo);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  return (
    <div style={undoWrapStyle} role="group" aria-label="Undo and redo">
      <button
        type="button"
        onClick={() => undo()}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        style={undoBtnStyle(canUndo)}
        data-cad-undo
      >
        <ChipIcon icon={Undo2} size={14} />
        Undo
      </button>
      <button
        type="button"
        onClick={() => redo()}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        style={undoBtnStyle(canRedo)}
        data-cad-redo
      >
        <ChipIcon icon={Redo2} size={14} />
        Redo
      </button>
    </div>
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
            <ChipIcon icon={VIEW_ICONS[mode]} size={14} />
            {VIEW_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- styles */

const ribbonStyle: CSSProperties = {
  ...glassSurface(colors.ribbon),
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  userSelect: 'none',
  position: 'relative',
  zIndex: 2,
};

const topRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[4],
  padding: `${spacing[2]} ${spacing[4]}`,
  borderBottom: `1px solid ${glassEdge}`,
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
  textShadow: `0 0 12px ${colors.accent}66`,
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
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing[1],
    background: active ? colors.surfaceRaised : 'transparent',
    backgroundImage: active ? glassSheen : undefined,
    color: active ? colors.textPrimary : colors.textSecondary,
    border: `1px solid ${active ? glassEdge : 'transparent'}`,
    boxShadow: active ? `inset 0 -2px 0 ${colors.accent}` : undefined,
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    transition: 'background 140ms, color 140ms, border-color 140ms, box-shadow 140ms',
  };
}

const toolRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  padding: `${spacing[2]} ${spacing[4]}`,
  minHeight: 48,
  flexWrap: 'wrap',
};

const toolEmptyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.sm.size,
  fontStyle: 'italic',
};

const fileToolsWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[3],
  flexWrap: 'wrap',
};

function fileChipStyle(hover: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing[1],
    background: colors.interactiveActive,
    backgroundImage: glassSheen,
    color: '#ffffff',
    border: `1px solid ${colors.interactive}`,
    borderRadius: radii.lg,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 140ms, box-shadow 140ms',
    ...(hover ? hoverLift : null),
  };
}

const fileToolsNoteStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
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
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing[1],
    background: bg,
    backgroundImage: active || hover ? glassSheen : undefined,
    color: active ? '#ffffff' : colors.textPrimary,
    border: `1px solid ${active ? colors.interactive : glassEdge}`,
    borderRadius: radii.lg,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms',
    ...(active
      ? { boxShadow: accentGlow(colors.accent) }
      : hover
        ? hoverLift
        : null),
  };
}

const undoWrapStyle: CSSProperties = {
  display: 'inline-flex',
  gap: spacing[1],
  flex: '0 0 auto',
};

function undoBtnStyle(enabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing[1],
    background: enabled ? colors.surfaceRaised : colors.bgInset,
    backgroundImage: enabled ? glassSheen : undefined,
    color: enabled ? colors.textPrimary : colors.textMuted,
    border: `1px solid ${glassEdge}`,
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[2]}`,
    fontSize: typeScale.sm.size,
    fontWeight: 500,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.65,
    transition: 'background 140ms, color 140ms',
  };
}

const segmentWrapStyle: CSSProperties = {
  display: 'inline-flex',
  background: colors.bgInset,
  border: `1px solid ${glassEdge}`,
  borderRadius: radii.lg,
  padding: spacing.px,
  flex: '0 0 auto',
  boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.35)',
};

function segmentStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing[1],
    background: active ? colors.interactiveActive : 'transparent',
    backgroundImage: active ? glassSheen : undefined,
    color: active ? '#ffffff' : colors.textSecondary,
    border: 'none',
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typeScale.sm.size,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    boxShadow: active ? accentGlow(colors.accent) : undefined,
    transition: 'background 140ms, color 140ms, box-shadow 140ms',
  };
}
