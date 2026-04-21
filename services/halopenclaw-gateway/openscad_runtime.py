"""Real OpenSCAD runtime — step 4 of REAL_PLAN_FORK_PASCAL.md.

Detects an OpenSCAD binary, spawns it with parameters, caches the
output GLB by a content-hash key so repeat renders are O(1), and
falls back to the Trimesh approximation when OpenSCAD is unavailable.

Usage from the gateway:

    from .openscad_runtime import OpenScadRuntime
    rt = OpenScadRuntime()
    glb_path = rt.render(
        scad_file="packages/halofire-catalog/authoring/scad/valve_globe.scad",
        params={"size_in": 4},
    )

Cache dir defaults to ``/tmp/halofire-openscad-cache`` on POSIX and
``%LOCALAPPDATA%/halofire-openscad-cache`` on Windows. One GLB per
(scad content hash + sorted params hash) key. Files are content-
addressable so concurrent renderers don't stomp each other.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

# Windows installs OpenSCAD here by default; POSIX users get it on PATH.
_WINDOWS_HINTS = [
    r"C:\Program Files\OpenSCAD\openscad.exe",
    r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
    r"C:\Program Files\OpenSCAD\openscad.com",
]
_POSIX_HINTS = [
    "/usr/bin/openscad",
    "/usr/local/bin/openscad",
    "/opt/homebrew/bin/openscad",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
]


def _cache_root() -> Path:
    env = os.environ.get("HALOFIRE_OPENSCAD_CACHE")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
        return Path(base) / "halofire-openscad-cache"
    return Path(tempfile.gettempdir()) / "halofire-openscad-cache"


def detect_openscad() -> str | None:
    """Return the first OpenSCAD binary we can find.

    Resolution order:
      1. ``OPENSCAD_PATH`` env var (explicit override)
      2. ``shutil.which("openscad")`` — works when it's on PATH
      3. Platform install hints (Windows Program Files, POSIX /usr/*)

    Returns None if none of the candidates exist or are executable.
    """
    explicit = os.environ.get("OPENSCAD_PATH")
    if explicit and Path(explicit).is_file():
        return explicit
    path_hit = shutil.which("openscad")
    if path_hit:
        return path_hit
    hints = _WINDOWS_HINTS if sys.platform == "win32" else _POSIX_HINTS
    for hint in hints:
        if Path(hint).is_file():
            return hint
    return None


@dataclass(frozen=True)
class RenderResult:
    """Output of a render call.

    ``path`` is the GLB on disk. ``engine`` is ``"openscad"`` when the
    real binary produced it, ``"trimesh"`` for the fallback, ``"cache"``
    for a cache hit. ``cache_hit`` is True for any hit (including the
    post-trimesh cache). ``stderr`` carries whatever the binary said
    so callers can log it.
    """

    path: Path
    engine: str
    cache_hit: bool
    stderr: str = ""


class OpenScadRuntime:
    """Per-process OpenSCAD runtime with a keyed GLB cache."""

    def __init__(
        self,
        openscad_bin: str | None = None,
        cache_dir: Path | None = None,
    ) -> None:
        self._bin = openscad_bin or detect_openscad()
        self._cache_dir = cache_dir or _cache_root()
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # ── public ────────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        """True when a usable OpenSCAD binary was located."""
        return self._bin is not None

    def cache_key(self, scad_path: Path, params: dict[str, float | int | str]) -> str:
        """Content-addressable key for (scad file + parameter set)."""
        h = hashlib.sha256()
        h.update(scad_path.read_bytes())
        # Sort parameters so {"a":1,"b":2} and {"b":2,"a":1} share cache.
        h.update(json.dumps(params, sort_keys=True, default=str).encode())
        return h.hexdigest()[:24]

    def cache_path(self, key: str, ext: str = "glb") -> Path:
        return self._cache_dir / f"{key}.{ext}"

    def render(
        self,
        scad_file: str | Path,
        params: dict[str, float | int | str] | None = None,
        output_format: str = "glb",
        timeout_s: float = 60.0,
    ) -> RenderResult:
        """Render a SCAD file to GLB (or STL/OFF).

        When OpenSCAD is unavailable or fails, returns a RenderResult
        with ``engine="trimesh"`` pointing to the pre-baked Trimesh
        output in ``packages/halofire-catalog/assets/glb/`` — callers
        still get a usable GLB.
        """
        scad_path = Path(scad_file).resolve()
        if not scad_path.is_file():
            raise FileNotFoundError(scad_path)
        params = dict(params or {})
        key = self.cache_key(scad_path, params)
        out = self.cache_path(key, ext=output_format)

        # Cache hit: just return it.
        if out.is_file() and out.stat().st_size > 0:
            return RenderResult(path=out, engine="cache", cache_hit=True)

        # No OpenSCAD → fall back to the pre-baked Trimesh asset if
        # one exists with a convention name (SM_<Stem>.glb).
        if not self.available:
            fallback = self._trimesh_fallback(scad_path)
            if fallback is not None:
                # Copy into cache so future hits don't re-look up.
                try:
                    shutil.copy2(fallback, out)
                except OSError:
                    pass
                return RenderResult(
                    path=out if out.is_file() else fallback,
                    engine="trimesh",
                    cache_hit=False,
                    stderr="openscad binary not found; used trimesh prebake",
                )
            raise RuntimeError(
                f"openscad unavailable and no trimesh prebake for {scad_path.name}",
            )

        # Real render — spawn the binary with -D key=value args.
        cmd: list[str] = [self._bin, str(scad_path), "-o", str(out)]  # type: ignore[list-item]
        for k, v in params.items():
            if isinstance(v, str):
                cmd.extend(["-D", f'{k}="{v}"'])
            else:
                cmd.extend(["-D", f"{k}={v}"])

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout_s,
                text=True,
                check=False,
            )
        except subprocess.TimeoutExpired as e:
            log.error("openscad timeout %ds on %s", timeout_s, scad_path.name)
            raise RuntimeError(f"openscad timeout after {timeout_s}s") from e

        if proc.returncode != 0 or not out.is_file():
            log.warning(
                "openscad exited %s on %s: %s",
                proc.returncode, scad_path.name, proc.stderr[:200],
            )
            # Fall back so a broken SCAD doesn't 500 the request.
            fallback = self._trimesh_fallback(scad_path)
            if fallback is not None:
                return RenderResult(
                    path=fallback,
                    engine="trimesh",
                    cache_hit=False,
                    stderr=proc.stderr,
                )
            raise RuntimeError(
                f"openscad failed (rc={proc.returncode}): {proc.stderr[:200]}",
            )

        return RenderResult(
            path=out,
            engine="openscad",
            cache_hit=False,
            stderr=proc.stderr,
        )

    def clear_cache(self) -> int:
        """Wipe the cache directory. Returns number of files removed."""
        if not self._cache_dir.is_dir():
            return 0
        n = 0
        for p in self._cache_dir.iterdir():
            if p.is_file():
                p.unlink()
                n += 1
        return n

    # ── internals ─────────────────────────────────────────────────

    def _trimesh_fallback(self, scad_path: Path) -> Path | None:
        """Look up a pre-baked Trimesh GLB that matches this SCAD.

        Convention: every SCAD file in
        ``packages/halofire-catalog/authoring/scad/`` has a matching
        pre-rendered GLB at
        ``packages/halofire-catalog/assets/glb/SM_<CamelCase>.glb``.
        We don't know the exact CamelCase mapping at runtime (it's
        chosen per-renderer in render_phase44_assets.py), so we do a
        case-insensitive contains-match on the stem.
        """
        repo_root = _find_repo_root(scad_path)
        if repo_root is None:
            return None
        glb_dir = (
            repo_root / "packages" / "halofire-catalog" / "assets" / "glb"
        )
        if not glb_dir.is_dir():
            return None
        stem = scad_path.stem.replace("_", "").lower()
        # Strip leading type prefixes like "head_" / "valve_" so
        # valve_globe.scad matches SM_Valve_Globe_2in.glb.
        candidates = sorted(glb_dir.glob("SM_*.glb"))
        best: tuple[int, Path] | None = None
        for cand in candidates:
            norm = cand.stem.replace("_", "").lower()
            # Token overlap score
            stem_tokens = set(
                t for t in scad_path.stem.lower().split("_") if len(t) > 2
            )
            cand_tokens = set(
                t.lower() for t in cand.stem.split("_") if len(t) > 2
            )
            overlap = len(stem_tokens & cand_tokens)
            if stem in norm or norm in stem or overlap >= 2:
                score = max(overlap, 10 if stem in norm else 1)
                if best is None or score > best[0]:
                    best = (score, cand)
        return best[1] if best else None


def _find_repo_root(start: Path) -> Path | None:
    """Walk up looking for the workspace root (has packages/ + apps/)."""
    cur = start.resolve()
    for _ in range(20):
        if (cur / "packages").is_dir() and (cur / "apps").is_dir():
            return cur
        if cur.parent == cur:
            return None
        cur = cur.parent
    return None
