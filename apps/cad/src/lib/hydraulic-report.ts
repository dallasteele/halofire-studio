// W2F — hydraulic calc summary text formatter (PURE). The submittal-lane
// "calc summary". Consumes a STRUCTURAL input (not solver internals) so it stays
// decoupled from hydraulics.ts. Rows are emitted in input order (caller sorts).
//
// HONESTY (fail-closed): a report with no citations or no disclaimer must NOT be
// producible — formatHydraulicReport throws. This is a design-aid summary, never
// a stamped/AHJ/PE calc.

export interface ReportNodeRow {
  id: string;
  pressurePsi: number;
  flowGpm: number;
}

export interface ReportSegmentRow {
  id: string;
  flowGpm: number;
  frictionPsi: number;
  velocityFps: number;
}

export interface ReportInput {
  projectName: string;
  hazard: string;
  demandGpm: number;
  demandPsiAtRiser: number;
  supply?: {
    staticPsi: number;
    residualPsi: number;
    flowGpm: number;
    availablePsiAtDemand: number;
    adequate: boolean;
  };
  nodes: ReportNodeRow[];
  segments: ReportSegmentRow[];
  disclaimer: string;
  citations: string[];
}

export const REPORT_HEADER = 'HALOFIRE CAD - HYDRAULIC DESIGN AID SUMMARY';

/** toFixed(decimals); throws on non-finite n or negative/non-integer decimals. */
export function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) throw new Error(`formatNumber: n must be finite; got ${n}`);
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`formatNumber: decimals must be a non-negative integer; got ${decimals}`);
  }
  return n.toFixed(decimals);
}

/** Pad an id to at least 16 chars (never truncate). */
function padId(id: string): string {
  return id.length >= 16 ? id : id + ' '.repeat(16 - id.length);
}

/** Render the plain-text hydraulic calc summary. */
export function formatHydraulicReport(input: ReportInput): string {
  if (input.disclaimer === '') throw new Error('formatHydraulicReport: disclaimer must not be empty');
  if (input.citations.length === 0) throw new Error('formatHydraulicReport: citations must not be empty');

  const f = formatNumber;
  const lines: string[] = [];
  lines.push(REPORT_HEADER);
  lines.push(`Project: ${input.projectName}`);
  lines.push(`Hazard: ${input.hazard}`);
  lines.push('');
  lines.push(`SYSTEM DEMAND: ${f(input.demandGpm, 1)} gpm @ ${f(input.demandPsiAtRiser, 1)} psi at riser`);

  if (input.supply) {
    const s = input.supply;
    lines.push(`SUPPLY: static ${f(s.staticPsi, 1)} psi, residual ${f(s.residualPsi, 1)} psi @ ${f(s.flowGpm, 1)} gpm`);
    lines.push(`AVAILABLE @ DEMAND: ${f(s.availablePsiAtDemand, 1)} psi -> ${s.adequate ? 'ADEQUATE' : 'INADEQUATE'}`);
  } else {
    lines.push('SUPPLY: none provided (demand-only result)');
  }

  lines.push('');
  lines.push(`NODES (${input.nodes.length})`);
  for (const n of input.nodes) {
    lines.push(`  ${padId(n.id)}  P=${f(n.pressurePsi, 2)} psi  Q=${f(n.flowGpm, 2)} gpm`);
  }

  lines.push('');
  lines.push(`SEGMENTS (${input.segments.length})`);
  for (const s of input.segments) {
    lines.push(`  ${padId(s.id)}  Q=${f(s.flowGpm, 2)} gpm  dP=${f(s.frictionPsi, 3)} psi  v=${f(s.velocityFps, 2)} ft/s`);
  }

  lines.push('');
  lines.push('CITATIONS:');
  for (const c of input.citations) lines.push(`  - ${c}`);

  lines.push('');
  lines.push(input.disclaimer);

  return lines.join('\n');
}
