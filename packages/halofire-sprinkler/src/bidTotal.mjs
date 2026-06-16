export function bidTotal({
  materialUsd,
  laborHours,
  laborRateUsd,
  marginPct,
}) {
  const cost = materialUsd + laborHours * laborRateUsd
  const sell = cost * (1 + marginPct / 100)

  return { cost, sell }
}
