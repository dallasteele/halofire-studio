// HaloFire CAD — RightInspector. Shows properties for the current selection
// (a node, segment, or room), reading from the shared store. With no selection
// it shows an honest empty state. With a selection but no matching element yet
// (the shell carries no geometry), it states that plainly rather than inventing
// properties.

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { useCadStore } from '../store';
import { coverageReport, type CoverageFinding } from '../lib/head-layout';
import {
  findHeadBySku,
  loadManufacturerCatalog,
  type CatalogPart,
} from '../lib/head-catalog';
import type { Point2, Point3, Room } from '../lib/model';
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
  let headExtra: ReactElement | null = null;

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
      if (node?.type === 'HEAD') {
        headExtra = <HeadDetail pos={node.pos} sku={node.sku} project={project} />;
      }
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
          {headExtra}
        </div>
      )}
    </aside>
  );
}

/**
 * Head-specific inspector block: resolves the real catalog SKU (model + K-factor)
 * and shows the CITED coverage finding for the room that contains this head.
 *
 * HONESTY: the K-factor is the real catalog value (or "—" when the sheet had none).
 * Coverage findings carry their verbatim NFPA-13 citation and say "verify adopted
 * edition" — a design aid, NOT a certified calculation.
 */
function HeadDetail({
  pos,
  sku,
  project,
}: {
  pos: Point3;
  sku: string | undefined;
  project: ReturnType<typeof useCadStore.getState>['project'];
}): ReactElement {
  const [part, setPart] = useState<CatalogPart | null>(null);

  useEffect(() => {
    if (!sku) {
      setPart(null);
      return;
    }
    let alive = true;
    const fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    void loadManufacturerCatalog(fetchImpl).then((cat) => {
      if (alive) setPart(findHeadBySku(cat, sku));
    });
    return () => {
      alive = false;
    };
  }, [sku]);

  // Find the room that contains this head (in feet) and report its cited coverage.
  const scale =
    project.building.scaleFtPerUnit > 0 ? project.building.scaleFtPerUnit : 1;
  const headFt: Point2 = { x: pos.x, y: pos.z };
  const room = project.building.rooms.find((r: Room) => {
    const polyFt = r.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    return polyFt.length >= 3 && pointInPolygonFt(headFt, polyFt);
  });

  let finding: CoverageFinding | null = null;
  let covered: boolean | null = null;
  if (room) {
    const polyFt = room.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const inRoom = project.network.nodes
      .filter((n) => n.type === 'HEAD')
      .map((n) => ({ x: n.pos.x, y: n.pos.z }))
      .filter((h) => pointInPolygonFt(h, polyFt));
    const rep = coverageReport(polyFt, inRoom, room.hazard);
    covered = rep.covered;
    finding = rep.findings.find((f) => !f.ok) ?? rep.findings[0] ?? null;
  }

  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>Sprinkler head</div>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        <div style={rowStyle}>
          <dt style={dtStyle}>Model</dt>
          <dd style={ddStyle}>{part?.model ?? sku ?? '—'}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>K-factor</dt>
          <dd style={ddStyle}>{part?.kFactor ?? '—'}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Mfr</dt>
          <dd style={ddStyle}>{part?.mfr ?? '—'}</dd>
        </div>
      </dl>
      {room ? (
        <div
          style={{
            ...coverageNoteStyle,
            color: covered ? colors.accentText : colors.danger,
            borderColor: covered ? colors.border : colors.danger,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            Room {room.name ?? room.id} ({room.hazard}):{' '}
            {covered ? 'coverage OK' : 'coverage FAIL'}
          </div>
          {finding && <div>{finding.message}</div>}
          {finding && <div style={citationStyle}>{finding.citation}</div>}
        </div>
      ) : (
        <p style={emptyBodyStyle}>
          This head is not inside any classified room — coverage not evaluated.
        </p>
      )}
    </div>
  );
}

/** Ray-cast point-in-polygon for feet-space points. */
function pointInPolygonFt(pt: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
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

const headBlockStyle: CSSProperties = {
  marginTop: spacing[2],
  paddingTop: spacing[2],
  borderTop: `1px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const headBlockTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  fontWeight: 600,
};

const coverageNoteStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const citationStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};
