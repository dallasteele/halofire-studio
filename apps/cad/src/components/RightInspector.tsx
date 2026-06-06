// HaloFire CAD — RightInspector. Shows properties for the current selection
// (a node, segment, or room), reading from the shared store. With no selection
// it shows an honest empty state. With a selection but no matching element yet
// (the shell carries no geometry), it states that plainly rather than inventing
// properties.

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { selectHydraulics, useCadStore } from '../store';
import { coverageReport, type CoverageFinding } from '../lib/head-layout';
import {
  findHeadBySku,
  loadManufacturerCatalog,
  type CatalogPart,
} from '../lib/head-catalog';
import type { Node, Point2, Point3, Room, Segment } from '../lib/model';
import { arePortsCompatible } from '../lib/connectivity';
import { resolvePartModel, type ResolvedPartModel } from '../lib/part-geometry';
import { loadBuild123dManifest, type Build123dManifest } from '../../../studio/src/lib/build123d-parts';
import {
  loadManufacturerStepManifest,
  type ManufacturerStepManifest,
} from '../../../studio/src/lib/manufacturer-step';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

/** Human label per provenance tier (W8) — never claims more than the tier earns. */
const TIER_LABEL: Record<string, string> = {
  manufacturer_verified: 'Manufacturer-verified (real manufacturer CAD)',
  dimensioned_parametric: 'Dimensioned parametric — NOT manufacturer-exact',
  proxy: 'Proxy — approximate placeholder',
  visual_reference: 'Visual reference — not dimensional',
};

/**
 * Load the geometry manifests once for the Inspector (fail-soft to empty). Lets the
 * selected-part provenance block resolve the SAME model the 3D viewer draws.
 */
