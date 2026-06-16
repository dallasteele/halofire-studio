export function bidRiskFlags({ sellUsd, benchmarkUsdPerHead, heads }) {
  const benchmarkTotal = benchmarkUsdPerHead * heads

  return {
    underbid: sellUsd < benchmarkTotal,
    overbid: sellUsd > benchmarkTotal,
    deltaPct: ((sellUsd - benchmarkTotal) / benchmarkTotal) * 100,
  }
}
