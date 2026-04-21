"""R9.3 — Canonical node-type → DXF layer mapping (Python side).

Mirrors ``packages/hf-core/src/sheets/layer-mapping.ts``. Keep the
two tables (``NODE_TYPE_TO_DXF_LAYER``, ``LAYER_ACI_COLOR``) and
``pipe_layer_for_role`` / ``pipeLayerForRole`` byte-for-byte in
sync — any drift here without a matching edit on the TS side is a
CI parity failure. See blueprint 07 §10 and 11 §6 for contract.
"""
from __future__ import annotations

# Pascal node.type → DXF layer on export.
NODE_TYPE_TO_DXF_LAYER: dict[str, str] = {
    "sprinkler_head": "FP-HEADS",
    "pipe": "FP-PIPES",  # refined by role at runtime
    "fitting": "FP-FITTINGS",
    "valve": "FP-VALVES",
    "hanger": "FP-HANGERS",
    "device": "FP-DEVICES",
    "fdc": "FP-FDC",
    "riser_assembly": "FP-RISER",
    "remote_area": "FP-REMOTE-AREA",
    "obstruction": "OBS",
    "wall": "0-ARCH",
    "slab": "0-ARCH-SLAB",
    "ceiling": "0-ARCH-CEIL",
    "door": "0-ARCH-DOOR",
    "window": "0-ARCH-WINDOW",
    "item": "FP-ITEMS",
    "sheet": "0-TITLE",
}


def pipe_layer_for_role(role: str | None) -> str:
    """Refine ``FP-PIPES`` to a role-specific layer."""
    if role == "drop":
        return "FP-PIPES-DROP"
    if role == "branch":
        return "FP-PIPES-BRANCH"
    if role in ("cross_main", "feed_main", "main"):
        return "FP-PIPES-MAIN"
    if role in ("riser", "riser_nipple"):
        return "FP-PIPES-RISER"
    if role == "standpipe":
        return "FP-STANDPIPE"
    return "FP-PIPES"


# Layer → ezdxf ACI color index. Used by dxf_export.py to set layer
# colors consistently with the TS-side expectations and with
# downstream tooling (plotters, Bluebeam).
LAYER_ACI_COLOR: dict[str, int] = {
    "FP-HEADS": 1,          # red
    "FP-PIPES": 1,
    "FP-PIPES-MAIN": 1,
    "FP-PIPES-BRANCH": 1,
    "FP-PIPES-DROP": 1,
    "FP-PIPES-RISER": 1,
    "FP-FITTINGS": 1,
    "FP-VALVES": 6,         # magenta
    "FP-HANGERS": 3,        # green
    "FP-DEVICES": 4,        # cyan
    "FP-FDC": 1,
    "FP-STANDPIPE": 1,
    "0-ARCH": 8,            # grey
    "0-ARCH-SLAB": 8,
    "0-ARCH-CEIL": 8,
    "0-ARCH-DOOR": 8,
    "0-ARCH-WINDOW": 5,     # blue
    "OBS": 7,               # white/black
    "0-TITLE": 7,
    "FP-DIMS": 2,           # yellow
    "FP-ANNOT": 2,
}


__all__ = [
    "NODE_TYPE_TO_DXF_LAYER",
    "LAYER_ACI_COLOR",
    "pipe_layer_for_role",
]
