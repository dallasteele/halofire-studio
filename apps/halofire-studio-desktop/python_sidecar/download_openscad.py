"""Download + vendor OpenSCAD binary for Tauri externalBin.

Tauri's bundler expects a sidecar binary at:
    src-tauri/bin/openscad-<target-triple>[.exe]

This script:
  1. Detects the current target triple (or takes --target).
  2. Loads the pinned URL + SHA256 from openscad-checksums.json.
  3. Downloads the installer/archive (zip/dmg/AppImage/exe).
  4. Verifies SHA256 (unless --skip-verify).
  5. Extracts the raw executable.
  6. Copies to src-tauri/bin/openscad-<triple>[.exe].
  7. Skips work if the target already exists AND matches the pinned checksum.

Run:
    python download_openscad.py                # current platform
    python download_openscad.py --target x86_64-pc-windows-msvc
    python download_openscad.py --dry-run      # no network, no writes
    python download_openscad.py --skip-verify  # placeholder sha256 OK

Does NOT commit binaries to git — see .gitignore.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Dict, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
DESKTOP_ROOT = SCRIPT_DIR.parent
BIN_DIR = DESKTOP_ROOT / "src-tauri" / "bin"
MANIFEST_PATH = SCRIPT_DIR / "openscad-checksums.json"

PLACEHOLDER_SHA = "PLACEHOLDER_VERIFY_BEFORE_RELEASE"


def detect_target_triple() -> str:
    """Map the current platform/arch to a Rust target triple."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        return "x86_64-pc-windows-msvc"
    if system == "darwin":
        if machine in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    if system == "linux":
        return "x86_64-unknown-linux-gnu"
    raise RuntimeError(f"Unsupported platform: {system}/{machine}")


def load_manifest(path: Path = MANIFEST_PATH) -> Dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def target_binary_path(triple: str, bin_dir: Path = BIN_DIR) -> Path:
    """Return the Tauri-expected sidecar path for this triple."""
    ext = ".exe" if "windows" in triple else ""
    return bin_dir / f"openscad-{triple}{ext}"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path) -> None:
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "halofire-studio-fetch/1.0"})
    with urllib.request.urlopen(req) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def _extract_from_zip(archive: Path, inner_path: str, out_path: Path) -> None:
    with zipfile.ZipFile(archive) as zf:
        candidates = [n for n in zf.namelist() if n.endswith(inner_path)]
        if not candidates:
            raise RuntimeError(f"{inner_path} not found in {archive.name}")
        with zf.open(candidates[0]) as src, out_path.open("wb") as dst:
            shutil.copyfileobj(src, dst)


def _extract_from_dmg(archive: Path, inner_path: str, out_path: Path) -> None:
    # hdiutil is macOS-only. On other OSes, fail with a clear message.
    if platform.system() != "Darwin":
        raise RuntimeError(
            "Cannot extract .dmg on non-macOS host; run this script on macOS "
            "or vendor the binary manually."
        )
    with tempfile.TemporaryDirectory() as td:
        mount = Path(td) / "mnt"
        mount.mkdir()
        subprocess.run(
            ["hdiutil", "attach", str(archive), "-mountpoint", str(mount), "-nobrowse", "-quiet"],
            check=True,
        )
        try:
            src = mount / inner_path
            if not src.exists():
                raise RuntimeError(f"{inner_path} not found in mounted dmg")
            shutil.copy2(src, out_path)
        finally:
            subprocess.run(["hdiutil", "detach", str(mount), "-quiet"], check=False)


def _copy_exe_installer(archive: Path, out_path: Path) -> None:
    # Windows: the .exe installer itself is not the binary we want, but
    # OpenSCAD also publishes a portable zip. For now we document and copy
    # the installer as-is — the user must run it to produce openscad.exe,
    # or switch the manifest to the portable .zip URL.
    shutil.copy2(archive, out_path)


def extract_binary(archive: Path, inner_path: str, out_path: Path) -> None:
    suffix = archive.suffix.lower()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if suffix == ".zip":
        _extract_from_zip(archive, inner_path, out_path)
    elif suffix == ".dmg":
        _extract_from_dmg(archive, inner_path, out_path)
    elif suffix == ".appimage":
        shutil.copy2(archive, out_path)
        out_path.chmod(0o755)
    elif suffix == ".exe":
        _copy_exe_installer(archive, out_path)
    else:
        raise RuntimeError(f"Unknown archive type: {archive.name}")


def fetch_for_triple(
    triple: str,
    manifest: Dict,
    bin_dir: Path = BIN_DIR,
    skip_verify: bool = False,
    dry_run: bool = False,
) -> Path:
    entry = manifest["checksums"].get(triple)
    if not entry:
        raise RuntimeError(f"No manifest entry for triple: {triple}")

    url = entry["url"]
    expected_sha = entry["sha256"]
    inner = entry["binary_path_in_archive"]
    out_path = target_binary_path(triple, bin_dir)

    if expected_sha == PLACEHOLDER_SHA and not skip_verify:
        raise RuntimeError(
            f"SHA256 for {triple} is a placeholder. Pin the real checksum "
            f"in {MANIFEST_PATH.name} before release, or pass --skip-verify "
            "for local dev."
        )

    if out_path.exists() and expected_sha != PLACEHOLDER_SHA:
        if sha256_of(out_path) == expected_sha:
            print(f"[skip] {out_path.name} already present and matches checksum")
            return out_path

    if dry_run:
        print(f"[dry-run] would fetch {url} -> {out_path}")
        return out_path

    bin_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        archive_name = url.rsplit("/", 1)[-1]
        archive = tdp / archive_name
        _download(url, archive)

        actual = sha256_of(archive)
        if expected_sha == PLACEHOLDER_SHA:
            print(f"[warn] placeholder sha — downloaded archive actual sha256: {actual}")
        elif actual != expected_sha:
            raise RuntimeError(
                f"Checksum mismatch for {archive_name}:\n"
                f"  expected {expected_sha}\n"
                f"  got      {actual}"
            )

        extract_binary(archive, inner, out_path)
        if "windows" not in triple:
            out_path.chmod(0o755)
        print(f"[ok] wrote {out_path}")
    return out_path


def main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(description="Vendor OpenSCAD binary for Tauri externalBin.")
    p.add_argument("--target", help="Target triple (default: detect current platform)")
    p.add_argument("--skip-verify", action="store_true", help="Allow placeholder SHA256")
    p.add_argument("--dry-run", action="store_true", help="No network, no writes")
    p.add_argument("--all", action="store_true", help="Fetch every triple in the manifest")
    args = p.parse_args(argv)

    manifest = load_manifest()
    print(f"OpenSCAD {manifest.get('openscad_version', '?')} — source: {manifest.get('source', '?')}")

    if args.all:
        triples = list(manifest["checksums"].keys())
    else:
        triples = [args.target or detect_target_triple()]

    for t in triples:
        print(f"==> {t}")
        fetch_for_triple(
            t,
            manifest,
            skip_verify=args.skip_verify,
            dry_run=args.dry_run,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
