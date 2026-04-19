"""Phase F — pricing calibration infrastructure tests."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_cal", ROOT / "agents" / "12-quickbid" / "calibration.py",
)
assert _SPEC is not None and _SPEC.loader is not None
CAL = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_cal"] = CAL
_SPEC.loader.exec_module(CAL)


def test_default_rates_are_honestly_uncalibrated() -> None:
    rates = CAL.PricingRates()
    assert rates.calibrated_against_n_bids == 0
    assert rates.mae_percent > 100  # honest default says "not calibrated"


def test_load_rates_returns_defaults_when_no_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(CAL, "CALIBRATION_DIR", tmp_path)
    rates = CAL.load_rates()
    assert isinstance(rates, CAL.PricingRates)
    assert rates.version == 1


def test_save_and_load_rates_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(CAL, "CALIBRATION_DIR", tmp_path)
    rates = CAL.PricingRates(
        version=2, mae_percent=8.5,
        calibrated_against_n_bids=10,
    )
    CAL.save_rates(rates)
    reloaded = CAL.load_rates(version=2)
    assert reloaded.mae_percent == 8.5
    assert reloaded.version == 2


def test_validate_fit_reports_error_per_bid() -> None:
    rates = CAL.PricingRates()
    bids = [
        CAL.HistoricalBid(
            project_id="a", total_sqft=100000,
            hazard_mix={"light": 1.0}, level_count=4,
            actual_total_usd=350000,
        ),
    ]
    result = CAL.validate_fit(bids, rates)
    assert result["count"] == 1
    assert len(result["errors"]) == 1
    assert result["mae_percent"] >= 0


def test_fit_rates_reduces_mae_on_synthetic_corpus() -> None:
    """Given a synthetic corpus where 'actual' totals are generated
    from known rates, the fitter should recover them close enough to
    reduce MAE vs defaults."""
    truth = CAL.PricingRates()
    truth.rate_per_sqft = {"light": 4.00, "ordinary_i": 5.00}
    # Generate 10 synthetic bids using these truth rates
    bids = []
    for i in range(10):
        sqft = 50000 + 10000 * i
        bid = CAL.HistoricalBid(
            project_id=f"syn_{i}", total_sqft=sqft,
            hazard_mix={"light": 0.7, "ordinary_i": 0.3},
            level_count=4, standpipe_count=2, dry_systems=1,
            actual_total_usd=CAL._predict(
                CAL.HistoricalBid(
                    project_id="x", total_sqft=sqft,
                    hazard_mix={"light": 0.7, "ordinary_i": 0.3},
                    level_count=4, standpipe_count=2, dry_systems=1,
                    actual_total_usd=0,
                ),
                truth,
            ),
        )
        bids.append(bid)
    default_rates = CAL.PricingRates()
    default_mae = CAL.validate_fit(bids, default_rates)["mae_percent"]
    fitted = CAL.fit_rates_ols(bids, base=default_rates, iterations=30)
    fitted_mae = CAL.validate_fit(bids, fitted)["mae_percent"]
    assert fitted_mae < default_mae, (
        f"fit did not improve: default={default_mae} fitted={fitted_mae}"
    )
    assert fitted.calibrated_against_n_bids == 10
    assert fitted.mae_percent == pytest.approx(fitted_mae)


def test_fit_rates_empty_corpus_noop() -> None:
    result = CAL.fit_rates_ols([])
    assert isinstance(result, CAL.PricingRates)
    assert result.calibrated_against_n_bids == 0
