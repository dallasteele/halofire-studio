export function labor(items = []) {
  const laborHours = round3(items.reduce((sum, item) => {
    const qty = positiveOrZero(item?.quantity);
    const perUnit = positiveOrZero(item?.laborHoursPerUnit);
    return sum + (qty * perUnit);
  }, 0));

  return {
    laborHours,
  };
}

function positiveOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round3(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
