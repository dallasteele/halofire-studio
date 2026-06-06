// PURE connectivity logic — no React / three / DOM imports.
//
// Implements the §2 connectivity Port model from
// docs/research/parts-catalog-and-system-model.md: a Port carries a joining
// {method, nominalSizeIn, role}; two ports connect ONLY when their methods match
// (or a documented, physically-real adapter bridges them), their nominal sizes
// match, and their roles oppose (OUTLET -> INLET). Cross-method or cross-size
// joining is NEVER implicit — it is always handled by an explicit adapter/reducer
// fitting that itself carries the two differing ports.
//
// HONESTY (hard, fail-closed): the ADAPTERS list below contains ONLY size/method
// transitions that physically exist in real fire-protection fittings (grooved
// flange adapters, NPT reducing bushings, NPT x grooved adapter nipples, brass
// CPVC transition adapters). We NEVER invent an adapter that does not exist to
// force two parts together. An adapter that is not real is a FAIL. This module
// makes no NFPA-13 / code-compliance claim — it is mechanical mate-ability only.

/**
 * Joining method. Subset of the §2.1 method enum that the shipped catalog +
 * system model actually use (the broader research enum lists more; we encode
 * only what we model, never a method we cannot back with a real port).
 */
export type Method =
  | 'THREADED_NPT'
  | 'GROOVED'
  | 'FLANGED'
  | 'THREADED_BSP'
  | 'PLAIN_END'
  | 'SOLDER';

export const METHODS: readonly Method[] = [
  'THREADED_NPT',
  'GROOVED',
  'FLANGED',
  'THREADED_BSP',
  'PLAIN_END',
  'SOLDER',
] as const;

/**
 * Functional/positional role of a port — which way water flows through it. This
 * is NOT mechanical gender (true thread/solvent gender is a separate concern, §2.2);
 * it is the direction the opening faces in the flow topology. Two ports connect
 * only when one is an OUTLET feeding the other's INLET.
 */
export type PortRole = 'INLET' | 'OUTLET';

export const PORT_ROLES: readonly PortRole[] = ['INLET', 'OUTLET'] as const;

export interface Port {
  method: Method;
  /** Nominal pipe/connection size in inches (e.g. 0.5, 0.75, 1, 2, 4). */
  nominalSizeIn: number;
  role: PortRole;
}

/**
 * A physically-real adapter/reducer fitting that bridges two ports that would
 * otherwise be incompatible. Each adapter declares the EXACT transition it
 * bridges: a `from` side and a `to` side (method + size). The adapter only
 * bridges that specific transition (and its reverse) — it does not magically
 * connect arbitrary ports.
 *
 * HONESTY: every entry here is a real, commercially-available fire-protection
 * fitting. We do NOT add an adapter just to make the graph connect.
 */
export interface Adapter {
  /** Stable id for the adapter fitting. */
  id: string;
  /** Human label (real product family / fitting type). */
  label: string;
  fromMethod: Method;
  fromSizeIn: number;
  toMethod: Method;
  toSizeIn: number;
  /**
   * Source/justification that this transition is a real fitting. Mirrors the
   * citation discipline used for code constants. Never empty.
   */
  note: string;
}

/**
 * Real adapter/reducer fittings. Each is a fitting you can actually buy.
 *
 *  - Grooved flange adapter: bridges a grooved coupling to an ASME flange at the
 *    SAME size (Victaulic Style 741/743 flange adapters). Already shipped in the
 *    parametric catalog as `grooved_flange_adapter`.
 *  - NPT reducing bushing: bridges two NPT threads of different size (a hex/face
 *    reducing bushing), e.g. 3/4" x 1/2" — the standard way to step an NPT branch
 *    down for a 1/2" head.
 *  - NPT x grooved adapter nipple: a threaded-one-end, grooved-one-end nipple
 *    (Victaulic-style threaded adapter nipple) bridging NPT to a groove at the
 *    same nominal size.
 *  - Brass CPVC transition adapter: a male/female brass adapter that takes a
 *    CPVC solvent-weld socket on one side and NPT on the other (BlazeMaster
 *    transition fitting) — here modeled as the NPT-facing transition at 1".
 *
 * Sizes are limited to transitions confirmed by the research doc (§2.4) and the
 * shipped catalog. We do NOT enumerate every conceivable bushing size — only the
 * ones we are confident are real and that the modeled system needs.
 */
