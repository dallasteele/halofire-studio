// AutoSprink "Flow Calculator" (Hydraulics menu) — solve any one of {Q, K, P}
// from the other two using the cited sprinkler discharge formula Q = K * sqrt(P)
// (the same relation nfpa13-rules.ts cites; verify adopted edition).
//
// HONESTY: a pure design-aid calculator. No AHJ/PE/parity claim.

export interface FlowCalcInput {
  flowGpm?: number;
  kFactor?: number;
  pressurePsi?: number;
}

export interface FlowCalcResult {
  flowGpm: number;
  kFactor: number;
  pressurePsi: number;
  solvedFor: 'flowGpm' | 'kFactor' | 'pressurePsi';
  formula: 'Q = K * sqrt(P)';
}

/** The three solvable fields, in a stable order. */
const FIELDS = ['flowGpm', 'kFactor', 'pressurePsi'] as const;

/**
 * Solve the third quantity from exactly two of {flow (gpm), K-factor, pressure (psi)}.
 * Throws when the input does not contain exactly two fields, when any given value
 * is not a finite positive number, or when pressure must be derived from K = 0
 * (impossible: P = (Q/K)^2).
 */
export function solveFlow(input: FlowCalcInput): FlowCalcResult {
  const given = FIELDS.filter((f) => input[f] !== undefined);
  if (given.length !== 2) {
    throw new Error(
      `solveFlow requires exactly 2 of flowGpm/kFactor/pressurePsi; got ${given.length}`,
    );
  }
  for (const f of given) {
    const v = input[f]!;
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`solveFlow: ${f} must be a finite positive number; got ${v}`);
    }
  }

  const formula = 'Q = K * sqrt(P)' as const;
  if (input.flowGpm === undefined) {
    const flowGpm = input.kFactor! * Math.sqrt(input.pressurePsi!);
    return {
      flowGpm,
      kFactor: input.kFactor!,
      pressurePsi: input.pressurePsi!,
      solvedFor: 'flowGpm',
      formula,
    };
  }
  if (input.kFactor === undefined) {
    const kFactor = input.flowGpm / Math.sqrt(input.pressurePsi!);
    return {
      flowGpm: input.flowGpm,
      kFactor,
      pressurePsi: input.pressurePsi!,
      solvedFor: 'kFactor',
      formula,
    };
  }
  // Pressure is the unknown: P = (Q/K)^2. K = 0 is already rejected above, but
  // keep the explicit guard the spec calls for (division by zero).
  if (input.kFactor === 0) {
    throw new Error('solveFlow: cannot derive pressure when kFactor is 0');
  }
  const pressurePsi = (input.flowGpm / input.kFactor) ** 2;
  return {
    flowGpm: input.flowGpm,
    kFactor: input.kFactor,
    pressurePsi,
    solvedFor: 'pressurePsi',
    formula,
  };
}
