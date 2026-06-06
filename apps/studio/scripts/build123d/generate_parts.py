#!/usr/bin/env python3
"""T45 — build123d parametric-STEP generator (Tier-2 DIMENSIONED parts).

Generates a SMALL set of fire-sprinkler parts as REAL parametric CAD solids
using build123d, each driven by an EXPLICIT, DETERMINISTIC dimension spec
(NPT size, body length, deflector dia, k-factor label). For every part it
writes a real STEP file plus a small ASCII-STL preview into:

    apps/studio/public/parts/build123d/<key>.step
    apps/studio/public/parts/build123d/<key>.stl

HONESTY (hard, fail-closed):
  - These are REAL parametric CAD dimensions. They are NOT manufacturer-exact,
    NOT AHJ / PE / permit / code-compliant. Tier = "dimensioned_parametric".
  - If build123d (and its OCP/OCCT backend) cannot be imported, this script
    generates NOTHING and exits 0 with build123d_available:false. It NEVER
    fabricates a fake STEP file.
  - Dimensions are hard-coded constants — NO randomness, fully reproducible.

Output (stdout, last line): a single JSON object:
    {"generated": [...], "skipped": [...], "build123d_available": <bool>}
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


# Output dir: <repo>/apps/studio/public/parts/build123d
# This file lives at apps/studio/scripts/build123d/generate_parts.py, so the
# studio app root is three levels up from this file's parent.
SCRIPT_DIR = Path(__file__).resolve().parent
STUDIO_ROOT = SCRIPT_DIR.parent.parent  # apps/studio
OUT_DIR = STUDIO_ROOT / "public" / "parts" / "build123d"


@dataclass(frozen=True)
class PartSpec:
    """An explicit, deterministic dimension spec for one parametric part.

    All linear dimensions are millimetres. These are honest parametric design
    intents, NOT manufacturer-measured values.
    """

    key: str
    name: str
    product_code: str
    # Dimension fields surfaced into the manifest "dimensions" block.
    npt_size: str
    body_length_mm: float
    deflector_dia_mm: float
    k_factor_label: str
    # The geometry builder (closure over build123d, injected at run time).
    build: Callable[[Any], Any] = field(repr=False, default=None)  # type: ignore[assignment]

    def dimensions(self) -> dict[str, Any]:
        return {
            "nptSize": self.npt_size,
            "bodyLengthMm": self.body_length_mm,
            "deflectorDiaMm": self.deflector_dia_mm,
            "kFactorLabel": self.k_factor_label,
            "units": "mm",
        }


def _build_pendent_head(b: Any, spec: PartSpec) -> Any:
    """Pendent sprinkler head: hex body + threaded boss stub + deflector disc.

    Deterministic massing of a 1/2" NPT pendent head. Real dimensioned solid
    (not a manufacturer scan): a hex prism body, a cylindrical thread boss on
    top, and a thin deflector disc below the frame arms (modelled as a disc).
    """
    Part = b.Part
    Pos = b.Pos
    extrude = b.extrude
    RegularPolygon = b.RegularPolygon
    Circle = b.Circle
    Plane = b.Plane

    hex_across_flats = 19.0  # 3/4" wrench flats, mm
    hex_radius = hex_across_flats / math.sqrt(3.0)  # circumradius from AF
    body_len = spec.body_length_mm
    boss_dia = 21.0  # ~1/2" NPT boss OD
    boss_len = 12.0
    deflector_dia = spec.deflector_dia_mm
    deflector_thk = 1.6

    # Hex body, centred on origin, extruded along +Z.
    body = extrude(RegularPolygon(radius=hex_radius, side_count=6), amount=body_len)
    # Thread boss on top (+Z end of the body).
    boss = Pos(0, 0, body_len) * extrude(Circle(radius=boss_dia / 2.0), amount=boss_len)
    # Deflector disc below the body (-Z), where water sprays downward.
    deflector = Pos(0, 0, -deflector_thk) * extrude(
        Circle(radius=deflector_dia / 2.0), amount=deflector_thk
    )
    solid = body + boss + deflector
    return solid


def _build_elbow_90(b: Any, spec: PartSpec) -> Any:
    """90-degree elbow: two cylindrical legs meeting at the origin, plus a
    sphere at the joint to round the corner. NPT-sized bore is omitted (massing
    of the outer envelope only — honest dimensioned proxy of an elbow)."""
    Part = b.Part
    Pos = b.Pos
    Rot = b.Rot
    extrude = b.extrude
    Circle = b.Circle

    od = 26.7  # 3/4" pipe OD-ish envelope, mm
    leg = spec.body_length_mm  # centre-to-end leg length

    # Leg 1 along +Z.
    leg_z = extrude(Circle(radius=od / 2.0), amount=leg)
    # Leg 2 along +X: build a +Z cylinder then rotate it about Y by 90deg.
    leg_x = Rot(0, 90, 0) * extrude(Circle(radius=od / 2.0), amount=leg)
    # Rounded joint at the origin.
    joint = b.Sphere(radius=od / 2.0)
    return leg_z + leg_x + joint


def _build_tee(b: Any, spec: PartSpec) -> Any:
    """Tee fitting: a straight run (along Z) with a perpendicular branch (along
    X), joined by a sphere at the origin. Outer-envelope massing, dimensioned."""
    Rot = b.Rot
    extrude = b.extrude
    Circle = b.Circle

    od = 33.4  # 1" pipe OD-ish envelope, mm
    half_run = spec.body_length_mm  # half the straight-run length
    branch = spec.body_length_mm * 0.75

    # Straight run: a cylinder centred on origin along Z (build +Z then shift).
    run_pos = b.Pos(0, 0, -half_run) * extrude(Circle(radius=od / 2.0), amount=half_run * 2)
    # Branch along +X.
    branch_x = Rot(0, 90, 0) * extrude(Circle(radius=od / 2.0), amount=branch)
    joint = b.Sphere(radius=od / 2.0)
    return run_pos + branch_x + joint


def specs() -> list[PartSpec]:
    """The deterministic catalogue of parts this generator emits.

    Keys match catalog part keys so applyBuild123dParts can upgrade them.
    """
    return [
        PartSpec(
            key="head_pendent",
            name="Pendent Head (parametric)",
            product_code="B123D-HEAD-PEND-050",
            npt_size='1/2"',
            body_length_mm=18.0,
            deflector_dia_mm=28.0,
            k_factor_label="K5.6",
            build=_build_pendent_head,
        ),
        PartSpec(
            key="fitting_elbow_90",
            name="90 Elbow (parametric)",
            product_code="B123D-ELL90-075",
            npt_size='3/4"',
            body_length_mm=30.0,
            deflector_dia_mm=0.0,
            k_factor_label="n/a",
            build=_build_elbow_90,
        ),
        PartSpec(
            key="fitting_tee",
            name="Tee (parametric)",
            product_code="B123D-TEE-100",
            npt_size='1"',
            body_length_mm=32.0,
            deflector_dia_mm=0.0,
            k_factor_label="n/a",
            build=_build_tee,
        ),
    ]


def _import_build123d() -> Any | None:
    """Import build123d, returning the module or None if unavailable.

    Importing build123d also pulls in the OCP/OCCT backend; an ImportError or
    any backend init failure means we MUST generate nothing (honest).
    """
    try:
        import build123d as b  # type: ignore

        # Touch a couple of symbols we rely on so a partial install fails here.
        _ = (b.Part, b.extrude, b.Circle, b.Sphere, b.export_step)
        return b
    except Exception:  # noqa: BLE001 - any failure => unavailable
        return None


def _normalize_step(path: Path) -> None:
    """Rewrite the STEP FILE_NAME timestamp to a FIXED epoch so the file is
    byte-deterministic across runs (OCCT stamps the current time, which would
    otherwise change the sha256 on every generation). Geometry is untouched."""
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except Exception:  # noqa: BLE001
        return
    import re

    # FILE_NAME('name','YYYY-MM-DDThh:mm:ss', ...). Replace the 2nd arg's ISO
    # timestamp with a fixed sentinel so regenerated files hash identically.
    fixed = "1970-01-01T00:00:00"
    text = re.sub(
        r"(FILE_NAME\('[^']*',')[^']*(',)",
        lambda m: m.group(1) + fixed + m.group(2),
        text,
        count=1,
    )
    path.write_text(text, encoding="utf-8")


def _export_stl(b: Any, solid: Any, path: Path) -> None:
    """Write an ASCII-STL preview. Uses build123d's exporter if present,
    else a Mesher fallback. STL preview is best-effort; STEP is the contract."""
    try:
        b.export_stl(solid, str(path), ascii_format=True)
        return
    except Exception:  # noqa: BLE001
        pass
    # Fallback: lib3mf-backed Mesher can also emit STL via build123d.
    try:
        from build123d import Mesher  # type: ignore

        mesher = Mesher()
        mesher.add_shape(solid)
        mesher.write(str(path))
    except Exception:  # noqa: BLE001
        # Preview is optional; swallow so STEP generation still counts.
        pass


def main() -> int:
    b = _import_build123d()
    if b is None:
        # HONEST: no build123d -> generate NOTHING, empty manifest upstream.
        print(json.dumps({
            "generated": [],
            "skipped": [s.key for s in specs()],
            "build123d_available": False,
        }))
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    generated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for spec in specs():
        step_path = OUT_DIR / f"{spec.key}.step"
        stl_path = OUT_DIR / f"{spec.key}.stl"
        try:
            solid = spec.build(b, spec)
            # Real STEP export — this is the dimensioned-parametric contract.
            b.export_step(solid, str(step_path))
            if not step_path.exists() or step_path.stat().st_size == 0:
                raise RuntimeError("STEP export produced no file")
            _normalize_step(step_path)
            _export_stl(b, solid, stl_path)
            generated.append({
                "key": spec.key,
                "name": spec.name,
                "productCode": spec.product_code,
                "step": str(step_path.relative_to(STUDIO_ROOT / "public")).replace(os.sep, "/"),
                "stl": (
                    str(stl_path.relative_to(STUDIO_ROOT / "public")).replace(os.sep, "/")
                    if stl_path.exists() else None
                ),
                "dimensions": spec.dimensions(),
            })
        except Exception as exc:  # noqa: BLE001
            # A failed part is skipped honestly; never write a fake STEP.
            if step_path.exists() and step_path.stat().st_size == 0:
                try:
                    step_path.unlink()
                except OSError:
                    pass
            skipped.append({"key": spec.key, "error": str(exc)})

    print(json.dumps({
        "generated": generated,
        "skipped": skipped,
        "build123d_available": True,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
