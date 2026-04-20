"""Unit tests for the DXF clean-import wizard."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

_SPEC = importlib.util.spec_from_file_location(
    "dxf_clean", ROOT / "agents" / "00-intake" / "dxf_clean.py",
)
assert _SPEC is not None and _SPEC.loader is not None
DC = importlib.util.module_from_spec(_SPEC)
# Register in sys.modules BEFORE exec so dataclass forward refs
# ("CleanReport" self-ref via list[str]) resolve correctly.
sys.modules["dxf_clean"] = DC
_SPEC.loader.exec_module(DC)


@pytest.fixture(scope="module")
def _ezdxf_or_skip():
    if not DC._EZDXF:
        pytest.skip("ezdxf not available")
    import ezdxf
    return ezdxf


def _make_dxf(path: Path, layers: dict[str, int]) -> None:
    """Write a tiny DXF with `layers` = {name: num_lines}."""
    import ezdxf
    doc = ezdxf.new()
    msp = doc.modelspace()
    for name, n in layers.items():
        if name not in doc.layers:
            doc.layers.add(name)
        for i in range(n):
            msp.add_line((i, 0), (i + 1, 0), dxfattribs={"layer": name})
    doc.saveas(str(path))


# ── unit: disposition rules ───────────────────────────────────────

def test_disposition_keeps_walls_and_structure() -> None:
    for name in (
        "A-WALL", "A-WALL-INTR", "S-COLS", "S-BEAM", "S-JOIS",
        "C-GRID", "WALLS", "COLUMN", "BEAM", "DOOR", "WINDOW",
    ):
        assert DC._layer_disposition(name) == "keep", name


def test_disposition_drops_furniture_and_trades() -> None:
    for name in (
        "A-FURN", "FURNITURE", "LANDSCAPE", "PLNT", "A-ANNO-DIMS",
        "HATCH", "TEXT", "NOTES", "M-DUCT", "E-POWR", "P-PLMB",
    ):
        assert DC._layer_disposition(name) == "drop", name


def test_disposition_unknown_layer() -> None:
    assert DC._layer_disposition("CUSTOM_WEIRD") == "unknown"


def test_drop_wins_over_keep_when_both_match() -> None:
    # 'WALL-FURN' matches WALL (keep) but also FURN (drop)
    assert DC._layer_disposition("A-WALL-FURN") == "drop"


# ── integration: real DXF in + out ────────────────────────────────

def test_missing_input_returns_error(tmp_path: Path, _ezdxf_or_skip) -> None:
    r = DC.clean_dxf(tmp_path / "nope.dxf")
    assert r.status == "error"
    assert "missing" in (r.error or "")


def test_unreadable_input_returns_error(tmp_path: Path, _ezdxf_or_skip) -> None:
    bad = tmp_path / "bad.dxf"
    bad.write_text("not a DXF", encoding="utf-8")
    r = DC.clean_dxf(bad)
    assert r.status == "error"


def test_clean_drops_furniture_and_keeps_walls(
    tmp_path: Path, _ezdxf_or_skip,
) -> None:
    src = tmp_path / "source.dxf"
    _make_dxf(src, {
        "A-WALL": 5,
        "A-WALL-FURN": 3,   # drop (FURN in name)
        "S-COLS": 2,
        "A-ANNO-DIMS": 4,   # drop
        "M-DUCT": 6,        # drop (mech)
        "CUSTOM_WEIRD": 1,  # unknown -> keep by default
    })
    r = DC.clean_dxf(src, tmp_path / "cleaned.dxf")
    assert r.status == "ok"
    assert r.output_path.endswith("cleaned.dxf")
    # A-WALL, S-COLS, CUSTOM_WEIRD kept; others dropped
    assert "A-WALL" in r.kept
    assert "S-COLS" in r.kept
    assert "CUSTOM_WEIRD" in r.kept
    assert "A-WALL-FURN" in r.dropped
    assert "A-ANNO-DIMS" in r.dropped
    assert "M-DUCT" in r.dropped
    # Entity count before = 5+3+2+4+6+1 = 21
    # After dropping FURN(3) + DIMS(4) + DUCT(6) = 13 kept
    # (plus the 'CUSTOM_WEIRD' 1) — so 8 kept from listed minus FURN(3)=2+4+6 lost
    assert r.entity_count_before == 21
    # dropped FURN(3) + DIMS(4) + DUCT(6) = 13
    assert r.entity_count_after == 21 - 3 - 4 - 6


def test_drop_unknown_flag(tmp_path: Path, _ezdxf_or_skip) -> None:
    src = tmp_path / "source.dxf"
    _make_dxf(src, {"CUSTOM_WEIRD": 1, "A-WALL": 2})
    r = DC.clean_dxf(src, tmp_path / "cleaned.dxf", drop_unknown=True)
    assert "CUSTOM_WEIRD" in r.dropped
    assert "A-WALL" in r.kept


def test_output_path_defaults_to_clean_suffix(
    tmp_path: Path, _ezdxf_or_skip,
) -> None:
    src = tmp_path / "arch.dxf"
    _make_dxf(src, {"A-WALL": 1})
    r = DC.clean_dxf(src)
    assert r.status == "ok"
    assert r.output_path.endswith("arch-clean.dxf")


def test_layer_0_and_defpoints_always_kept(
    tmp_path: Path, _ezdxf_or_skip,
) -> None:
    src = tmp_path / "z.dxf"
    _make_dxf(src, {"A-ANNO-DIMS": 1})  # drops this one
    r = DC.clean_dxf(src, tmp_path / "c.dxf")
    assert "0" in r.kept
    # Defpoints is created automatically by ezdxf
    assert "Defpoints" in r.kept or "DEFPOINTS" in r.kept
    assert "A-ANNO-DIMS" in r.dropped


def test_freeze_kept_layers_flag_runs_without_error(
    tmp_path: Path, _ezdxf_or_skip,
) -> None:
    src = tmp_path / "s.dxf"
    _make_dxf(src, {"A-WALL": 1, "S-COLS": 1})
    r = DC.clean_dxf(src, tmp_path / "c.dxf", freeze_kept_layers=True)
    assert r.status == "ok"


def test_clean_report_dataclass_exposes_all_fields(
    tmp_path: Path, _ezdxf_or_skip,
) -> None:
    src = tmp_path / "x.dxf"
    _make_dxf(src, {"A-WALL": 1})
    r = DC.clean_dxf(src, tmp_path / "y.dxf")
    for attr in (
        "input_path", "output_path", "total_layers",
        "kept", "dropped", "entity_count_before",
        "entity_count_after", "status",
    ):
        assert hasattr(r, attr)
