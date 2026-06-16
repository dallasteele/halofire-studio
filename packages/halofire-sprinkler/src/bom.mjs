export function bomFromCounts({ pipeFt, fittings, heads, hangers }) {
  return [
    { item: 'pipe', qty: pipeFt, unit: 'ft' },
    { item: 'fittings', qty: fittings, unit: 'ea' },
    { item: 'heads', qty: heads, unit: 'ea' },
    { item: 'hangers', qty: hangers, unit: 'ea' },
  ]
}
