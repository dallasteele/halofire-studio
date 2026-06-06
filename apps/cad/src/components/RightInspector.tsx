// HaloFire CAD — RightInspector. Shows properties for the current selection
// (a node, segment, or room), reading from the shared store. With no selection
// it shows an honest empty state. With a selection but no matching element yet
// (the shell carries no geometry), it states that plainly rather than inventing
// properties.

import type { CSSProperties, ReactElement } from 'react';
import { useCadStore } from '../store';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

interface Row {
  label: string;
  value: string;
}

export function RightInspector(): ReactElement {
  const selection = useCadStore((s) => s.selection);
  const project = useCadStore((s) => s.project);

  const { kind, id } = activeSelection(selection);

  let title = 'Nothing selected';
  let rows: Row[] = [];
  let note: string | null = null;

  if (kind && id) {
    if (kind === 'node') {
      const node = project.network.nodes.find((n) => n.id === id);
      title = node ? `Node · ${node.type}` : 'Node';
      rows = node
        ? [
            { label: 'ID', value: node.id },
            { label: 'Type', value: node.type },
            { label: 'X (ft)', value: node.pos.x.toFixed(2) },
            { label: 'Y (ft)', value: node.pos.y.toFixed(2) },
            { label: 'Z (ft)', value: node.pos.z.toFixed(2) },
            { label: 'SKU', value: node.sku ?? '—' },
          ]
        : [];
      if (!node) note = 'Selected node id is not in the current (empty) network.';
    } else if (kind === 'segment') {
      const seg = project.network.segments.find((s) => s.id === id);
      title = seg ? `Segment · ${seg.role}` : 'Segment';
      rows = seg
        ? [
            { label: 'ID', value: seg.id },
            { label: 'Role', value: seg.role },
            { label: 'Ø (in)', value: String(seg.diameterIn) },
            { label: 'Length (ft)', value: seg.lengthFt.toFixed(2) },
            { label: 'Material', value: seg.material },
          ]
        : [];
      if (!seg) note = 'Selected segment id is not in the current (empty) network.';
    } else {
      const room = project.building.rooms.find((r) => r.id === id);
      title = room ? `Room · ${room.name ?? room.id}` : 'Room';
      rows = room
        ? [
            { label: 'ID', value: room.id },
            { label: 'Hazard', value: room.hazard },
            { label: 'Ceiling (ft)', value: room.ceilingHt.toFixed(1) },
            { label: 'Vertices', value: String(room.polygon.length) },
          ]
        : [];
      if (!room) note = 'Selected room id is not in the current (empty) building.';
    }
  }

  return (
    <aside style={panelStyle} aria-label="Inspector">
      <h2 style={sectionTitleStyle}>Inspector</h2>

      {!kind ? (
        <div style={emptyStyle}>
          <div style={emptyTitleStyle}>Nothing selected</div>
          <p style={emptyBodyStyle}>
            Select a head, pipe, or room to see its properties here.
          </p>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>{title}</div>
          {rows.length > 0 ? (
            <dl style={dlStyle}>
              {rows.map((r) => (
                <div key={r.label} style={rowStyle}>
                  <dt style={dtStyle}>{r.label}</dt>
                  <dd style={ddStyle}>{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p style={emptyBodyStyle}>{note ?? 'No properties.'}</p>
          )}
        </div>
      )}
    </aside>
  );
}

function activeSelection(s: {
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  selectedRoomId: string | null;
}): { kind: 'node' | 'segment' | 'room' | null; id: string | null } {
  if (s.selectedNodeId) return { kind: 'node', id: s.selectedNodeId };
  if (s.selectedSegmentId) return { kind: 'segment', id: s.selectedSegmentId };
  if (s.selectedRoomId) return { kind: 'room', id: s.selectedRoomId };
  return { kind: null, id: null };
}

/* --------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  background: colors.panel,
  borderLeft: `1px solid ${colors.border}`,
  width: 268,
  flex: '0 0 268px',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[3],
  padding: spacing[3],
  minHeight: 0,
  overflowY: 'auto',
};

const sectionTitleStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  fontWeight: 600,
};

const emptyStyle: CSSProperties = {
  background: colors.bgInset,
  border: `1px dashed ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[4],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const emptyTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
};

const emptyBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const cardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const cardTitleStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.base.size,
  fontWeight: 600,
};

const dlStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: spacing[2],
  padding: `${spacing[1]} 0`,
  borderBottom: `1px solid ${colors.border}`,
};

const dtStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

const ddStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
};
