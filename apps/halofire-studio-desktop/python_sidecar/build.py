"""Build the halofire-pipeline PyInstaller binary.

Output lands at src-tauri/bin/halofire-pipeline-<target-triple>.exe
matching Tauri's externalBin naming convention. Run this before
`tauri build`.

Usage:
    python apps/halofire-studio-desktop/python_sidecar/build.py
"""
from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path


def _target_triple() -> str:
    """Match Tauri's target-triple convention."""
    os_name = platform.system().lower()
    arch = platform.machine().lower()
    if os_name == "windows":
        if arch in ("amd64", "x86_64"):
            return "x86_64-pc-windows-msvc"
        if arch in ("arm64", "aarch64"):
            return "aarch64-pc-windows-msvc"
    if os_name == "darwin":
        if arch in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    if os_name == "linux":
        if arch in ("aarch64", "arm64"):
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"
    raise RuntimeError(f"unknown platform: {os_name} {arch}")


def main() -> int:
    here = Path(__file__).resolve().parent
    repo = here.parent.parent.parent
    entry = here / "halofire_pipeline_entry.py"
    assert entry.is_file(), entry

    bin_dir = here.parent / "src-tauri" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    triple = _target_triple()
    name = f"halofire-pipeline-{triple}"
    if platform.system().lower() == "windows":
        final = bin_dir / f"{name}.exe"
    else:
        final = bin_dir / name

    # Let PyInstaller pull the halofire-cad source tree into the
    # bundled exe so the orchestrator import works at runtime.
    hfcad = repo / "services" / "halofire-cad"
    print(f"Bundling halofire-cad from: {hfcad}", file=sys.stderr)

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--name", name,
        "--distpath", str(bin_dir),
        "--workpath", str(bin_dir / "_work"),
        "--specpath", str(bin_dir / "_spec"),
        # Bundle the pipeline code tree so importlib can find it.
        "--add-data", f"{hfcad}{'/' if not sys.platform.startswith('win') else chr(92)}*{':' if not sys.platform.startswith('win') else ';'}halofire-cad",
        # Minimal hidden imports — PyInstaller's static scanner
        # misses lazy-imported agent modules. Extend as needed.
        "--hidden-import", "pdfplumber",
        "--hidden-import", "shapely",
        "--hidden-import", "ezdxf",
        "--hidden-import", "pydantic",
        "--hidden-import", "duckdb",
        str(entry),
    ]
    print("$", " ".join(cmd), file=sys.stderr)
    rc = subprocess.call(cmd)
    if rc != 0:
        print("pyinstaller failed", file=sys.stderr)
        return rc

    # Clean up temp dirs to keep the repo tidy.
    for d in (bin_dir / "_work", bin_dir / "_spec"):
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)

    print(f"OK — built {final}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
