function roundToTwoDecimals(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function hydraulicReport({ demandGpm, demandPsi, safetyMarginPct }) {
  const requiredPressurePsi = roundToTwoDecimals(
    demandPsi * (1 + safetyMarginPct / 100),
  )
  const totalPressurePsi = roundToTwoDecimals(requiredPressurePsi + demandPsi)
  const roundedDemandGpm = roundToTwoDecimals(demandGpm)
  const roundedDemandPsi = roundToTwoDecimals(demandPsi)
  const roundedSafetyMarginPct = roundToTwoDecimals(safetyMarginPct)

  return {
    demandGpm: roundedDemandGpm,
    demandPsi: roundedDemandPsi,
    safetyMarginPct: roundedSafetyMarginPct,
    requiredPressurePsi,
    totalPressurePsi,
    flowRateGpm: roundedDemandGpm,
    pressureDropPsi: roundedDemandPsi,
  }
}
