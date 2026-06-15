export function flowGpm(K, pressurePsi) {
  return K * Math.sqrt(pressurePsi)
}

export function pressureForFlow(K, gpm) {
  return (gpm / K) ** 2
}
