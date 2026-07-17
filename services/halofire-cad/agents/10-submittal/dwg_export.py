"""halofire DWG export — R9.2.

Pragmatic path: write a DXF first (via ``agent.export_dxf``), then
convert to DWG with ODA File Converter if it is on PATH. If ODA is
not installed, export fails explicitly. A text placeholder with a
forged DWG header is unsafe because downstream manifests and users
can mistake it for a usable CAD deliverable.

We deliberately avoid libredwg on Windows — it's fragile there and
ships no usable prebuilt wheels as of 2026-04.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design  # noqa: E402

log = logging.getLogger("submittal.dwg")

def _oda_binary() -> str | None:
    return (
        shutil.which("ODAFileConverter")
        or shutil.which("oda_fc")
        or shutil.which("ODAFileConverter.exe")
    )


def export_dwg_from_dxf(dxf_path: Path, dwg_path: Path) -> Path:
    """Convert DXF → DWG via ODA File Converter if available.

    When ODA is not on PATH, remove any stale DWG and raise. The caller
    records ``dwg_error`` while retaining the valid DXF deliverable.
    """
    oda = _oda_binary()
    dwg_path.parent.mkdir(parents=True, exist_ok=True)

    if not oda:
        if dwg_path.is_file():
            dwg_path.unlink()
        raise FileNotFoundError(
            "ODA File Converter not on PATH; no DWG was emitted. "
            "Install it from https://www.opendesign.com/guestfiles/"
            "oda_file_converter or use the validated DXF deliverable."
        )

    in_dir = dxf_path.parent
    tmp_dir = dwg_path.parent / "_oda_tmp"
    tmp_dir.mkdir(exist_ok=True)
    try:
        result = subprocess.run(
            [
                oda, str(in_dir), str(tmp_dir),
                "ACAD2018", "DWG", "0", "1", dxf_path.name,
            ],
            capture_output=True, timeout=60,
        )
        converted = tmp_dir / dxf_path.with_suffix(".dwg").name
        if converted.exists():
            shutil.move(str(converted), str(dwg_path))
        else:
            raise RuntimeError(
                f"ODA conversion produced no output: "
                f"{result.stderr.decode(errors='replace')[:200]}"
            )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return dwg_path


def export_dwg(design: Design, out_path: Path) -> Path:
    """Full Design → DXF → DWG pipeline.

    The DXF side-product lands next to the DWG (same stem, .dxf
    extension) so submittal bundles always ship both formats.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_hf_submittal_agent", Path(__file__).with_name("agent.py"),
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    dxf_tmp = out_path.with_suffix(".dxf")
    mod.export_dxf(design, dxf_tmp)
    return export_dwg_from_dxf(dxf_tmp, out_path)


__all__ = ["export_dwg", "export_dwg_from_dxf"]
