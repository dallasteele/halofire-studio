export function applyMarkup(costUsd, marginPct) {
  return costUsd * (1 + marginPct / 100)
}

export function sellPrice(costUsd, marginPct) {
  return applyMarkup(costUsd, marginPct)
}
