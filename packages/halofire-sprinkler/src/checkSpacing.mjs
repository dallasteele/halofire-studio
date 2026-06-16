const SPACING_LIMITS_FT = {
  light: { min: 15, max: 20 },
  ordinary: { min: 15, max: 20 },
  extra: { min: 10, max: 15 },
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`)
  }
}

function validateHeadXYs(headXYs) {
  if (!Array.isArray(headXYs)) {
    throw new TypeError('headXYs must be an array of [x, y] pairs')
  }

  headXYs.forEach((headXY, index) => {
    if (!Array.isArray(headXY) || headXY.length !== 2) {
      throw new TypeError(`headXYs[${index}] must be a [x, y] pair`)
    }

    assertFiniteNumber(headXY[0], `headXYs[${index}][0]`)
    assertFiniteNumber(headXY[1], `headXYs[${index}][1]`)
  })
}

function validateHazardClass(hazardClass) {
  if (!Object.hasOwn(SPACING_LIMITS_FT, hazardClass)) {
    throw new TypeError('hazardClass must be one of: light, ordinary, extra')
  }

  return SPACING_LIMITS_FT[hazardClass]
}

export function checkSpacing(headXYs, hazardClass) {
  validateHeadXYs(headXYs)
  const limits = validateHazardClass(hazardClass)
  const tooClose = new Set()
  const tooFar = new Set()

  for (let i = 0; i < headXYs.length; i += 1) {
    const [x1, y1] = headXYs[i]

    for (let j = i + 1; j < headXYs.length; j += 1) {
      const [x2, y2] = headXYs[j]
      const distance = Math.hypot(x2 - x1, y2 - y1)

      if (distance < limits.min) {
        tooClose.add(i)
        tooClose.add(j)
      }

      if (distance > limits.max) {
        tooFar.add(i)
        tooFar.add(j)
      }
    }
  }

  return {
    ok: tooClose.size === 0 && tooFar.size === 0,
    tooClose: [...tooClose].sort((a, b) => a - b),
    tooFar: [...tooFar].sort((a, b) => a - b),
  }
}
