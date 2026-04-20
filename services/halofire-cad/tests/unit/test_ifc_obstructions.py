"""Unit tests for the IFC → Obstruction bridge.

We test the contract + dispatch logic rather than full ifcopenshell
round-trip — the IFC schema is enormous and versions differ across
ifcopenshell releases. Real-file integration is covered by the
existing 1881-cooperative E2E pipeline which reads `design.ifc`.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Load arm_over under a canonical name the bridge will also see via
# sys.modules (prevents two divergent Obstruction class definitions).
_AO_CANON = "_hf_arm_over"
if _AO_CANON not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        _AO_CANON,
        ROOT / "agents" / "02-placer" / "arm_over.py",
    )
    assert _spec is not None and _spec.loader is not None
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules[_AO_CANON] = _mod
    _spec.loader.exec_module(_mod)
AO = sys.modules[_AO_CANON]

_IFC_SPEC = importlib.util.spec_from_file_location(
    "_hf_ifc_obs",
    ROOT / "agents" / "02-placer" / "ifc_obstructions.py",
)
assert _IFC_SPEC is not None and _IFC_SPEC.loader is not None
IFCOBS = importlib.util.module_from_spec(_IFC_SPEC)
sys.modules["_hf_ifc_obs"] = IFCOBS
_IFC_SPEC.loader.exec_module(IFCOBS)


# ── fallbacks ─────────────────────────────────────────────────────

def test_missing_file_returns_empty(tmp_path: Path) -> None:
    result = IFCOBS.obstructions_from_ifc(tmp_path / "nope.ifc")
    assert result == []


def test_not_an_ifc_file_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "notifc.ifc"
    p.write_text("this is not an IFC file", encoding="utf-8")
    result = IFCOBS.obstructions_from_ifc(p)
    assert result == []


def test_re_exported_obstruction_is_same_class() -> None:
    """IFCOBS.Obstruction is arm_over.Obstruction — placer can
    consume the bridge's output directly."""
    o = IFCOBS.Obstruction(0.0, 0.0, 1.0, 1.0)
    assert isinstance(o, AO.Obstruction)


def test_default_classes_include_column_and_beam() -> None:
    assert "IfcColumn" in IFCOBS.DEFAULT_CLASSES
    assert "IfcBeam" in IFCOBS.DEFAULT_CLASSES


# ── dispatch via mock ifcopenshell ────────────────────────────────

def _fake_elem(x: float, y: float, z: float,
               xdim: float = 400.0, ydim: float = 400.0) -> MagicMock:
    """An IFC element mock with an ObjectPlacement and rectangular
    extruded body."""
    elem = MagicMock()
    elem.ObjectPlacement = object()
    # Representation → Representations[0].Items[0].SweptArea with
    # RectangleProfileDef-like XDim/YDim.
    profile = MagicMock()
    profile.XDim = xdim
    profile.YDim = ydim
    profile.Radius = None
    item = MagicMock()
    item.SweptArea = profile
    rep = MagicMock()
    rep.Representations = [MagicMock(Items=[item])]
    elem.Representation = rep
    # Stash coords + dims in meters so the test bbox resolver finds
    # them concretely (MagicMock auto-attrs return MagicMocks, never
    # the getattr default).
    elem._coords = (x, y, z)
    elem._xdim_m = xdim / 1000.0
    elem._ydim_m = ydim / 1000.0
    return elem


def _fake_placement(elem):  # noqa: ANN001
    x, y, z = elem._coords
    return [
        [1.0, 0.0, 0.0, x],
        [0.0, 1.0, 0.0, y],
        [0.0, 0.0, 1.0, z],
        [0.0, 0.0, 0.0, 1.0],
    ]


@pytest.fixture
def mocked_ifc(tmp_path: Path):
    """Patch ifcopenshell so obstructions_from_ifc runs without a
    real IFC file."""
    p = tmp_path / "fake.ifc"
    p.write_text("fake", encoding="utf-8")

    fake_model = MagicMock()
    cols = [
        _fake_elem(0.0, 0.0, 0.0),
        _fake_elem(5.0, 5.0, 0.0),
        _fake_elem(10.0, 10.0, 0.0),
    ]
    beam = _fake_elem(2.0, 3.0, 0.0)

    def _by_type(cls):
        if cls == "IfcColumn":
            return cols
        if cls == "IfcBeam":
            return [beam]
        return []

    fake_model.by_type.side_effect = _by_type

    class _Placement:
        @staticmethod
        def get_local_placement(op):  # noqa: ANN001
            # `op` is the ObjectPlacement sentinel; look up whatever
            # element set it via closure.
            # The helper is called with elem.ObjectPlacement, so we
            # need to reach back to the element. Shortcut: walk the
            # cols list and match identity.
            for e in cols + [beam]:
                if e.ObjectPlacement is op:
                    return _fake_placement(e)
            return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

    fake_ifcopenshell = MagicMock()
    fake_ifcopenshell.open.return_value = fake_model
    fake_util_placement = _Placement
    fake_util_shape = MagicMock()

    with patch.dict(sys.modules, {
        "ifcopenshell": fake_ifcopenshell,
        "ifcopenshell.util": MagicMock(),
        "ifcopenshell.util.placement": fake_util_placement,
        "ifcopenshell.util.shape": fake_util_shape,
    }):
        # Force the helper to believe ifcopenshell is available.
        with patch.object(IFCOBS, "_ifcopenshell_available", return_value=True):
            yield p