export const ADAPTERS: readonly Adapter[] = [
  {
    id: 'grooved-flange-2',
    label: 'Grooved x Flange adapter (2")',
    fromMethod: 'GROOVED',
    fromSizeIn: 2,
    toMethod: 'FLANGED',
    toSizeIn: 2,
    note: 'Victaulic Style 741/743 grooved-to-ANSI-flange adapter (same nominal size). Victaulic 07.01 fittings literature.',
  },
  {
    id: 'grooved-flange-4',
    label: 'Grooved x Flange adapter (4")',
    fromMethod: 'GROOVED',
    fromSizeIn: 4,
    toMethod: 'FLANGED',
    toSizeIn: 4,
    note: 'Victaulic Style 741/743 grooved-to-ANSI-flange adapter (same nominal size). Victaulic 07.01 fittings literature.',
  },
  {
    id: 'npt-bushing-075-050',
    label: 'NPT reducing bushing (3/4" x 1/2")',
    fromMethod: 'THREADED_NPT',
    fromSizeIn: 0.75,
    toMethod: 'THREADED_NPT',
    toSizeIn: 0.5,
    note: 'Standard NPT hex reducing bushing 3/4" x 1/2" — steps a 3/4" branch outlet down to a 1/2" head inlet. Common malleable-iron fitting.',
  },
  {
    id: 'npt-bushing-100-075',
    label: 'NPT reducing bushing (1" x 3/4")',
    fromMethod: 'THREADED_NPT',
    fromSizeIn: 1,
    toMethod: 'THREADED_NPT',
    toSizeIn: 0.75,
    note: 'Standard NPT hex reducing bushing 1" x 3/4" — common malleable-iron fitting.',
  },
  {
    id: 'npt-grooved-nipple-2',
    label: 'NPT x Grooved adapter nipple (2")',
    fromMethod: 'THREADED_NPT',
    fromSizeIn: 2,
    toMethod: 'GROOVED',
    toSizeIn: 2,
    note: 'Threaded-one-end / grooved-one-end adapter nipple (same nominal size). Victaulic 07.01 fittings literature.',
  },
  {
    id: 'cpvc-brass-npt-1',
    label: 'CPVC x NPT brass transition adapter (1")',
    fromMethod: 'PLAIN_END',
    fromSizeIn: 1,
    toMethod: 'THREADED_NPT',
    toSizeIn: 1,
    note: 'BlazeMaster CPVC-to-metal brass transition adapter (solvent-weld socket on the CPVC side, NPT thread on the metal side); modeled CPVC socket as PLAIN_END. QRFS CPVC use & care.',
  },
] as const;

/** True when two roles oppose: an OUTLET feeds an INLET (order-independent). */
export function rolesOppose(a: PortRole, b: PortRole): boolean {
  return (a === 'OUTLET' && b === 'INLET') || (a === 'INLET' && b === 'OUTLET');
}

/**
 * Find an adapter that bridges `from` (method+size) to `to` (method+size), in
 * either direction. Returns the Adapter or null. Sizes must match the adapter's
 * declared transition exactly — an adapter is for ONE real transition, not a
 * wildcard.
 */
export function findAdapter(
  fromMethod: Method,
  fromSizeIn: number,
  toMethod: Method,
  toSizeIn: number,
): Adapter | null {
  for (const ad of ADAPTERS) {
    const forward =
      ad.fromMethod === fromMethod &&
      ad.fromSizeIn === fromSizeIn &&
      ad.toMethod === toMethod &&
      ad.toSizeIn === toSizeIn;
    const reverse =
      ad.fromMethod === toMethod &&
      ad.fromSizeIn === toSizeIn &&
      ad.toMethod === fromMethod &&
      ad.toSizeIn === fromSizeIn;
    if (forward || reverse) return ad;
  }
  return null;
}

