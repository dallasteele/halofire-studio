export function priceNormalize(totalCost) {
  return Math.round((positiveOrZero(totalCost) + Number.EPSILON) * 100) / 100;
}

function positiveOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
