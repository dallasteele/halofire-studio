"""Unit tests for the LandScout-pattern catalog crawler.

Network-free: all tests work against canned HTML/PDF payloads so
CI doesn't depend on manufacturer sites being up.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import importlib.util as _ilu
import sys as _sys
_HERE = Path(__file__).resolve().parent
_spec = _ilu.spec_from_file_location("crawler_mod", _HERE / "crawler.py")
_mod = _ilu.module_from_spec(_spec)
_sys.modules["crawler_mod"] = _mod
_spec.loader.exec_module(_mod)
SPRINKLER_HEAD_TARGETS = _mod.SPRINKLER_HEAD_TARGETS
_extract_reliable_pendant = _mod._extract_reliable_pendant
_extract_tyco_pendant = _mod._extract_tyco_pendant
_extract_viking_pendant = _mod._extract_viking_pendant


def test_target_set_covers_three_manufacturers() -> None:
    """V2 Phase 4.3 says we ship sprinkler-head targets for at least
    three big manufacturers on day 1."""
    mfrs = {t.manufacturer for t in SPRINKLER_HEAD_TARGETS}
    assert mfrs >= {"tyco", "viking", "reliable"}


def test_tyco_extractor_pulls_sku_and_k_factor() -> None:
    """A real Tyco TFP datasheet snippet must yield a spec dict
    with the right SKU prefix + numeric K-factor."""
    raw = """
    Datasheet TFP312 — Standard Response Pendent Sprinkler
    K-Factor: 5.6 (metric K=80.6)
    Temperature Rating: 155°F
    """
    spec = _extract_tyco_pendant(raw)
    assert spec is not None
    assert spec["sku"] == "TYCO-TFP312"
    assert spec["k_factor"] == 5.6
    assert spec["category"] == "sprinkler_head_pendant"


def test_viking_extractor_pulls_vk_sku() -> None:
    raw = "Model VK102 K = 5.6 Quick Response"
    spec = _extract_viking_pendant(raw)
    assert spec is not None
    assert spec["sku"] == "VIKING-VK102"
    assert spec["k_factor"] == 5.6


def test_reliable_extractor_pulls_model_id() -> None:
    raw = "Model F1FR56 K-factor: 5.6 Listed for residential use."
    spec = _extract_reliable_pendant(raw)
    assert spec is not None
    assert spec["sku"] == "RELIABLE-F1FR56"
    assert spec["k_factor"] == 5.6


def test_extractors_return_none_on_garbage() -> None:
    """Don't write a catalog entry if we can't pull both SKU + K."""
    assert _extract_tyco_pendant("hello world") is None
    assert _extract_viking_pendant("garbage") is None
    assert _extract_reliable_pendant("nope") is None
