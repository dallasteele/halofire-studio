function coerceString(value) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function normalizeUnit(unit) {
  const rawUnit = coerceString(unit)
  if (!rawUnit) {
    return 'EA'
  }

  const normalized = rawUnit.toUpperCase()
  if (normalized === 'EACH' || normalized === 'EA.' || normalized === 'EACH.') {
    return 'EA'
  }

  return normalized
}

function normalizePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  const raw = coerceString(value)
  if (!raw) {
    return 0
  }

  const sanitized = raw.replace(/[$,\s]/g, '')
  const parsed = Number.parseFloat(sanitized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizePriceSheet(rows) {
  if (!Array.isArray(rows)) {
    return []
  }

  return rows.map((row) => ({
    sku: coerceString(row?.sku),
    desc: coerceString(row?.desc),
    unit: normalizeUnit(row?.unit),
    priceUsd: normalizePrice(row?.priceUsd ?? row?.price),
  }))
}
