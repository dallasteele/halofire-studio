"""halofire submittal agent — IFC + DXF + GLB exports.

- IFC export via IfcOpenShell: emits IfcSprinkler + IfcPipeSegment
  entities as a subset IFC 4 model the GC's coordination team ingests.
- DXF export via ezdxf: AutoSprink-compatible layer names for
  architects/sprinkler contractors who still work in AutoCAD.
- GLB export via trimesh: pipe cylinders + head spheres merged into a
  single glTF the web bid viewer + Wade's iPad viewer can open.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design  # noqa: E402
from cad.logging import get_logger, warn_swallowed  # noqa: E402
from cad.exceptions import DXFExportError, IFCExportError, GLBExportError  # noqa: E402

log = get_logger("submittal")


# Industry pipe-size color convention (AutoSprink standard)
PIPE_COLOR_BY_SIZE = {
    1.0:  (255, 255, 0),    # yellow
    1.25: (255, 0, 255),    # magenta
    1.5:  (0, 255, 255),    # cyan
    2.0:  (0, 102, 255),    # blue
    2.5:  (0, 192, 64),     # green
    3.0:  (232, 67, 45),    # red
    4.0:  (255, 255, 255),  # white (heavy)
}


def _layer_name_for_pipe(size_in: float) -> str:
    s = str(size_in).replace(".", "-")
    return f"FP-PIPE-{s}"


# ── DXF export ──────────────────────────────────────────────────────

def export_dxf(design: Design, out_path: Path) -> str:
    """Emit an AutoSprink-style DXF. One file per design; heads and
    pipes go to industry-standard layers with industry colors.
    """
    import ezdxf
    from ezdxf.colors import RGB

    doc = ezdxf.new(dxfversion="R2018")
    msp = doc.modelspace()

    # Layer setup with industry colors
    layers = {
        "FP-HEADS": (232, 67, 45),
        "FP-RISER": (255, 255, 255),
        "FP-HANGERS": (128, 128, 128),
        "FP-FDC": (232, 67, 45),
    }
    for size, color in PIPE_COLOR_BY_SIZE.items():
        layers[_layer_name_for_pipe(size)] = color
    for name, (r, g, b) in layers.items():
        lay = doc.layers.add(name)
        lay.rgb = (r, g, b)

    # Heads
    for system in design.systems:
        for h in system.heads:
            x, y, _ = h.position_m
            # 4" diameter in drawing units — meters so 0.1 ≈ 10 cm marker
            msp.add_circle((x, y), 0.1, dxfattribs={"layer": "FP-HEADS"})

    # Pipes — one polyline per segment, colored by size
    for system in design.systems:
        for s in system.pipes:
            layer = _layer_name_for_pipe(s.size_in)
            msp.add_lwpolyline(
                [(s.start_m[0], s.start_m[1]),
                 (s.end_m[0], s.end_m[1])],
                dxfattribs={"layer": layer},
            )

    # Risers
    for system in design.systems:
        r = system.riser
        msp.add_circle(
            (r.position_m[0], r.position_m[1]), 0.15,
            dxfattribs={"layer": "FP-RISER"},
        )
        msp.add_text(
            r.id, height=0.25, dxfattribs={"layer": "FP-RISER"},
        ).set_placement((r.position_m[0] + 0.3, r.position_m[1]))

    # Hangers
    for system in design.systems:
        for hg in system.hangers:
            msp.add_point(
                (hg.position_m[0], hg.position_m[1]),
                dxfattribs={"layer": "FP-HANGERS"},
            )

    doc.saveas(out_path)
    return str(out_path)


# ── GLB export ──────────────────────────────────────────────────────

def export_glb(design: Design, out_path: Path) -> str:
    """Emit a glTF-2 binary (.glb) with pipe cylinders + head spheres.

    The web bid viewer and Wade's iPad AR viewer (future) both load
    this file. Pipes colored per industry convention.
    """
    import trimesh
    import numpy as np

    meshes: list = []

    # Heads as red spheres
    head_mat = trimesh.visual.material.PBRMaterial(
        baseColorFactor=(0.91, 0.26, 0.18, 1.0),
        emissiveFactor=(0.2, 0.05, 0.03),
    )
    for system in design.systems:
        for h in system.heads:
            s = trimesh.creation.uv_sphere(radius=0.06)
            s.apply_translation(list(h.position_m))
            s.visual = trimesh.visual.TextureVisuals(material=head_mat)
            meshes.append(s)

    # Pipes as cylinders
    for system in design.systems:
        for seg in system.pipes:
            r = PIPE_COLOR_BY_SIZE.get(seg.size_in, (200, 200, 200))
            pipe_mat = trimesh.visual.material.PBRMaterial(
                baseColorFactor=(r[0] / 255, r[1] / 255, r[2] / 255, 1.0),
                metallicFactor=0.6, roughnessFactor=0.4,
            )
            radius_m = seg.size_in * 0.0254 / 2
            start = np.array(seg.start_m)
            end = np.array(seg.end_m)
            length = float(np.linalg.norm(end - start))
            if length < 0.01:
                continue
            cyl = trimesh.creation.cylinder(radius=radius_m, height=length, sections=12)
            # Orient cyl's default Z-axis along segment direction
            z_axis = np.array([0, 0, 1])
            direction = (end - start) / length
            v = np.cross(z_axis, direction)
            sina = float(np.linalg.norm(v))
            cosa = float(np.dot(z_axis, direction))
            if sina > 1e-6:
                axis = v / sina
                angle = math.atan2(sina, cosa)
                R = trimesh.transformations.rotation_matrix(angle, axis)
                cyl.apply_transform(R)
            elif cosa < 0:
                # Anti-parallel
                cyl.apply_transform(
                    trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])
                )
            mid = (start + end) / 2
            cyl.apply_translation(list(mid))
            cyl.visual = trimesh.visual.TextureVisuals(material=pipe_mat)
            meshes.append(cyl)

    if not meshes:
        return ""

    scene = trimesh.Scene(meshes)
    scene.export(str(out_path), file_type="glb")
    return str(out_path)


# ── IFC export ──────────────────────────────────────────────────────

def export_ifc(design: Design, out_path: Path) -> str:
    """Emit an IFC 4 sprinkler subset via IfcOpenShell.

    Outputs IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey →
    (IfcSprinkler, IfcPipeSegment). The GC drops this into Revit/
    Navisworks for clash detection against the coordination model.
    """
    try:
        import ifcopenshell
        import ifcopenshell.api
    except ImportError as e:
        log.warning("ifcopenshell not available: %s", e)
        return ""

    # IFC4 is the stable, widely-supported schema version. Sprinkler
    # heads are represented as IfcFireSuppressionTerminal (not
    # IfcSprinkler — that's reserved for future schemas) with
    # PredefinedType SPRINKLER per IFC4 BSDD.
    ifc = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run(
        "root.create_entity", ifc,
        ifc_class="IfcProject", name=design.project.name,
    )
    # Units (SI: meters)
    try:
        ifcopenshell.api.run("unit.assign_unit", ifc, length={"is_metric": True, "raw": "METERS"})
    except (TypeError, ValueError, AttributeError) as e:
        # IfcOpenShell API surface changes between versions; fall through
        # silently is unacceptable, but unit assignment not strictly required.
        warn_swallowed(log, code="IFC_UNIT_ASSIGN_FAILED", err=e)
    # Context
    ctx = ifcopenshell.api.run("context.add_context", ifc, context_type="Model")
    body_ctx = ifcopenshell.api.run(
        "context.add_context", ifc,
        context_type="Model", context_identifier="Body",
        target_view="MODEL_VIEW", parent=ctx,
    )
    site = ifcopenshell.api.run(
        "root.create_entity", ifc, ifc_class="IfcSite",
        name="Site",
    )
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=project, products=[site])
    building = ifcopenshell.api.run(
        "root.create_entity", ifc, ifc_class="IfcBuilding",
        name="Phase I Building",
    )
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=site, products=[building])

    storey_by_id: dict[str, object] = {}
    for lvl in design.building.levels:
        st = ifcopenshell.api.run(
            "root.create_entity", ifc, ifc_class="IfcBuildingStorey",
            name=lvl.name,
        )
        ifcopenshell.api.run(
            "aggregate.assign_object", ifc,
            relating_object=building, products=[st],
        )
        storey_by_id[lvl.id] = st

    # Phase D.2 — write IfcLocalPlacement + IfcProductDefinitionShape
    # + swept-solid geometry for pipes + block geometry for heads. The
    # low-level `ifc.create_entity(...)` path is used because
    # ifcopenshell.api 0.8 doesn't yet expose a clean geometry helper.
    origin = ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    z_axis = ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
    x_axis = ifc.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0))
    world_axis = ifc.create_entity(
        "IfcAxis2Placement3D",
        Location=origin, Axis=z_axis, RefDirection=x_axis,
    )
    world_placement = ifc.create_entity(
        "IfcLocalPlacement", PlacementRelTo=None, RelativePlacement=world_axis,
    )

    def _local_placement(xyz: tuple[float, float, float]):
        pt = ifc.create_entity(
            "IfcCartesianPoint",
            Coordinates=(float(xyz[0]), float(xyz[1]), float(xyz[2])),
        )
        axis = ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=pt, Axis=z_axis, RefDirection=x_axis,
        )
        return ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=world_placement, RelativePlacement=axis,
        )

    def _head_shape_rep(radius_m: float = 0.05):
        """Small sphere at origin as a block — IFC4 supports
        IfcSphere as IfcCsgPrimitive3D."""
        sphere = ifc.create_entity("IfcSphere", Radius=radius_m,
                                   Position=world_axis)
        solid = ifc.create_entity("IfcCsgSolid", TreeRootExpression=sphere)
        shape_rep = ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="CSG",
            Items=(solid,),
        )
        return ifc.create_entity(
            "IfcProductDefinitionShape", Representations=(shape_rep,),
        )

    def _pipe_shape_rep(
        start_m: tuple[float, float, float],
        end_m: tuple[float, float, float],
        diameter_in: float,
    ):
        """Swept-solid pipe: IfcCircleProfileDef extruded along the
        segment vector, referenced in the segment's local coord
        system."""
        radius_m = diameter_in * 0.0254 / 2
        dx = end_m[0] - start_m[0]
        dy = end_m[1] - start_m[1]
        dz = end_m[2] - start_m[2]
        length = (dx * dx + dy * dy + dz * dz) ** 0.5
        if length < 1e-6:
            return None
        # Extrusion is relative to the pipe's local placement (at
        # start_m). Direction = normalized segment vector in world
        # coords; caller applies local placement to the product.
        ext_dir = ifc.create_entity(
            "IfcDirection",
            DirectionRatios=(dx / length, dy / length, dz / length),
        )
        profile_origin = ifc.create_entity(
            "IfcCartesianPoint", Coordinates=(0.0, 0.0),
        )
        profile_placement = ifc.create_entity(
            "IfcAxis2Placement2D", Location=profile_origin,
        )
        profile = ifc.create_entity(
            "IfcCircleProfileDef",
            ProfileType="AREA",
            Position=profile_placement,
            Radius=radius_m,
        )
        solid = ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=world_axis,
            ExtrudedDirection=ext_dir,
            Depth=length,
        )
        shape_rep = ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=(solid,),
        )
        return ifc.create_entity(
            "IfcProductDefinitionShape", Representations=(shape_rep,),
        )

    for system in design.systems:
        for h in system.heads:
            try:
                # Full-geometry IfcFireSuppressionTerminal: placement
                # at head position + CSG sphere body.
                term = ifc.create_entity(
                    "IfcFireSuppressionTerminal",
                    GlobalId=ifcopenshell.guid.new(),
                    Name=h.id,
                    ObjectType="SPRINKLER",
                    ObjectPlacement=_local_placement(h.position_m),
                    Representation=_head_shape_rep(),
                    PredefinedType="SPRINKLER",
                )
                _ = term
            except (TypeError, ValueError, AttributeError, RuntimeError) as e:
                warn_swallowed(log, code="IFC_SPRINKLER_CREATE_FAILED",
                               err=e, head_id=h.id)
        for s in system.pipes:
            try:
                shape = _pipe_shape_rep(s.start_m, s.end_m, s.size_in)
                if shape is None:
                    continue
                seg = ifc.create_entity(
                    "IfcPipeSegment",
                    GlobalId=ifcopenshell.guid.new(),
                    Name=s.id,
                    ObjectPlacement=_local_placement(s.start_m),
                    Representation=shape,
                )
                _ = seg
            except (TypeError, ValueError, AttributeError, RuntimeError) as e:
                warn_swallowed(log, code="IFC_PIPE_CREATE_FAILED",
                               err=e, pipe_id=s.id)

    ifc.write(str(out_path))
    return str(out_path)


def export_all(design: Design, out_dir: Path) -> dict[str, str]:
    """Convenience: emit DXF + GLB + IFC in one call.

    Export failures are collected as error entries rather than raised
    so a partial submittal bundle can still be returned. Per §1.3 each
    failure is logged with a stable code.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}
    try:
        paths["dxf"] = export_dxf(design, out_dir / "design.dxf")
    except (IOError, OSError, ValueError, RuntimeError, TypeError) as e:
        warn_swallowed(log, code="DXF_EXPORT_FAILED", err=e)
        paths["dxf_error"] = str(e)
    try:
        paths["glb"] = export_glb(design, out_dir / "design.glb")
    except (IOError, OSError, ValueError, RuntimeError, TypeError) as e:
        warn_swallowed(log, code="GLB_EXPORT_FAILED", err=e)
        paths["glb_error"] = str(e)
    try:
        paths["ifc"] = export_ifc(design, out_dir / "design.ifc")
    except (IOError, OSError, ValueError, RuntimeError, TypeError, AttributeError) as e:
        warn_swallowed(log, code="IFC_EXPORT_FAILED", err=e)
        paths["ifc_error"] = str(e)
    return paths


if __name__ == "__main__":
    print("submittal — call export_all(design, out_dir)")
