const PRECISION = 1e12

export function laborHours(items = {}, rates = {}) {
  const total = Object.entries(items).reduce((sum, [key, qty]) => {
    const quantity = Number.isFinite(qty) ? qty : 0
    const rate = Number.isFinite(rates[key]) ? rates[key] : 0
    return sum + quantity * rate
  }, 0)

  return Math.round(total * PRECISION) / PRECISION
}
