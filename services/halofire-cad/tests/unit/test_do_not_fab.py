"""Unit test — BOM flags <3in pipes as DO_NOT_FAB (AutoSprink convention)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

_spec = importlib.util.spec_from_file_location(
    "bom_agent", _ROOT / "agents" / "06-bom" / "agent.py",
)
assert _spec is not None and _spec.loader is not None
BOM = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BOM)


def test_is_do_not_fab_true_for_small_pipe() -> None:
    assert BOM._is_do_not_fab("pipe_sch10_1in_ft") is True
    assert BOM._is_do_not_fab("pipe_sch10_1_5in_ft") is True
    assert BOM._is_do_not_fab("pipe_sch10_2_5in_ft") is True
    assert BOM._is_do_not_fab("pipe_sch40_2in_ft") is True


def test_is_do_not_fab_false_for_fab_size_and_up() -> None:
    assert BOM._is_do_not_fab("pipe_sch10_3in_ft") is False
    assert BOM._is_do_not_fab("pipe_sch10_4in_ft") is False
    assert BOM._is_do_not_fab("pipe_sch40_6in_ft") is False


def test_is_do_not_fab_false_for_non_pipe_sku() -> None:
    assert BOM._is_do_not_fab("SM_Head_Pendant_Standard_K56") is False
    assert BOM._is_do_not_fab("valve_gate_4in") is False
    assert BOM._is_do_not_fab("hanger_clevis_2in") is False


def test_threshold_is_strict_less_than_3() -> None:
    # Exactly 3" is NOT do-not-fab (fab threshold is strict <)
    assert BOM._is_do_not_fab("pipe_sch10_3in_ft") is False
    # 2.5" IS do-not-fab
    assert BOM._is_do_not_fab("pipe_sch10_2_5in_ft") is True


def test_malformed_sku_does_not_raise() -> None:
    # Regex match with a non-numeric group must not raise
    assert BOM._is_do_not_fab("pipe_sch10_badin_ft") is False
    assert BOM._is_do_not_fab("") is False