function useGeometryManifests(): {
  build123d: Build123dManifest | null;
  manufacturerStep: ManufacturerStepManifest | null;
} {
  const [m, setM] = useState<{
    build123d: Build123dManifest | null;
    manufacturerStep: ManufacturerStepManifest | null;
  }>({ build123d: null, manufacturerStep: null });
  useEffect(() => {
    let alive = true;
    const fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    void Promise.all([
      loadBuild123dManifest(fetchImpl),
      loadManufacturerStepManifest(fetchImpl),
    ]).then(([build123d, manufacturerStep]) => {
      if (alive) setM({ build123d, manufacturerStep });
    });
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

/**
 * W8 model-provenance block: shows the REAL CAD model source + tier for a selected
 * part (the same resolvePartModel the 3D viewer uses), or an honest "no resolvable
 * model — drawn as a proxy" note. Never claims manufacturer-exact for a build123d body.
 */
function ModelProvenance({ model }: { model: ResolvedPartModel | null }): ReactElement {
  if (!model) {
    return (
      <div style={headBlockStyle}>
        <div style={headBlockTitleStyle}>3D model</div>
        <p style={emptyBodyStyle}>
          No real CAD model resolved for this part — drawn as a clearly-flagged amber
          proxy in 3D. Not real geometry.
        </p>
      </div>
    );
  }
  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>3D model (W8 real CAD)</div>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        <div style={rowStyle}>
          <dt style={dtStyle}>Source</dt>
          <dd style={ddStyle}>{model.source}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Key</dt>
          <dd style={ddStyle}>{model.build123dKey}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Tier</dt>
          <dd style={ddStyle}>{model.provenanceTier}</dd>
        </div>
      </dl>
      <div style={citationStyle}>
        {TIER_LABEL[model.provenanceTier] ?? model.provenanceTier}.{' '}
        {model.engineeringAccurate
          ? 'Manufacturer CAD geometry.'
          : 'Real dimensioned parametric geometry — NOT manufacturer-exact, NOT AHJ / PE / code-certified.'}
      </div>
    </div>
  );
}

interface Row {
  label: string;
  value: string;
}

export function RightInspector(): ReactElement {
  const selection = useCadStore((s) => s.selection);
  const project = useCadStore((s) => s.project);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);
  const manifests = useGeometryManifests();

  const { kind, id } = activeSelection(selection);

  // W5: live hydraulics for the selected segment (friction/velocity) and node
  // (pressure/flow). Recomputed when the network / supply / design area change.
  const hydraulics = useMemo(
    () => selectHydraulics(useCadStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.network, supply, designAreaSqFt, project.hazardDefaults.defaultClass],
  );

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
      const nodeHyd = node ? hydraulics.perNode.find((n) => n.id === node.id) ?? null : null;
      const nodeModel = node
        ? resolvePartModel(node, {
            build123d: manifests.build123d,
            manufacturerStep: manifests.manufacturerStep,
          })
        : null;
      if (node?.type === 'HEAD') {
        headExtra = (
          <>
            <HeadDetail pos={node.pos} sku={node.sku} project={project} />
            <ModelProvenance model={nodeModel} />
            {nodeHyd && <NodeHydraulics pressurePsi={nodeHyd.pressurePsi} flowGpm={nodeHyd.flowGpm} />}
          </>
        );
      } else if (node) {
        // A fitting (tee/elbow/reducer) or the riser — show its connectivity ports.
        headExtra = (
          <>
            <FittingDetail node={node} />
            <ModelProvenance model={nodeModel} />
            {nodeHyd && <NodeHydraulics pressurePsi={nodeHyd.pressurePsi} flowGpm={nodeHyd.flowGpm} />}
          </>
        );
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
      if (seg) {
        const segHyd = hydraulics.perSegment.find((s) => s.id === seg.id) ?? null;
        headExtra = (
          <>
            <SegmentEditor seg={seg} />
            {segHyd && (
              <SegmentHydraulics
                frictionPsi={segHyd.frictionPsi}
                velocityFps={segHyd.velocityFps}
                flowGpm={segHyd.flowGpm}
              />
            )}
          </>
        );
      }
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

/**
 * Segment editor (W4): override the schedule diameter and delete the pipe. The
 * diameter override is an operator action; the schedule auto-sizes on a re-route.
 */
function SegmentEditor({ seg }: { seg: Segment }): ReactElement {
  const setSegmentDiameter = useCadStore((s) => s.setSegmentDiameter);
  const deleteSegment = useCadStore((s) => s.deleteSegment);
  const [draft, setDraft] = useState<string>(String(seg.diameterIn));

  useEffect(() => {
    setDraft(String(seg.diameterIn));
  }, [seg.id, seg.diameterIn]);

  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>Edit pipe</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        <span style={dtStyle}>Diameter (in) — override schedule</span>
        <div style={{ display: 'flex', gap: spacing[1] }}>
          <input
            type="number"
            min={0.25}
            step={0.25}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            style={smallBtnStyle}
            onClick={() => {
              const n = Number(draft);
              if (Number.isFinite(n) && n > 0) setSegmentDiameter(seg.id, n);
            }}
          >
            Set
          </button>
        </div>
      </label>
      <button
        type="button"
        style={{ ...smallBtnStyle, borderColor: colors.danger, color: colors.danger }}
        onClick={() => deleteSegment(seg.id)}
      >
        Delete segment
      </button>
    </div>
  );
}

/**
 * Fitting detail (W4): show a selected fitting/riser's connectivity Ports, derived
 * from its ADJACENT pipe segments (the larger adjacent run is the inlet; the rest are
 * outlets). Reports whether each outlet mates the inlet via the SAME arePortsCompatible
 * the routing used — honest, no invented connections. Threaded NPT is the modeled
 * method for the schedule sizes.
 */
function FittingDetail({ node }: { node: Node }): ReactElement {
  const segments = useCadStore((s) => s.project.network.segments);
  const moveLabel = node.type === 'SOURCE' ? 'Riser / supply' : `Fitting · ${node.type}`;

  // Adjacent segment diameters (this node is an endpoint).
  const adjacent = segments.filter((s) => s.from === node.id || s.to === node.id);
  const sizes = adjacent.map((s) => s.diameterIn);
  const inletSize = sizes.length > 0 ? Math.max(...sizes) : null;
  const outletSizes = sizes.filter((d) => d !== inletSize);
  // If all adjacent are the same size, outlets mirror the inlet size.
  const outs = outletSizes.length > 0 ? outletSizes : inletSize != null ? [inletSize] : [];

  const mateOk = (() => {
    if (inletSize == null) return null;
    return outs.every((o) =>
      arePortsCompatible(
        { method: 'THREADED_NPT', nominalSizeIn: inletSize, role: 'OUTLET' },
        { method: 'THREADED_NPT', nominalSizeIn: o, role: 'INLET' },
      ),
    );
  })();

  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>{moveLabel} — ports</div>
      {inletSize == null ? (
        <p style={emptyBodyStyle}>No pipe is connected to this fitting yet.</p>
      ) : (
        <dl style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
          <div style={rowStyle}>
            <dt style={dtStyle}>Inlet</dt>
            <dd style={ddStyle}>{`NPT ${inletSize}"`}</dd>
          </div>
          <div style={rowStyle}>
            <dt style={dtStyle}>Outlet(s)</dt>
            <dd style={ddStyle}>{outs.map((o) => `NPT ${o}"`).join(', ')}</dd>
          </div>
          <div style={rowStyle}>
            <dt style={dtStyle}>Ports mate</dt>
            <dd style={{ ...ddStyle, color: mateOk ? colors.accentText : colors.danger }}>
              {mateOk ? 'yes (real connection/adapter)' : 'NO — size step has no real reducer'}
            </dd>
          </div>
        </dl>
      )}
      <div style={citationStyle}>
        Mate-ability uses the connectivity Port model (real reducing fittings only).
        Design aid — not a hydraulic calc or code certification.
      </div>
    </div>
  );
}

/**
 * W5 node hydraulics: the live pressure (psi) + flow (gpm) at the selected node from
 * the design-aid solve. Honest: design aid / estimate, not a certified calc.
 */
function NodeHydraulics({
  pressurePsi,
  flowGpm,
}: {
  pressurePsi: number;
  flowGpm: number;
}): ReactElement {
  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>Hydraulics (design aid)</div>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        <div style={rowStyle}>
          <dt style={dtStyle}>Pressure</dt>
          <dd style={ddStyle}>{`${pressurePsi.toFixed(1)} psi`}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Flow</dt>
          <dd style={ddStyle}>{`${flowGpm.toFixed(1)} gpm`}</dd>
        </div>
      </dl>
      <div style={citationStyle}>
        Q=K√P + Hazen-Williams (cited NFPA-13 constants). Estimate / design aid — not a
        certified hydraulic calc, AHJ, or PE-sealed.
      </div>
    </div>
  );
}

