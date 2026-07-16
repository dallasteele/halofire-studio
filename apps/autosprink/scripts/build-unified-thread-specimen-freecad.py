"""Build and audit a source-bound .375-16 UNC 2A/2B fit specimen.

This is a standards test coupon, not a manufacturer part. It deliberately
cannot supply manufacturer identity, material, coating, load rating, listing,
or installation instructions. OpenCascade creates actual helical BREP solids;
the receipt records topology, dimensions, and independently computed common
volume for the assembled maximum-material specimens.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import FreeCAD as App
import Part


INCH_MM = 25.4
SOURCE_SHA256 = "116D4FBD0C009B3B18C20487B3FAC87B69E17BEA808C7AC9CD140C8C4450720D"
PITCH_IN = 1.0 / 16.0
PITCH_MM = PITCH_IN * INCH_MM
MALE_LENGTH_IN = 0.75
FEMALE_LENGTH_IN = 0.50
ASSEMBLY_OFFSET_IN = 0.125  # two complete pitches; preserves helical phase

LIMITS = {
    "external2A": {
        "majorDiameterMaxIn": 0.3737,
        "pitchDiameterMaxIn": 0.3331,
        "minorDiameterIn": 0.2970,
    },
    "internal2B": {
        "minorDiameterMinIn": 0.3070,
        "pitchDiameterMinIn": 0.3344,
        "majorDiameterMinIn": 0.3750,
    },
}


def mm(value_in: float) -> float:
    return value_in * INCH_MM


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def helical_triangle(
    *,
    minor_diameter_in: float,
    pitch_diameter_in: float,
    major_diameter_in: float,
    length_in: float,
):
    """Sweep a closed 60-degree-style ridge/groove cutter along a true helix."""
    minor_radius = mm(minor_diameter_in) / 2.0
    pitch_radius = mm(pitch_diameter_in) / 2.0
    major_radius = mm(major_diameter_in) / 2.0
    length = mm(length_in)
    helix = Part.makeHelix(PITCH_MM, length, pitch_radius, 0.0, False)
    spine = Part.Wire(helix.Edges)

    # At the helix start, the tangent has circumferential and axial components.
    # radial_u and flank_v span its normal plane. This avoids a skewed section.
    radial_u = App.Vector(1.0, 0.0, 0.0)
    tangent = App.Vector(0.0, 2.0 * math.pi * pitch_radius, PITCH_MM)
    tangent.normalize()
    flank_v = tangent.cross(radial_u)
    flank_v.normalize()
    # A Unified thread has a 60-degree included profile. The axial half-width
    # of a sharp V at the minor-radius root is radial depth / tan(60 deg).
    # Published crest/root limits truncate the V; using each class's published
    # maximum-material major/minor radii keeps this specimen source-derived.
    half_width = (major_radius - minor_radius) / math.tan(math.radians(60.0))

    root = App.Vector(minor_radius, 0.0, 0.0)
    crest = App.Vector(major_radius, 0.0, 0.0)
    p1 = root.add(flank_v.multiply(half_width))
    p2 = crest
    p3 = root.sub(flank_v.multiply(half_width))
    profile = Part.Wire([
        Part.makeLine(p1, p2),
        Part.makeLine(p2, p3),
        Part.makeLine(p3, p1),
    ])
    return spine.makePipeShell([profile], True, False)


def build_shapes():
    male_length = mm(MALE_LENGTH_IN)
    female_length = mm(FEMALE_LENGTH_IN)
    male = LIMITS["external2A"]
    female = LIMITS["internal2B"]

    male_core = Part.makeCylinder(mm(male["minorDiameterIn"]) / 2.0, male_length)
    male_ridge = helical_triangle(
        minor_diameter_in=male["minorDiameterIn"],
        pitch_diameter_in=male["pitchDiameterMaxIn"],
        major_diameter_in=male["majorDiameterMaxIn"],
        length_in=MALE_LENGTH_IN,
    )
    male_shape = male_core.fuse(male_ridge).removeSplitter()

    female_outer = Part.makeCylinder(mm(0.625) / 2.0, female_length)
    female_bore = Part.makeCylinder(mm(female["minorDiameterMinIn"]) / 2.0, female_length)
    female_blank = female_outer.cut(female_bore)
    # Build the internal groove from the already-created 2A ridge, expanding
    # radial coordinates by the published 2B-min / 2A-max pitch-diameter ratio.
    # The resulting groove has exactly .3344 at the pitch cylinder; the
    # internal major root is slightly above the table's .3750 minimum, which is
    # permitted because Table 2.21 specifies only a minimum for that diameter.
    # The separate .3070 bore enforces the 2B maximum-material minor diameter.
    radial_scale = female["pitchDiameterMinIn"] / male["pitchDiameterMaxIn"]
    transform = App.Matrix()
    transform.A11 = radial_scale
    transform.A22 = radial_scale
    female_groove = male_ridge.transformGeometry(transform)
    female_shape = female_blank.cut(female_groove).removeSplitter()

    female_installed = female_shape.copy()
    female_installed.translate(App.Vector(0.0, 0.0, mm(ASSEMBLY_OFFSET_IN)))
    common = male_shape.common(female_installed)
    return male_shape, female_shape, female_installed, common


def add_feature(doc, name: str, label: str, shape, color):
    obj = doc.addObject("PartDesign::Feature", name)
    obj.Label = label
    obj.Shape = shape
    if obj.ViewObject is not None:
        obj.ViewObject.ShapeColor = color
    return obj


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    male_shape, female_shape, female_installed, common = build_shapes()
    doc = App.newDocument("UnifiedThread37516UNCSpecimen")
    male_obj = add_feature(doc, "Male2A", ".375-16 UNC-2A maximum-material specimen", male_shape, (0.82, 0.30, 0.12))
    female_obj = add_feature(doc, "Female2B", ".375-16 UNC-2B maximum-material specimen", female_installed, (0.12, 0.38, 0.82))
    doc.recompute()

    fcstd_path = output_dir / "unified-thread-375-16-unc-specimen.FCStd"
    male_step = output_dir / "unified-thread-375-16-unc-2a-male.step"
    female_step = output_dir / "unified-thread-375-16-unc-2b-female.step"
    assembly_step = output_dir / "unified-thread-375-16-unc-fit-assembly.step"
    male_stl = output_dir / "unified-thread-375-16-unc-2a-male.stl"
    female_stl = output_dir / "unified-thread-375-16-unc-2b-female.stl"
    doc.saveAs(str(fcstd_path))
    Part.export([male_obj], str(male_step))
    standalone_female = doc.addObject("PartDesign::Feature", "Female2BStandalone")
    standalone_female.Shape = female_shape
    Part.export([standalone_female], str(female_step))
    Part.export([male_obj, female_obj], str(assembly_step))
    Part.export([male_obj], str(male_stl))
    Part.export([standalone_female], str(female_stl))

    outputs = [fcstd_path, male_step, female_step, assembly_step, male_stl, female_stl]
    pitch_clearance = (
        LIMITS["internal2B"]["pitchDiameterMinIn"]
        - LIMITS["external2A"]["pitchDiameterMaxIn"]
    )
    receipt = {
        "artifactType": "halofire.opencascade-unified-thread-specimen-receipt.v1",
        "scope": "standards-specimen-only",
        "source": {
            "pdfSha256": SOURCE_SHA256,
            "physicalPdfPage": 61,
            "printedPage": "2.27",
            "table": "2.21",
        },
        "kernel": {
            "name": "OpenCascade via FreeCAD",
            "freecadVersion": App.Version(),
            "modelUnits": "millimeter",
            "inputUnits": "inch",
        },
        "thread": {
            "designation": ".375-16 UNC 2A/2B",
            "tpi": 16,
            "pitchIn": PITCH_IN,
            "leadIn": PITCH_IN,
            "hand": "right",
            "limits": LIMITS,
            "minimumPitchDiameterClearanceIn": pitch_clearance,
            "minimumPitchRadiusClearanceIn": pitch_clearance / 2.0,
            "modeledHelicalSolid": True,
        },
        "topology": {
            "maleSolidCount": len(male_shape.Solids),
            "femaleSolidCount": len(female_shape.Solids),
            "maleShellCount": len(male_shape.Shells),
            "femaleShellCount": len(female_shape.Shells),
            "maleVolumeMm3": male_shape.Volume,
            "femaleVolumeMm3": female_shape.Volume,
            "assembledCommonVolumeMm3": common.Volume,
            "assembledInterferenceToleranceMm3": 1e-5,
            "assembledInterferenceFree": common.Volume <= 1e-5,
        },
        "placement": {
            "femaleOffsetIn": ASSEMBLY_OFFSET_IN,
            "femaleOffsetPitchCount": ASSEMBLY_OFFSET_IN / PITCH_IN,
            "helicalPhasePreserved": True,
        },
        "outputs": [
            {"file": path.name, "byteLength": path.stat().st_size, "sha256": sha256(path)}
            for path in outputs
        ],
        "releasePolicy": {
            "manufacturerPartEligible": False,
            "projectAssemblyEligible": False,
            "newHopePartEligible": False,
            "reason": "A standards fit specimen is not manufacturer part geometry or a listed support assembly.",
        },
    }
    receipt_path = output_dir / "unified-thread-375-16-unc-kernel-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    App.closeDocument(doc.Name)
    return 0 if receipt["topology"]["assembledInterferenceFree"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