/** Detailed result of a compatibility check (machine-readable reason). */
export interface CompatibilityResult {
  compatible: boolean;
  /** Set when the ports connect only because an adapter bridges them. */
  adapter: Adapter | null;
  /** One of: ok | role | method | size | adapter-required (failure reason). */
  reason: 'ok' | 'role' | 'method' | 'size';
  message: string;
}

/**
 * Detailed compatibility check between two ports.
 *
 * Two ports CONNECT iff:
 *   1. roles oppose (OUTLET <-> INLET); AND
 *   2. EITHER (same method AND same nominal size)
 *      OR a real Adapter bridges (method,size) -> (method,size).
 *
 * Role mismatch fails first (you cannot join two inlets or two outlets). A
 * method or size mismatch without a real adapter fails — we NEVER pretend an
 * adapter exists.
 */
export function checkPorts(a: Port, b: Port): CompatibilityResult {
  if (!rolesOppose(a.role, b.role)) {
    return {
      compatible: false,
      adapter: null,
      reason: 'role',
      message: `roles do not oppose (${a.role} + ${b.role}); an OUTLET must feed an INLET`,
    };
  }

  if (a.method === b.method && a.nominalSizeIn === b.nominalSizeIn) {
    return {
      compatible: true,
      adapter: null,
      reason: 'ok',
      message: `direct ${a.method} ${a.nominalSizeIn} in connection`,
    };
  }

  const adapter = findAdapter(a.method, a.nominalSizeIn, b.method, b.nominalSizeIn);
  if (adapter) {
    return {
      compatible: true,
      adapter,
      reason: 'ok',
      message: `bridged by ${adapter.label}`,
    };
  }

  if (a.method !== b.method) {
    return {
      compatible: false,
      adapter: null,
      reason: 'method',
      message: `method mismatch (${a.method} vs ${b.method}) and no real adapter bridges them`,
    };
  }

  return {
    compatible: false,
    adapter: null,
    reason: 'size',
    message: `nominal size mismatch (${a.nominalSizeIn} in vs ${b.nominalSizeIn} in) and no real reducer bridges them`,
  };
}

/**
 * Boolean convenience over checkPorts: are these two ports connectable (directly
 * or via a real documented adapter)?
 */
export function arePortsCompatible(a: Port, b: Port): boolean {
  return checkPorts(a, b).compatible;
}

/**
 * Every (method, nominalSizeIn) the given port can connect to — i.e. its own
 * (method,size) plus any (method,size) reachable through a real adapter. Roles
 * are not part of this (it answers "what mechanical openings can this mate to"),
 * so the caller still pairs it with an opposing role. Deterministic order:
 * the direct match first, then adapter-reachable transitions in ADAPTERS order.
 * No duplicates.
 */
export function connectableSizesFor(
  port: Port,
): { method: Method; nominalSizeIn: number }[] {
  const out: { method: Method; nominalSizeIn: number }[] = [
    { method: port.method, nominalSizeIn: port.nominalSizeIn },
  ];
  const seen = new Set<string>([`${port.method}|${port.nominalSizeIn}`]);

  for (const ad of ADAPTERS) {
    let other: { method: Method; nominalSizeIn: number } | null = null;
    if (ad.fromMethod === port.method && ad.fromSizeIn === port.nominalSizeIn) {
      other = { method: ad.toMethod, nominalSizeIn: ad.toSizeIn };
    } else if (ad.toMethod === port.method && ad.toSizeIn === port.nominalSizeIn) {
      other = { method: ad.fromMethod, nominalSizeIn: ad.fromSizeIn };
    }
    if (other) {
      const key = `${other.method}|${other.nominalSizeIn}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(other);
      }
    }
  }
  return out;
}