def _bbox_for_coords(e) -> tuple[float, float, float, float] | None:
    """Test resolver: reads coords + dims off the fake elem, emits a
    bbox centered on (x, y). Returns None for zero-dim elems."""
    x, y, _ = e._coords
    xdim = e._xdim_m  # concrete float set by _fake_elem
    ydim = e._ydim_m
    if xdim <= 0 or ydim <= 0:
        return None
    return (x - xdim / 2, y - ydim / 2, x + xdim / 2, y + ydim / 2)


def _level_for_coords(e, level_m) -> bool:
    if level_m is None:
        return True
    _, _, z = e._coords
    return abs(z - level_m) <= 0.6


def test_three_columns_and_one_beam(mocked_ifc: Path) -> None:
    result = IFCOBS.obstructions_from_ifc(
        mocked_ifc,
        _bbox_resolver=_bbox_for_coords,
        _level_resolver=_level_for_coords,
        _validate_header=False,
    )
    # 3 columns + 1 beam = 4 obstructions (default classes include both)
    assert len(result) == 4
    centers = sorted(
        ((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2) for o in result
    )
    assert centers[0] == pytest.approx((0.0, 0.0), abs=0.01)
    assert centers[-1] == pytest.approx((10.0, 10.0), abs=0.01)


def test_classes_filter_to_only_columns(mocked_ifc: Path) -> None:
    result = IFCOBS.obstructions_from_ifc(
        mocked_ifc, classes=("IfcColumn",),
        _bbox_resolver=_bbox_for_coords,
        _level_resolver=_level_for_coords,
        _validate_header=False,
    )
    assert len(result) == 3


def test_level_filter_matches_within_tolerance(mocked_ifc: Path) -> None:
    at_0 = IFCOBS.obstructions_from_ifc(
        mocked_ifc, level_elevation_m=0.0,
        _bbox_resolver=_bbox_for_coords,
        _level_resolver=_level_for_coords,
        _validate_header=False,
    )
    assert len(at_0) == 4
    at_10 = IFCOBS.obstructions_from_ifc(
        mocked_ifc, level_elevation_m=10.0,
        _bbox_resolver=_bbox_for_coords,
        _level_resolver=_level_for_coords,
        _validate_header=False,
    )
    assert at_10 == []


def test_obstructions_feed_arm_over(mocked_ifc: Path) -> None:
    """End-to-end: bridge output is directly consumable by the
    placer's shift_for_obstructions."""
    obs = IFCOBS.obstructions_from_ifc(
        mocked_ifc, classes=("IfcColumn",),
        _bbox_resolver=_bbox_for_coords,
        _level_resolver=_level_for_coords,
        _validate_header=False,
    )
    # Head placed inside an expanded buffer must be shifted out.
    # First column is at (0, 0) with a 0.4 m bbox → clearance 0.3
    # expands to 1.0 m square. Place head at (0.3, 0).
    r = AO.shift_for_obstructions(0.3, 0.0, obs, clearance_m=0.3)
    if r.shifted:
        buf = obs[0].expanded(0.3)
        assert not buf.contains(r.x, r.y)


def test_degenerate_bbox_rejected(tmp_path: Path) -> None:
    """An element whose resolver returns None (zero-area) is skipped."""
    p = tmp_path / "fake.ifc"
    p.write_text("fake", encoding="utf-8")
    elem = _fake_elem(0.0, 0.0, 0.0, xdim=0.0, ydim=0.0)
    elem._xdim_m = 0.0
    elem._ydim_m = 0.0
    fake_model = MagicMock()
    fake_model.by_type.side_effect = lambda c: [elem] if c == "IfcColumn" else []
    fake_ifc = MagicMock()
    fake_ifc.open.return_value = fake_model

    with patch.dict(sys.modules, {"ifcopenshell": fake_ifc}), \
         patch.object(IFCOBS, "_ifcopenshell_available", return_value=True):
        result = IFCOBS.obstructions_from_ifc(
            p, classes=("IfcColumn",),
            _bbox_resolver=_bbox_for_coords,
            _level_resolver=_level_for_coords,
        )
    assert result == []
