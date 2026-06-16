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

  const equivalentLength = EQUIVALENT_LENGTH_FT_BY_TYPE[fittingType];
  if (equivalentLength === undefined) {
    throw new Error(`Unknown fitting type: ${fittingType}`);
  }

  return equivalentLength;
}

export function totalEquivalentLength(fittings) {
  if (!Array.isArray(fittings)) {
    throw new Error('fittings must be an array');
  }

  return fittings.reduce((total, fitting) => {
    if (!fitting || typeof fitting !== 'object') {
      throw new Error('Each fitting must be an object');
    }

    return total + equivalentLengthFt(fitting.fittingType, fitting.pipeSizeIn);
  }, 0);
}
