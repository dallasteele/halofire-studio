"""V2 Phase 3.2 — Hydralist (.hlf) export unit tests."""
from __future__ import annotations

import datetime as _dt
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from cad.schema import BomRow  # noqa: E402

_SPEC = importlib.util.spec_from_file_location(
    "hf_hl", ROOT / "agents" / "06-bom" / "hydralist.py",
)
assert _SPEC is not None and _SPEC.loader is not None
HL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(HL)


def _row(sku: str, qty: float, unit: str, cost: float,
         extended: float | None = None, **flags) -> BomRow:
    return BomRow(
        sku=sku,
        description=sku.replace("_", " "),
        qty=qty,
        unit=unit,
        unit_cost_usd=cost,
        extended_usd=extended if extended is not None else qty * cost,
        **flags,
    )


def test_format_hydralist_emits_header_and_footer() -> None:
    rows = [_row("SM_Head_Pendant_Standard_K56", 128, "ea", 22.5, 3888.0)]
    now = _dt.datetime(2026, 4, 20, 12, 0, 0)
    out = HL.format_hydralist(rows, project_id="test-proj", now=now)
    lines = out.strip().splitlines()
    assert lines[0] == "#HYDRALIST|v1.0|test-proj|2026-04-20T12:00:00"
    assert lines[1] == "LINE|PART_NO|DESC|QTY|UOM|UNIT_COST|EXTENDED|MFG|FAB|NOTES"
    assert lines[-1] == "#END|line_count=1|total_usd=3888.00"


def test_format_hydralist_pipe_footage_is_FT_uom() -> None:
    rows = [_row("pipe_sch10_1in_ft", 842, "ft", 2.40, 2020.8)]
    out = HL.format_hydralist(rows, project_id="p", now=_dt.datetime(2026, 1, 1))
    body = out.splitlines()[2]
    cols = body.split("|")
    assert cols[4] == "FT"
    assert cols[1] == "pipe_sch10_1in_ft"
    assert cols[3] == "842"


def test_format_hydralist_counts_ea_before_ft() -> None:
    rows = [
        _row("pipe_sch10_1in_ft", 100, "ft", 2.40, 240.0),
        _row("SM_Head_Pendant_Standard_K56", 10, "ea", 22.5, 225.0),
    ]
    out = HL.format_hydralist(rows, project_id="p", now=_dt.datetime(2026, 1, 1))
    body = out.strip().splitlines()[2:-1]
    # First emitted row is EA (head), second is FT (pipe).
    assert body[0].split("|")[4] == "EA"
    assert body[1].split("|")[4] == "FT"


def test_format_hydralist_fab_flag_for_small_pipe() -> None:
    rows = [_row("pipe_sch10_1in_ft", 100, "ft", 2.40, 240.0, do_not_fab=True)]
    out = HL.format_hydralist(rows, project_id="p", now=_dt.datetime(2026, 1, 1))
    body = out.splitlines()[2]
    cols = body.split("|")
    assert cols[8] == "N"  # FAB flag
    assert "cut-in-field" in cols[9]


def test_format_hydralist_flags_stale_and_missing_prices() -> None:
    rows = [
        _row("pipe_sch10_4in_ft", 50, "ft", 0.0, 0.0, price_missing=True),
        _row("SM_Head_Pendant_Standard_K56", 10, "ea", 22.5, 225.0,
             price_stale=True),
    ]
    out = HL.format_hydralist(rows, project_id="p", now=_dt.datetime(2026, 1, 1))
    assert "price_missing" in out
    assert "price_stale" in out


def test_format_hydralist_escapes_pipe_in_description() -> None:
    rows = [BomRow(
        sku="weird_sku", description="has | pipe in desc",
        qty=1, unit="ea", unit_cost_usd=1.0, extended_usd=1.0,
    )]
    out = HL.format_hydralist(rows, project_id="p", now=_dt.datetime(2026, 1, 1))
    # Description pipe replaced with slash so it doesn't break parsing.
    assert "has / pipe in desc" in out
    # Each data row has exactly 10 fields → 9 delimiters. Header has 9,
    # HYDRALIST stamp has 3, END has 2 → 23 pipes for 1 row is correct;
    # key check: description itself no longer contains a raw pipe.
    assert "| pipe in desc" not in out


def test_write_hydralist_creates_file(tmp_path: Path) -> None:
    rows = [_row("SM_Head_Pendant_Standard_K56", 5, "ea", 22.5, 112.5)]
    out_file = tmp_path / "bid" / "supplier.hlf"
    p = HL.write_hydralist(rows, "p", out_file, now=_dt.datetime(2026, 1, 1))
    assert p.exists()
    assert p.read_text().startswith("#HYDRALIST|v1.0|p|")


def test_manufacturer_mapping() -> None:
    assert HL._mfg_for(_row("SM_Head_Pendant_Standard_K56", 1, "ea", 1, 1)) == "TYCO"
    assert HL._mfg_for(_row("VK100_pendant", 1, "ea", 1, 1)) == "VIKING"
    assert HL._mfg_for(_row("reliable_model_F1", 1, "ea", 1, 1)) == "RELIABLE"
    assert HL._mfg_for(_row("pipe_sch10_2in_ft", 1, "ft", 1, 1)) == "ALLIED"
    assert HL._mfg_for(_row("valve_gate_4in", 1, "ea", 1, 1)) == "NIBCO"
    assert HL._mfg_for(_row("hanger_clevis_1in", 1, "ea", 1, 1)) == "TOLCO"
    assert HL._mfg_for(_row("unknown_thing", 1, "ea", 1, 1)) == ""


def test_total_matches_sum_of_extended() -> None:
    rows = [
        _row("A", 1, "ea", 100.0, 100.0),
        _row("B", 1, "ea", 200.0, 200.0),
        _row("C", 1, "ea", 300.0, 300.0),
    ]
    out = HL.format_hydralist(rows, "p", now=_dt.datetime(2026, 1, 1))
    footer = out.strip().splitlines()[-1]
    assert "total_usd=600.00" in footer
    assert "line_count=3" in footer
