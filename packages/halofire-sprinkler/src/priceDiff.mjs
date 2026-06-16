/**
 * Diff two normalized price sheets by SKU.
 *
 * Each row is expected to already be normalized to:
 *   { sku: string, priceUsd: number }
 */
export function diffPriceSheets(oldRows, newRows) {
  const oldBySku = new Map(oldRows.map((row) => [row.sku, row]))
  const newBySku = new Map(newRows.map((row) => [row.sku, row]))

  const changed = []
  const added = []
  const removed = []
  const pctChangeBySku = {}

  for (const row of newRows) {
    const previous = oldBySku.get(row.sku)

    if (!previous) {
      added.push(row)
      continue
    }

    if (previous.priceUsd !== row.priceUsd) {
      changed.push(row)
      pctChangeBySku[row.sku] = ((row.priceUsd - previous.priceUsd) / previous.priceUsd) * 100
    }
  }

  for (const row of oldRows) {
    if (!newBySku.has(row.sku)) {
      removed.push(row)
    }
  }

  return {
    changed,
    added,
    removed,
    pctChangeBySku,
  }
}
