// HaloFire CAD — StatusBar. Bottom bar: units, plan scale, zoom, active tool,
// view mode, and the mandatory design-aid disclaimer. The disclaimer is always
// present and never dismissible — this tool is a design aid, not a certified
// engineering deliverable.
//
// SHOWCASE: each stat gets a small lucide icon; the bar is a glass surface. The
// disclaimer TEXT is byte-identical (tests query DESIGN_AID_DISCLAIMER).

import type { CSSProperties, ReactElement } from 'react';
import { TOOLS, useCadStore } from '../store';
import { colors, spacing, typeScale } from '../lib/tokens';
import { glassSurface } from '../lib/glass';
import {
  ChipIcon,
  Crosshair,
  Eye,
  Ruler,
  Scaling,
  TriangleAlert,
  ZoomIn,
  type LucideIcon,
} from '../lib/tool-icons';

/** The hard-coded honesty disclaimer. Always shown. */
export const DESIGN_AID_DISCLAIMER =
  'Design aid — NOT AHJ / PE / code-certified';

export function StatusBar(): ReactElement {
  const project = useCadStore((s) => s.project);
  const viewMode = useCadStore((s) => s.viewMode);
  const activeTool = useCadStore((s) => s.activeTool);

  const toolLabel =
    TOOLS.find((t) => t.id === activeTool)?.label ?? activeTool;
  const scale = project.building.scaleFtPerUnit;

  return (
    <footer style={barStyle} aria-label="Status bar">
      <div style={leftGroupStyle}>
        <Stat icon={Ruler} label="Units" value="ft" />
        <Divider />
        <Stat icon={Scaling} label="Scale" value={`${scale} ft/unit`} />
        <Divider />
        <Stat icon={ZoomIn} label="Zoom" value="100%" />
        <Divider />
        <Stat icon={Crosshair} label="Tool" value={toolLabel} />
        <Divider />
        <Stat icon={Eye} label="View" value={viewMode} />
      </div>

      <div style={disclaimerStyle} role="note">
        <span style={disclaimerDotStyle} aria-hidden="true">
          <ChipIcon icon={TriangleAlert} size={13} />
        </span>
        {DESIGN_AID_DISCLAIMER}
      </div>
    </footer>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}): ReactElement {
  return (
    <span style={statStyle}>
      <span style={statIconStyle} aria-hidden="true">
        <ChipIcon icon={icon} size={12} />
      </span>
      <span style={statLabelStyle}>{label}</span>
      <span style={statValueStyle}>{value}</span>
    </span>
  );
}

function Divider(): ReactElement {
  return <span style={vDividerStyle} aria-hidden="true" />;
}

/* --------------------------------------------------------------- styles */

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing[4],
  ...glassSurface(colors.surface),
  borderTop: `1px solid ${colors.border}`,
  padding: `${spacing[1]} ${spacing[4]}`,
  flex: '0 0 auto',
  minHeight: 30,
  position: 'relative',
  zIndex: 1,
};

const leftGroupStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[3],
};

const statStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: spacing[1],
};

const statIconStyle: CSSProperties = {
  display: 'inline-flex',
  color: colors.textMuted,
};

const statLabelStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const statValueStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
};

const vDividerStyle: CSSProperties = {
  width: 1,
  height: 14,
  background: colors.border,
};

const disclaimerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: spacing[1],
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
};

const disclaimerDotStyle: CSSProperties = {
  display: 'inline-flex',
  color: colors.accent,
};
