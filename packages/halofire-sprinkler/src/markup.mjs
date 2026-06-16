/**
 * Apply a percentage markup to a base cost.
 *
 * Margin is expressed as a percentage, so `20` means 20%.
 */
export function applyMarkup(costUsd, marginPct) {
  return Number((costUsd * (1 + marginPct / 100)).toFixed(2))
}

/**
 * Alias the package's sell-price calculation to the base markup formula.
 */
export function sellPrice(costUsd, marginPct) {
  return applyMarkup(costUsd, marginPct)
}
