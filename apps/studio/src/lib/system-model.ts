// PURE NFPA-13 wet-pipe system-model logic — no React / three / DOM imports.
//
// Models the §1.1 canonical wet-pipe topology as a typed parent/child graph:
//   supply -> backflow -> control_valve -> system_valve -> riser
//          -> feed_main -> cross_main -> branch_line -> sprinkler_head
//   plus drain / inspectors_test / aux nodes.
// Each node carries its component kind, an optional catalog SKU id (where a real
// ingested SKU applies — e.g. the chosen head), and its connectivity Port(s).
//
// buildSystem(spec) assembles a small but real wet-pipe branch-line example from
// a chosen head SKU + hazard class. validateSystem(system) returns typed findings
// (ok | warn | error) — each carrying a message AND the cited rule it checks
// against — covering port mate-ability, over-area coverage, and head-to-head
// spacing.
//
// HONESTY (hard, fail-closed): this is a DESIGN-AID topology + sanity checker
// built from published NFPA-13 values (see nfpa13-rules.ts citations). It is NOT
// a hydraulic calculation, NOT AHJ-approved, NOT PE-sealed, NOT code compliance,
// and NOT for construction. validateSystem reports honest findings against the
// cited published limits — passing it does NOT mean the design is compliant.

import {
  checkPorts,
  type Port,
} from './connectivity';
import {
  MAX_PROTECTION_AREA_SQFT,
  MAX_SPACING_FT,
  MIN_HEAD_TO_HEAD_FT,
  NFPA13_DESIGN_AID_DISCLAIMER,
  type HazardClass,
} from './nfpa13-rules';

export { NFPA13_DESIGN_AID_DISCLAIMER };

/** Kind of node in the NFPA-13 flow topology (ordered roughly by water order). */
export type SystemNodeKind =
  | 'supply' // city main / pump / tank
  | 'backflow' // backflow preventer (RPZ / double-check)
  | 'control_valve' // listed indicating valve (OS&Y / butterfly)
  | 'system_valve' // alarm-check (wet) / dry-pipe / preaction / deluge
  | 'riser' // system riser
  | 'feed_main'
  | 'cross_main'
  | 'branch_line'
  | 'sprinkler_head'
  | 'drain' // main drain
  | 'inspectors_test' // inspector's test connection (ITC)
  | 'aux'; // auxiliary (drum drip / low-point drain, etc.)

export const SYSTEM_NODE_KINDS: readonly SystemNodeKind[] = [
  'supply',
  'backflow',
  'control_valve',
  'system_valve',
  'riser',
  'feed_main',
  'cross_main',
  'branch_line',
  'sprinkler_head',
  'drain',
  'inspectors_test',
  'aux',
] as const;

/** A node in the system graph. */
export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  /** Human label. */
  label: string;
  /** Catalog SKU id when a real ingested SKU backs this node (e.g. a head). */
  componentSku: string | null;
  /** The connectivity ports this node exposes. */
  ports: Port[];
  /** Parent node id in the flow tree (null only for the root supply). */
  parentId: string | null;
}

/** A laid-out sprinkler head footprint position (ft), centered on origin. */
export interface SystemHead {
  id: string;
  x: number;
  z: number;
}

/** The assembled system. */
export interface FireSystem {
  /** "wet" — only wet-pipe is modeled here. */
  type: 'wet';
  hazard: HazardClass;
  nodes: SystemNode[];
  /** Head footprint positions used for area/spacing checks (ft). */
  heads: SystemHead[];
  /** Building footprint used to derive per-head coverage (ft). */
  building: { widthFt: number; lengthFt: number };
  /** The chosen head SKU id (catalog), if any. */
  headSku: string | null;
}

/** Spec to build a small example branch-line wet system. */
export interface SystemSpec {
  hazard: HazardClass;
  /** Building footprint (ft). */
  widthFt: number;
  lengthFt: number;
  /** Heads per branch line (along the branch). */
  headsPerBranch: number;
  /** Number of branch lines. */
  branchCount: number;
  /** Chosen head SKU id from the catalog (or null for a generic head). */
  headSku?: string | null;
  /**
   * The head's inlet port (from the chosen catalog SKU). Defaults to a 1/2" NPT
   * inlet — the dominant real sprinkler-head inlet — when not supplied.
   */
  headInlet?: Port;
  /** Branch-line nominal size (in) + method. Default 1" threaded NPT (steel). */
  branchSizeIn?: number;
  branchMethod?: Port['method'];
}

