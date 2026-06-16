export function pipeStockAndCouplings(totalFt, stockFt) {
  if (!(totalFt > 0) || !(stockFt > 0)) {
    return { sticks: 0, couplings: 0 }
  }

  const sticks = Math.ceil(totalFt / stockFt)

  return {
    sticks,
    couplings: Math.max(0, sticks - 1),
  }
}
