export function laborHours(bom, ratesByItem) {
  return bom.reduce((totalHours, lineItem) => {
    const rate = ratesByItem[lineItem.item] ?? 0
    return totalHours + lineItem.qty * rate
  }, 0)
}
