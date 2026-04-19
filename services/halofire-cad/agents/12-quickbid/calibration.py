"""Phase F — pricing calibration infrastructure.

We can't calibrate without historical bids (F.1) — those live in
Halo's private data. This module provides the infrastructure so when
the bid corpus arrives, regression is a drop-in fit.

Shape:
  - `PricingRates` pydantic model (versioned, persistent)
  - `load_rates()` / `save_rates()` helpers (JSON on disk)
  - `fit_rates_ols(bids)` — ordinary least squares over historical
    corpus
  - `validate_fit(bids, rates)` — held-out MAE check
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


CALIBRATION_DIR = (
    Path(__file__).resolve().parents[2] / "rates"
)
CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)


class PricingRates(BaseModel):
    """Versioned pricing inputs for the quickbid estimator.

    Bumped whenever Halo updates wholesale-to-bid conversion. Stored
    under `services/halofire-cad/rates/v{N}.json`.
    """
    version: int = 1
    calibrated_against_n_bids: int = 0
    mae_percent: float = 999.0  # honest: not calibrated yet
    rate_per_sqft: dict[str, float] = Field(default_factory=lambda: {
        "light": 2.95, "ordinary_i": 3.60, "ordinary_ii": 4.25,
        "extra_i": 6.50, "extra_ii": 8.75, "residential": 2.70,
    })
    addon_standpipe_usd: float = 12500.0
    addon_dry_system_usd: float = 35000.0
    addon_fdc_usd: float = 2850.0
    addon_permit_usd: float = 3250.0
    addon_mobilization_usd: float = 650.0
    mobilizations_per_bid: int = 16
    tax_rate: float = 0.072


class HistoricalBid(BaseModel):
    """One past Halo bid, extracted from proposal.xlsx.

    Used as training/test data for the calibrator.
    """
    project_id: str
    total_sqft: float
    hazard_mix: dict[str, float]
    level_count: int
    standpipe_count: int = 0
    dry_systems: int = 0
    actual_total_usd: float


# ── Persistence ────────────────────────────────────────────────────


def load_rates(version: Optional[int] = None) -> PricingRates:
    """Load the requested version (or newest) from disk.

    If none on disk, return built-in defaults.
    """
    files = sorted(CALIBRATION_DIR.glob("v*.json"))
    if not files:
        return PricingRates()
    if version is None:
        target = files[-1]
    else:
        target = CALIBRATION_DIR / f"v{version}.json"
    if not target.exists():
        return PricingRates()
    return PricingRates.model_validate_json(
        target.read_text(encoding="utf-8"),
    )


def save_rates(rates: PricingRates) -> Path:
    target = CALIBRATION_DIR / f"v{rates.version}.json"
    target.write_text(
        rates.model_dump_json(indent=2), encoding="utf-8",
    )
    return target


# ── Fitting ────────────────────────────────────────────────────────


def _predict(bid: HistoricalBid, rates: PricingRates) -> float:
    materials_labor = sum(
        bid.total_sqft * frac * rates.rate_per_sqft.get(h, 3.0)
        for h, frac in bid.hazard_mix.items()
    )
    subtotal = (
        materials_labor
        + bid.standpipe_count * rates.addon_standpipe_usd
        + bid.dry_systems * rates.addon_dry_system_usd
        + rates.addon_fdc_usd
        + rates.addon_permit_usd
        + rates.mobilizations_per_bid * rates.addon_mobilization_usd
    )
    return subtotal * (1 + rates.tax_rate)


def validate_fit(
    bids: list[HistoricalBid], rates: PricingRates,
) -> dict[str, float]:
    """Return MAE% + per-bid absolute errors."""
    if not bids:
        return {"mae_percent": 0.0, "count": 0, "errors": []}
    errors: list[float] = []
    for b in bids:
        predicted = _predict(b, rates)
        err_pct = abs(predicted - b.actual_total_usd) / b.actual_total_usd * 100
        errors.append(err_pct)
    mae = sum(errors) / len(errors)
    return {"mae_percent": mae, "count": len(bids), "errors": errors}


def fit_rates_ols(
    bids: list[HistoricalBid], base: Optional[PricingRates] = None,
    iterations: int = 20, lr: float = 0.01,
) -> PricingRates:
    """Minimal gradient-descent fit of `rate_per_sqft` against bids.

    Not a full regression — tunes the per-hazard $/sqft to minimize
    total MAE. Add-on constants kept fixed. For real calibration on
    the actual bid corpus, replace with scipy.optimize.least_squares.
    """
    rates = (base or PricingRates()).model_copy()
    if not bids:
        return rates
    # Ensure we track every hazard in the corpus
    for b in bids:
        for h in b.hazard_mix:
            rates.rate_per_sqft.setdefault(h, 3.0)

    for _ in range(iterations):
        # Compute gradient of MAE wrt each hazard rate
        grad: dict[str, float] = {h: 0.0 for h in rates.rate_per_sqft}
        for b in bids:
            predicted = _predict(b, rates)
            diff = predicted - b.actual_total_usd  # >0 = overestimate
            sign = 1 if diff >= 0 else -1
            for h, frac in b.hazard_mix.items():
                # ∂predicted/∂rate_h = total_sqft * frac * (1 + tax)
                grad[h] += sign * b.total_sqft * frac * (1 + rates.tax_rate)
        # Step
        n = len(bids)
        for h in grad:
            rates.rate_per_sqft[h] = max(
                0.1, rates.rate_per_sqft[h] - lr * grad[h] / n / 10000,
            )

    rates.calibrated_against_n_bids = len(bids)
    res = validate_fit(bids, rates)
    rates.mae_percent = res["mae_percent"]
    return rates
