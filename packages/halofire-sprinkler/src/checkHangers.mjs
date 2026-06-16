function assertPositiveFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`)
  }
}

function validatePipeSizeIn(pipeSizeIn) {
  assertPositiveFiniteNumber(pipeSizeIn, 'pipeSizeIn')

  const eighths = pipeSizeIn * 8
  const roundedEighths = Math.round(eighths)

  if (Math.abs(eighths - roundedEighths) > Number.EPSILON * 8) {
    throw new TypeError('pipeSizeIn must be in 1/8 inch increments')
  }

  if (roundedEighths < 4 || roundedEighths > 16) {
    throw new TypeError('pipeSizeIn must be between 1/2 and 2 inches inclusive')
  }

  return roundedEighths / 8
}

export function checkHangerSpacing(spacingFt, pipeSizeIn) {
  assertPositiveFiniteNumber(spacingFt, 'spacingFt')
  const normalizedPipeSizeIn = validatePipeSizeIn(pipeSizeIn)
  const maxAllowedFt = normalizedPipeSizeIn <= 1 ? 10 : 15

  return {
    ok: spacingFt <= maxAllowedFt,
    maxAllowedFt,
  }
}
