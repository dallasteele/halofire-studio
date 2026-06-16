const EQUIVALENT_LENGTH_FT_BY_TYPE = Object.freeze({
  '90° elbow': 10,
  '45° elbow': 5,
  tee: 10,
  'gate valve': 15,
  'swing check': 15,
});

function assertValidPipeSize(pipeSizeIn) {
  if (!Number.isFinite(pipeSizeIn) || pipeSizeIn <= 0) {
    throw new Error(`Invalid pipe size: ${pipeSizeIn}`);
  }
}

export function equivalentLengthFt(fittingType, pipeSizeIn) {
  assertValidPipeSize(pipeSizeIn);

  const equivalentLengthFt = EQUIVALENT_LENGTH_FT_BY_TYPE[fittingType];
  if (equivalentLengthFt === undefined) {
    throw new Error(`Unknown fitting type: ${fittingType}`);
  }

  return equivalentLengthFt;
}

export function totalEquivalentLength(fittings) {
  if (!Array.isArray(fittings)) {
    throw new Error('fittings must be an array');
  }

  return fittings.reduce((total, fitting) => {
    return total + equivalentLengthFt(fitting.fittingType, fitting.pipeSizeIn);
  }, 0);
}

