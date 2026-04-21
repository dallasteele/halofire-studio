"""halofire DWG export — R9.2.

Pragmatic path: write a DXF first (via ``agent.export_dxf``), then
convert to DWG with ODA File Converter if it's on PATH. If ODA is
not installed, we emit a clearly-marked placeholder file whose first
bytes are a fake DWG magic (AC1024 = AutoCAD 2010) so downstream
pipeline steps can round-trip without crashing, and a human gets a
plain-text note explaining how to install the real converter.

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

# AutoCAD 2010 DWG magic (6 bytes + 5 null padding). Picked because
# AC1024 is what ODA emits for our target ACAD2018 output too (the
# version string goes in the first 6 bytes regardless).
_DWG_PLACEHOLDER_MAGIC = b"AC1024\x00\x00\x00\x00\x00"


def _oda_binary() -> str | None:
    return (
        shutil.which("ODAFileConverter")
        or shutil.which("oda_fc")
        or shutil.which("ODAFileConverter.exe")
    )


def export_dwg_from_dxf(dxf_path: Path, dwg_path: Path) -> Path:
    """Convert DXF → DWG via ODA File Converter if available.

    When ODA is not on PATH, write a placeholder DWG (starting with
    the AC1024 magic bytes) and log a warning. Returns ``dwg_path``
    either way. Never raises for the missing-tool case — the
    pipeline should keep flowing.
    """
    oda = _oda_binary()
    dwg_path.parent.mkdir(parents=True, exist_ok=True)

    if not oda:
        log.warning(
            "ODA File Converter not on PATH; writing placeholder DWG at %s. "
            "Install from https://www.opendesign.com/guestfiles/oda_file_converter "
            "for real DWG output.",
            dwg_path,
        )
        dwg_path.write_bytes(
            _DWG_PLACEHOLDER_MAGIC
            + b"HALOFIRE STUDIO DWG PLACEHOLDER\n"
            + f"DXF source: {dxf_path.name}\n".encode("utf-8")
            + b"Install ODA File Converter "
              b"(https://www.opendesign.com/guestfiles/oda_file_converter) "
              b"for real DWG output.\n"
        )
        return dwg_path

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