/**
 * W5 segment hydraulics: the live friction loss (psi), velocity (ft/s), and flow
 * (gpm) for the selected pipe from the design-aid solve.
 */
function SegmentHydraulics({
  frictionPsi,
  velocityFps,
  flowGpm,
}: {
  frictionPsi: number;
  velocityFps: number;
  flowGpm: number;
}): ReactElement {
  return (
    <div style={headBlockStyle}>
      <div style={headBlockTitleStyle}>Hydraulics (design aid)</div>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        <div style={rowStyle}>
          <dt style={dtStyle}>Friction</dt>
          <dd style={ddStyle}>{`${frictionPsi.toFixed(2)} psi`}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Velocity</dt>
          <dd style={ddStyle}>{`${velocityFps.toFixed(2)} ft/s`}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={dtStyle}>Flow</dt>
          <dd style={ddStyle}>{`${flowGpm.toFixed(1)} gpm`}</dd>
        </div>
      </dl>
      <div style={citationStyle}>
        Hazen-Williams Pm=4.52·Q^1.85/(C^1.85·d^4.87)·L + fitting equivalent lengths
        (cited NFPA-13). Estimate / design aid — verify the adopted edition.
      </div>
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

const inputStyle: CSSProperties = {
  flex: 1,
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
};

const smallBtnStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  cursor: 'pointer',
};