/** A single typed validation finding. */
export interface SystemFinding {
  severity: 'ok' | 'warn' | 'error';
  /** Stable code for the kind of check. */
  code:
    | 'topology'
    | 'port_mate'
    | 'coverage_area'
    | 'head_to_head_spacing'
    | 'max_spacing'
    | 'disclaimer';
  message: string;
  /** The cited rule this finding checks against (NFPA 13 ref or internal). */
  citedRule: string;
  /** Node ids the finding refers to (when applicable). */
  nodeIds?: string[];
}

const DEFAULT_HEAD_INLET: Port = {
  method: 'THREADED_NPT',
  nominalSizeIn: 0.5,
  role: 'INLET',
};

/**
 * Build a small, REAL wet-pipe branch-line example system.
 *
 * Topology (parent -> child):
 *   supply -> backflow -> control_valve -> system_valve(alarm-check) -> riser
 *     -> feed_main -> cross_main -> [branch_line]* -> [sprinkler_head]*
 *   plus a drain + inspector's test hung off the cross main.
 *
 * Ports are assigned so adjacent nodes mate (the branch line carries an OUTLET
 * sized to feed the head's INLET — typically via a reducing bushing, which
 * validateSystem detects as an adapter-bridged connection). Deterministic.
 */
export function buildSystem(spec: SystemSpec): FireSystem {
  const hazard = spec.hazard;
  const headInlet = spec.headInlet ?? DEFAULT_HEAD_INLET;
  // Default the branch size one nominal step above the head inlet so a real
  // reducing bushing bridges the tap (0.5" head -> 0.75" branch via
  // npt-bushing-075-050; 0.75" head -> 1" branch via npt-bushing-100-075).
  // This keeps a bare buildSystem(default) self-consistent (no unbridged
  // 1"->0.5" mismatch); explicit spec.branchSizeIn still overrides.
  const branchSizeIn =
    spec.branchSizeIn ?? (headInlet.nominalSizeIn <= 0.5 ? 0.75 : 1);
  const branchMethod = spec.branchMethod ?? 'THREADED_NPT';
  const headSku = spec.headSku ?? null;

  const nodes: SystemNode[] = [];

  // Trunk: a 4" grooved supply train stepping into the riser/mains.
  const supply: SystemNode = {
    id: 'supply',
    kind: 'supply',
    label: 'Water supply (city main)',
    componentSku: null,
    parentId: null,
    ports: [{ method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' }],
  };
  const backflow: SystemNode = {
    id: 'backflow',
    kind: 'backflow',
    label: 'Backflow preventer',
    componentSku: null,
    parentId: 'supply',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      { method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' },
    ],
  };
  const controlValve: SystemNode = {
    id: 'control_valve',
    kind: 'control_valve',
    label: 'Control valve (OS&Y gate, listed indicating)',
    componentSku: null,
    parentId: 'backflow',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      { method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' },
    ],
  };
  const systemValve: SystemNode = {
    id: 'system_valve',
    kind: 'system_valve',
    label: 'Alarm-check valve (wet)',
    componentSku: null,
    parentId: 'control_valve',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      { method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' },
    ],
  };
  const riser: SystemNode = {
    id: 'riser',
    kind: 'riser',
    label: 'System riser',
    componentSku: null,
    parentId: 'system_valve',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      { method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' },
    ],
  };
  const feedMain: SystemNode = {
    id: 'feed_main',
    kind: 'feed_main',
    label: 'Feed main',
    componentSku: null,
    parentId: 'riser',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      { method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' },
    ],
  };
  const crossMain: SystemNode = {
    id: 'cross_main',
    kind: 'cross_main',
    label: 'Cross main',
    componentSku: null,
    parentId: 'feed_main',
    ports: [
      { method: 'GROOVED', nominalSizeIn: 4, role: 'INLET' },
      // Cross main taps off branch lines via threaded NPT outlets at branch size.
      { method: branchMethod, nominalSizeIn: branchSizeIn, role: 'OUTLET' },
    ],
  };

  nodes.push(
    supply,
    backflow,
    controlValve,
    systemValve,
    riser,
    feedMain,
    crossMain,
  );

  // Drain + inspector's test hung off the cross main (service/verification).
  nodes.push({
    id: 'main_drain',
    kind: 'drain',
    label: 'Main drain',
    componentSku: null,
    parentId: 'cross_main',
    ports: [{ method: branchMethod, nominalSizeIn: branchSizeIn, role: 'INLET' }],
  });
  nodes.push({
    id: 'inspectors_test',
    kind: 'inspectors_test',
    label: "Inspector's test connection",
    componentSku: null,
    parentId: 'cross_main',
    ports: [{ method: branchMethod, nominalSizeIn: branchSizeIn, role: 'INLET' }],
  });

  // Build the laid-out heads + branch/head nodes.
  const heads: SystemHead[] = [];
  const spacing = pickSpacing(spec);
  const branchCount = Math.max(1, spec.branchCount);
  const headsPerBranch = Math.max(1, spec.headsPerBranch);

  const xStart = -((headsPerBranch - 1) / 2) * spacing;
  const zStart = -((branchCount - 1) / 2) * spacing;

  for (let b = 0; b < branchCount; b += 1) {
    const branchId = `branch_${b}`;
    const branchZ = round(zStart + b * spacing);
    nodes.push({
      id: branchId,
      kind: 'branch_line',
      label: `Branch line ${b + 1}`,
      componentSku: null,
      parentId: 'cross_main',
      ports: [
        { method: branchMethod, nominalSizeIn: branchSizeIn, role: 'INLET' },
        // Each head tap is an OUTLET at the branch size; it feeds the head inlet
        // (typically through a reducing bushing — validateSystem resolves the adapter).
        { method: branchMethod, nominalSizeIn: branchSizeIn, role: 'OUTLET' },
      ],
    });

    for (let h = 0; h < headsPerBranch; h += 1) {
      const headId = `head_${b}_${h}`;
      const headX = round(xStart + h * spacing);
      heads.push({ id: headId, x: headX, z: branchZ });
      nodes.push({
        id: headId,
        kind: 'sprinkler_head',
        label: headSku ? `Head (${headSku})` : 'Sprinkler head',
        componentSku: headSku,
        parentId: branchId,
        ports: [{ ...headInlet, role: 'INLET' }],
      });
    }
  }

  return {
    type: 'wet',
    hazard,
    nodes,
    heads,
    building: { widthFt: spec.widthFt, lengthFt: spec.lengthFt },
    headSku,
  };
}

/**
 * Validate a system, returning typed findings. Checks:
 *   1. topology: every non-root node has a resolvable parent (error if dangling).
 *   2. port_mate: each child's INLET mates its parent's OUTLET, directly or via a
 *      real adapter — flagged error when no real connection exists.
 *   3. coverage_area: per-head coverage (footprint area / head count) vs the
 *      hazard max protection area (warn when exceeded — the chosen head/grid is
 *      stretched past the published max area).
 *   4. head_to_head_spacing: minimum head-to-head distance vs published minimum
 *      (error when two heads are closer than the minimum).
 *   5. max_spacing: head spacing vs the hazard maximum (warn when exceeded).
 *   6. disclaimer: an always-present ok finding restating the design-aid posture.
 */
export function validateSystem(system: FireSystem): SystemFinding[] {
  const findings: SystemFinding[] = [];
  const byId = new Map(system.nodes.map((n) => [n.id, n]));

  // 1 + 2: topology + port mate-ability for every parent/child edge.
  for (const node of system.nodes) {
    if (node.parentId === null) continue;
    const parent = byId.get(node.parentId);
    if (!parent) {
      findings.push({
        severity: 'error',
        code: 'topology',
        message: `node "${node.id}" references missing parent "${node.parentId}"`,
        citedRule:
          'Internal topology invariant — every non-root node must have a resolvable parent in the flow tree.',
        nodeIds: [node.id],
      });
      continue;
    }

    // Find the parent OUTLET that feeds this node's INLET.
    const inlet = node.ports.find((p) => p.role === 'INLET');
    const parentOutlet = parent.ports.find((p) => p.role === 'OUTLET');
    if (!inlet || !parentOutlet) {
      // Not all nodes need a mate-able pair (e.g. a drain modeled with only an
      // inlet whose parent exposes a same-size outlet handles this); only flag
      // when an inlet exists but the parent exposes no outlet at all.
      if (inlet && !parentOutlet) {
        findings.push({
          severity: 'error',
          code: 'port_mate',
          message: `"${node.id}" needs an inlet feed but parent "${parent.id}" exposes no outlet`,
          citedRule:
            'Connectivity §2.3 — an INLET must be fed by an opposing OUTLET (a real connection).',
          nodeIds: [node.id, parent.id],
        });
      }
      continue;
    }

    const res = checkPorts(parentOutlet, inlet);
    if (!res.compatible) {
      findings.push({
        severity: 'error',
        code: 'port_mate',
        message: `"${parent.id}" -> "${node.id}" do not connect: ${res.message}`,
        citedRule:
          'Connectivity §2.3 — ports connect only on matching method+size (or a real adapter) with opposing roles. No invented adapters.',
        nodeIds: [parent.id, node.id],
      });
    } else if (res.adapter) {
      findings.push({
        severity: 'ok',
        code: 'port_mate',
        message: `"${parent.id}" -> "${node.id}" connected via ${res.adapter.label}`,
        citedRule: `Real adapter fitting: ${res.adapter.note}`,
        nodeIds: [parent.id, node.id],
      });
    }
  }

  // 3: coverage area per head vs hazard max.
  const headCount = system.heads.length;
  const areaRule = MAX_PROTECTION_AREA_SQFT[system.hazard];
  if (headCount > 0 && areaRule.value !== null) {
    const footprintArea = system.building.widthFt * system.building.lengthFt;
    const perHead = footprintArea / headCount;
    if (perHead > areaRule.value) {
      findings.push({
        severity: 'warn',
        code: 'coverage_area',
        message: `per-head coverage ${perHead.toFixed(1)} ft^2 exceeds max protection area ${areaRule.value} ft^2 for ${system.hazard}`,
        citedRule: areaRule.citation,
      });
    } else {
      findings.push({
        severity: 'ok',
        code: 'coverage_area',
        message: `per-head coverage ${perHead.toFixed(1)} ft^2 within max ${areaRule.value} ft^2 for ${system.hazard}`,
        citedRule: areaRule.citation,
      });
    }
  }

  // 4 + 5: head-to-head spacing (minimum + maximum).
  if (system.heads.length >= 2) {
    let minDist = Infinity;
    let maxAdjacent = 0;
    for (let i = 0; i < system.heads.length; i += 1) {
      for (let j = i + 1; j < system.heads.length; j += 1) {
        const d = dist(system.heads[i], system.heads[j]);
        if (d < minDist) minDist = d;
      }
    }
    // Max "adjacent" spacing approximated as the min pairwise distance's grid
    // step is the spacing; use the min distance as the spacing measure for the
    // max-spacing check too (uniform grid => nearest-neighbor distance == step).
    maxAdjacent = minDist;

    const minRule = MIN_HEAD_TO_HEAD_FT;
    if (minRule.value !== null && minDist < minRule.value) {
      findings.push({
        severity: 'error',
        code: 'head_to_head_spacing',
        message: `closest heads are ${minDist.toFixed(2)} ft apart — below minimum ${minRule.value} ft`,
        citedRule: minRule.citation,
      });
    } else if (minRule.value !== null) {
      findings.push({
        severity: 'ok',
        code: 'head_to_head_spacing',
        message: `closest heads ${minDist.toFixed(2)} ft apart — at/above minimum ${minRule.value} ft`,
        citedRule: minRule.citation,
      });
    }

    const maxRule = MAX_SPACING_FT[system.hazard];
    if (maxRule.value !== null && maxAdjacent > maxRule.value) {
      findings.push({
        severity: 'warn',
        code: 'max_spacing',
        message: `head spacing ${maxAdjacent.toFixed(2)} ft exceeds max ${maxRule.value} ft for ${system.hazard}`,
        citedRule: maxRule.citation,
      });
    } else if (maxRule.value !== null) {
      findings.push({
        severity: 'ok',
        code: 'max_spacing',
        message: `head spacing ${maxAdjacent.toFixed(2)} ft within max ${maxRule.value} ft for ${system.hazard}`,
        citedRule: maxRule.citation,
      });
    }
  }

  // 6: always-present honesty finding.
  findings.push({
    severity: 'ok',
    code: 'disclaimer',
    message: NFPA13_DESIGN_AID_DISCLAIMER,
    citedRule:
      'Honesty contract — design aid only; not a certified hydraulic calc / AHJ / PE / code-compliant design.',
  });

  return findings;
}

/* ------------------------------------------------------------- helpers */

/**
 * Pick a uniform head spacing for the example. We default to a spacing that
 * stays under the hazard max but is comfortably above the head-to-head minimum,
 * so a default build validates cleanly. The caller can override via a tighter
 * building footprint to deliberately trip checks.
 */
function pickSpacing(spec: SystemSpec): number {
  const maxRule = MAX_SPACING_FT[spec.hazard];
  const max = maxRule.value ?? 12;
  const min = MIN_HEAD_TO_HEAD_FT.value ?? 6;
  // A typical real branch spacing: 10 ft (under the 12-15 ft max, over the 6 ft min).
  const candidate = 10;
  if (candidate > max) return max;
  if (candidate < min) return min;
  return candidate;
}

function dist(a: SystemHead, b: SystemHead): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Convenience: count findings by severity. */
export function summarizeFindings(findings: readonly SystemFinding[]): {
  ok: number;
  warn: number;
  error: number;
} {
  let ok = 0;
  let warn = 0;
  let error = 0;
  for (const f of findings) {
    if (f.severity === 'ok') ok += 1;
    else if (f.severity === 'warn') warn += 1;
    else error += 1;
  }
  return { ok, warn, error };
}
