#!/usr/bin/env python3
"""Build New Hope threaded terminal pipe bodies and catalog parts through Blender MCP.

The project fabrication quote resolves the terminal fitting families to the
ASC/SCI Fig. 3201 elbow and Fig. 3221R reducing coupling. Blender creates
catalog-identified, true-scale component meshes constrained to their published
primary dimensions. Complete manufacturing solids, installed thread engagement
and takeout, per-piece placement, grade, and centerline Z remain blocked.
"""

from __future__ import annotations

import json
import socket
from pathlib import Path


HOST = "127.0.0.1"
PORT = 9876
ROOT = Path(__file__).resolve().parents[3]
SCHEDULE_PATH = ROOT / "apps/autosprink/src/data/new-hope-fabrication-end-schedule.json"
CATALOG_PATH = ROOT / "apps/autosprink/src/data/new-hope-threaded-terminal-catalog-parts.json"
OUTPUT_DIR = ROOT / "output/3d"
EXPECTED_IDS = [f"CMI.{piece_number:02d}" for piece_number in range(23, 43)]
NOMINAL_OD_MM = 33.4


def send(command: dict) -> dict:
    """Send one command to the installed Blender MCP add-on."""

    with socket.create_connection((HOST, PORT), timeout=15) as client:
        client.settimeout(120)
        client.sendall(json.dumps(command).encode("utf-8"))
        chunks: list[bytes] = []
        while True:
            try:
                chunk = client.recv(65536)
            except TimeoutError:
                break
            if not chunk:
                break
            chunks.append(chunk)
            try:
                return json.loads(b"".join(chunks).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue

    if not chunks:
        raise RuntimeError("Blender MCP returned an empty response")
    return json.loads(b"".join(chunks).decode("utf-8"))


def load_pieces() -> list[dict]:
    schedule = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    indexed = {piece["pieceId"]: piece for piece in schedule["threadedPieces"]}
    pieces: list[dict] = []
    for piece_id in EXPECTED_IDS:
        piece = indexed.get(piece_id)
        if piece is None:
            raise ValueError(f"Missing protected threaded piece {piece_id}")
        if piece.get("endPreparation") != ["T", "T"]:
            raise ValueError(f"{piece_id} must retain T-T end preparation")
        if piece.get("endFittingFamily") not in {"threaded-90-elbow", "threaded-reducer"}:
            raise ValueError(f"{piece_id} has an unexpected fitting family")
        pieces.append(
            {
                "pieceId": piece_id,
                "cutLengthIn": piece["cutLengthIn"],
                "endPreparation": piece["endPreparation"],
                "endFittingFamily": piece["endFittingFamily"],
                "fittingSizeText": piece["fittingSizeText"],
            }
        )
    return pieces


def load_catalog_parts() -> list[dict]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("projectId") != "new-hope-crisis-center-brigham-city-ut":
        raise ValueError("Catalog evidence must remain bound to New Hope")
    indexed = {part["catalogPartId"]: part for part in catalog.get("parts", [])}
    expected = {
        "asc-sci-3201-1in-black": ("0840000004", {"centerToEndA": 1.5}),
        "asc-sci-3221r-1x3_4-black": ("0840010763", {"overallLengthA": 1.69}),
    }
    parts: list[dict] = []
    for part_id, (product_number, dimensions) in expected.items():
        part = indexed.get(part_id)
        if part is None:
            raise ValueError(f"Missing catalog part {part_id}")
        if part.get("purchaseProductNumber") != product_number:
            raise ValueError(f"{part_id} product identity drifted")
        if part.get("publishedDimensionsIn") != dimensions:
            raise ValueError(f"{part_id} published primary dimension drifted")
        parts.append(part)
    return parts


def blender_code(pieces: list[dict], catalog_parts: list[dict]) -> str:
    payload = json.dumps(pieces, separators=(",", ":"))
    catalog_payload = json.dumps(catalog_parts, separators=(",", ":"))
    png_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.png").as_posix()
    glb_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.glb").as_posix()
    catalog_glb_path = (OUTPUT_DIR / "new-hope-asc-threaded-terminal-catalog-parts.glb").as_posix()
    catalog_png_path = (OUTPUT_DIR / "new-hope-asc-threaded-terminal-catalog-parts.png").as_posix()
    blend_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.blend").as_posix()
    return f'''
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

pieces = json.loads({payload!r})
catalog_parts = json.loads({catalog_payload!r})
output_dir = Path({OUTPUT_DIR.as_posix()!r})
output_dir.mkdir(parents=True, exist_ok=True)
png_path = {png_path!r}
glb_path = {glb_path!r}
catalog_glb_path = {catalog_glb_path!r}
catalog_png_path = {catalog_png_path!r}
blend_path = {blend_path!r}
nominal_od_m = {NOMINAL_OD_MM / 1000!r}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (
    bpy.data.meshes,
    bpy.data.curves,
    bpy.data.materials,
    bpy.data.cameras,
    bpy.data.lights,
):
    for datablock in list(datablocks):
        datablocks.remove(datablock)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
bpy.context.preferences.filepaths.save_version = 0
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (0.008, 0.015, 0.025)

def material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.metallic = metallic
    mat.roughness = roughness
    return mat

steel = material("Project black steel", (0.055, 0.075, 0.095), metallic=0.72, roughness=0.28)
white = material("Evidence text", (0.92, 0.96, 1.0))
cyan = material("Bounded truth", (0.03, 0.78, 0.95))
amber = material("Blocked boundary", (1.0, 0.32, 0.08))
iron = material("ASC SCI black ductile iron", (0.075, 0.085, 0.095), metallic=0.42, roughness=0.48)
thread_dark = material("Unresolved internal thread volume", (0.006, 0.009, 0.012), metallic=0.2, roughness=0.62)

def add_text(value, location, size, mat, align="LEFT"):
    bpy.ops.object.text_add(location=location)
    obj = bpy.context.object
    obj.data.body = value
    obj.data.align_x = align
    obj.data.size = size
    obj.data.extrude = 0.0004
    obj.data.materials.append(mat)
    return obj

pipe_objects = []
sorted_pieces = sorted(pieces, key=lambda item: (-item["cutLengthIn"], item["pieceId"]))
row_spacing = 0.112
start_x = 0.35
for row, piece in enumerate(sorted_pieces):
    length_m = piece["cutLengthIn"] * 0.0254
    y = (len(sorted_pieces) - 1 - row) * row_spacing
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=64,
        radius=nominal_od_m / 2,
        depth=length_m,
        location=(start_x + length_m / 2, y, 0.03),
        rotation=(0, math.pi / 2, 0),
    )
    pipe = bpy.context.object
    pipe.name = piece["pieceId"]
    pipe.data.materials.append(steel)
    pipe["piece_id"] = piece["pieceId"]
    pipe["cut_length_in"] = piece["cutLengthIn"]
    pipe["nominal_od_mm"] = {NOMINAL_OD_MM!r}
    pipe["end_a"] = "T"
    pipe["end_b"] = "T"
    pipe["attached_fitting_family"] = piece["endFittingFamily"]
    pipe["attached_fitting_size"] = piece["fittingSizeText"]
    pipe["exact_fitting_takeout_ready"] = False
    pipe["exact_building_placement_ready"] = False
    pipe_objects.append(pipe)

    add_text(
        f'{{piece["pieceId"]}}  {{piece["cutLengthIn"]:g}} in  T-T',
        (-0.78, y - 0.018, 0.055),
        0.033,
        cyan,
    )

def add_cylinder_between(name, start, end, radius, mat, vertices=64):
    start_v = Vector(start)
    end_v = Vector(end)
    delta = end_v - start_v
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(start_v + end_v) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    return obj

def add_quarter_tube(name, center, centerline_radius, body_radius, mat, segments=48, sides=32):
    cx, cy, cz = center
    verts = []
    faces = []
    for i in range(segments + 1):
        theta = (math.pi / 2) * i / segments
        radial = Vector((math.cos(theta), math.sin(theta), 0))
        binormal = Vector((0, 0, 1))
        path = Vector((cx, cy, cz)) + radial * centerline_radius
        for j in range(sides):
            phi = 2 * math.pi * j / sides
            point = path + radial * (body_radius * math.cos(phi)) + binormal * (body_radius * math.sin(phi))
            verts.append(tuple(point))
    for i in range(segments):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            c = (i + 1) * sides + (j + 1) % sides
            d = (i + 1) * sides + j
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

catalog_objects = []
catalog_by_id = {{part["catalogPartId"]: part for part in catalog_parts}}

# True-scale ASC/SCI Fig. 3201. Published A governs both center-to-end faces.
elbow = catalog_by_id["asc-sci-3201-1in-black"]
elbow_a = elbow["publishedDimensionsIn"]["centerToEndA"] * 0.0254
elbow_centerline_radius = 0.0220
elbow_body_radius = 0.0190
elbow_extension = elbow_a - elbow_centerline_radius
elbow_origin = Vector((2.30, 1.76, 0.10))
elbow_arc = add_quarter_tube("ASC_SCI_3201_1in_Elbow_Body", elbow_origin, elbow_centerline_radius, elbow_body_radius, iron)
elbow_leg_x = add_cylinder_between("ASC_SCI_3201_1in_Elbow_Leg_X", elbow_origin + Vector((-elbow_extension, elbow_centerline_radius, 0)), elbow_origin + Vector((0, elbow_centerline_radius, 0)), elbow_body_radius, iron)
elbow_leg_y = add_cylinder_between("ASC_SCI_3201_1in_Elbow_Leg_Y", elbow_origin + Vector((elbow_centerline_radius, -elbow_extension, 0)), elbow_origin + Vector((elbow_centerline_radius, 0, 0)), elbow_body_radius, iron)
elbow_collar_depth = min(0.010, elbow_extension)
elbow_collar_x = add_cylinder_between("ASC_SCI_3201_1in_FNPT_Collar_X", elbow_origin + Vector((-elbow_extension, elbow_centerline_radius, 0)), elbow_origin + Vector((-elbow_extension + elbow_collar_depth, elbow_centerline_radius, 0)), 0.0225, iron, 12)
elbow_collar_y = add_cylinder_between("ASC_SCI_3201_1in_FNPT_Collar_Y", elbow_origin + Vector((elbow_centerline_radius, -elbow_extension, 0)), elbow_origin + Vector((elbow_centerline_radius, -elbow_extension + elbow_collar_depth, 0)), 0.0225, iron, 12)
elbow_open_x = add_cylinder_between("ASC_SCI_3201_1in_FNPT_Open_X", elbow_origin + Vector((-elbow_extension - 0.0004, elbow_centerline_radius, 0)), elbow_origin + Vector((-elbow_extension + 0.0010, elbow_centerline_radius, 0)), 0.0133, thread_dark)
elbow_open_y = add_cylinder_between("ASC_SCI_3201_1in_FNPT_Open_Y", elbow_origin + Vector((elbow_centerline_radius, -elbow_extension - 0.0004, 0)), elbow_origin + Vector((elbow_centerline_radius, -elbow_extension + 0.0010, 0)), 0.0133, thread_dark)
for obj in (elbow_arc, elbow_leg_x, elbow_leg_y, elbow_collar_x, elbow_collar_y, elbow_open_x, elbow_open_y):
    obj["catalog_part_id"] = elbow["catalogPartId"]
    obj["manufacturer"] = elbow["manufacturer"]
    obj["brand"] = elbow["brand"]
    obj["figure"] = elbow["figure"]
    obj["purchase_product_number"] = elbow["purchaseProductNumber"]
    obj["published_center_to_end_a_in"] = 1.5
    obj["primary_dimension_ready"] = True
    obj["secondary_envelope_manufacturing_exact"] = False
    obj["exact_internal_thread_form_ready"] = False
    obj["exact_installed_takeout_ready"] = False
    catalog_objects.append(obj)

# True-scale ASC/SCI Fig. 3221R. Published overall A governs the Z envelope.
reducer = catalog_by_id["asc-sci-3221r-1x3_4-black"]
reducer_a = reducer["publishedDimensionsIn"]["overallLengthA"] * 0.0254
reducer_origin = Vector((2.50, 1.76, 0.10))
lower_h = reducer_a * 0.62
upper_h = reducer_a - lower_h
bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=0.0228, radius2=0.0188, depth=lower_h, location=reducer_origin + Vector((lower_h / 2, 0, 0)), rotation=(0, math.pi / 2, 0))
reducer_lower = bpy.context.object
reducer_lower.name = "ASC_SCI_3221R_1x3_4_Reducer_Body"
reducer_lower.data.materials.append(iron)
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0222, depth=upper_h, location=reducer_origin + Vector((lower_h + upper_h / 2, 0, 0)), rotation=(0, math.pi / 2, 0))
reducer_upper = bpy.context.object
reducer_upper.name = "ASC_SCI_3221R_3_4in_FNPT_Hex"
reducer_upper.data.materials.append(iron)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.0133, depth=0.0014, location=reducer_origin + Vector((0.0004, 0, 0)), rotation=(0, math.pi / 2, 0))
reducer_open_1 = bpy.context.object
reducer_open_1.name = "ASC_SCI_3221R_1in_FNPT_Open"
reducer_open_1.data.materials.append(thread_dark)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.0107, depth=0.0014, location=reducer_origin + Vector((reducer_a - 0.0004, 0, 0)), rotation=(0, math.pi / 2, 0))
reducer_open_2 = bpy.context.object
reducer_open_2.name = "ASC_SCI_3221R_3_4in_FNPT_Open"
reducer_open_2.data.materials.append(thread_dark)
for obj in (reducer_lower, reducer_upper, reducer_open_1, reducer_open_2):
    obj["catalog_part_id"] = reducer["catalogPartId"]
    obj["manufacturer"] = reducer["manufacturer"]
    obj["brand"] = reducer["brand"]
    obj["figure"] = reducer["figure"]
    obj["purchase_product_number"] = reducer["purchaseProductNumber"]
    obj["published_overall_length_a_in"] = 1.69
    obj["primary_dimension_ready"] = True
    obj["secondary_envelope_manufacturing_exact"] = False
    obj["exact_internal_thread_form_ready"] = False
    obj["exact_installed_takeout_ready"] = False
    catalog_objects.append(obj)

add_text("ASC/SCI PARTS - TRUE SCALE", (1.92, 2.08, 0.055), 0.035, white)
add_text("Fig 3201 | 0840000004 | A=1.50 in", (2.08, 1.63, 0.055), 0.027, cyan)
add_text("Fig 3221R | 0840010763 | A=1.69 in", (2.08, 1.55, 0.055), 0.027, cyan)
add_text("Primary dimensions exact; full solid + engagement blocked", (2.08, 1.47, 0.055), 0.022, amber)

title_y = len(sorted_pieces) * row_spacing + 0.16
add_text("NEW HOPE CMI.23-CMI.42 - PROJECT PIPE BODIES + CATALOG PARTS", (-0.78, title_y, 0.055), 0.070, white)
add_text("20 exact pipe identities | nominal OD 33.4 mm | protected T-T ends", (-0.78, title_y - 0.105, 0.055), 0.042, cyan)
add_text("THREAD ENGAGEMENT/TAKEOUT + PER-PIECE PLACEMENT + GRADE/Z BLOCKED", (-0.78, -0.18, 0.055), 0.043, amber)
add_text("Catalog identity and primary dimensions are valid; installed connection geometry is not inferred.", (-0.78, -0.27, 0.055), 0.029, white)

bpy.ops.object.camera_add(location=(0.72, 1.05, 6.0))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.2
camera.rotation_euler = (0, 0, 0)
camera.rotation_euler = (Vector((0.72, 1.05, 0.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera

bpy.ops.object.light_add(type="AREA", location=(0.9, 1.0, 4.0))
key = bpy.context.object
key.data.energy = 350
key.data.shape = "RECTANGLE"
key.data.size = 4.0

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in pipe_objects + catalog_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = pipe_objects[0]
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True)

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in catalog_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = catalog_objects[0]
bpy.ops.export_scene.gltf(filepath=catalog_glb_path, export_format="GLB", use_selection=True)

scene.render.filepath = png_path
bpy.ops.render.render(write_still=True)

# A second, close-up proof keeps the meshes true-scale while making the component
# profiles legible. Existing overview labels and pipes are hidden only for this render.
for obj in pipe_objects:
    obj.hide_render = True
for obj in list(bpy.context.scene.objects):
    if obj.type == "FONT":
        obj.hide_render = True

detail_title = add_text("NEW HOPE PURCHASE-BOUND ASC/SCI PARTS", (2.38, 1.85, 0.17), 0.012, white, "CENTER")
detail_elbow = add_text("FIG 3201 | 0840000004 | A=1.50 in", (2.30, 1.67, 0.17), 0.006, cyan, "CENTER")
detail_reducer = add_text("FIG 3221R | 0840010763 | A=1.69 in", (2.52, 1.67, 0.17), 0.006, cyan, "CENTER")
detail_boundary = add_text("TRUE SCALE | PRIMARY DIMENSIONS EXACT | THREAD ENGAGEMENT/TAKEOUT BLOCKED", (2.38, 1.635, 0.17), 0.006, amber, "CENTER")
for obj in (detail_title, detail_elbow, detail_reducer, detail_boundary):
    obj.hide_render = False

bpy.ops.object.camera_add(location=(2.38, 1.75, 1.0))
detail_camera = bpy.context.object
detail_camera.name = "Catalog_Parts_Detail_Camera"
detail_camera.data.type = "ORTHO"
detail_camera.data.ortho_scale = 0.50
detail_camera.rotation_euler = (0, 0, 0)
detail_camera.rotation_euler = (Vector((2.38, 1.75, 0.08)) - detail_camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = detail_camera
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
key.data.energy = 80
bpy.ops.object.light_add(type="AREA", location=(2.38, 1.75, 0.75))
detail_key = bpy.context.object
detail_key.name = "Catalog_Parts_Detail_Light"
detail_key.data.energy = 60
detail_key.data.size = 0.8
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -1.5
scene.render.filepath = catalog_png_path
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print(json.dumps({{
    "artifact": "new-hope-threaded-terminal-project-pipe-bodies",
    "pipeObjectCount": len(pipe_objects),
    "catalogComponentMeshCount": len(catalog_objects),
    "catalogPartCount": len(catalog_parts),
    "catalogProductNumbers": sorted(part["purchaseProductNumber"] for part in catalog_parts),
    "pieceIds": sorted(obj["piece_id"] for obj in pipe_objects),
    "nominalOdMm": {NOMINAL_OD_MM!r},
    "exactCutLengthsReady": True,
    "threadedEndsReady": True,
    "manufacturerPartIdentityReady": True,
    "manufacturerPrimaryDimensionsReady": True,
    "blenderCatalogComponentGeometryReady": True,
    "manufacturerSecondaryEnvelopeReady": False,
    "exactInternalThreadFormReady": False,
    "exactThreadEngagementReady": False,
    "exactFittingTakeoutReady": False,
    "exactBuildingPlacementReady": False,
    "properPipeLayoutReady": False,
    "png": png_path,
    "catalogPng": catalog_png_path,
    "glb": glb_path,
    "catalogGlb": catalog_glb_path,
    "blend": blend_path,
}}, sort_keys=True))
'''


def main() -> None:
    pieces = load_pieces()
    catalog_parts = load_catalog_parts()
    response = send({"type": "execute_code", "params": {"code": blender_code(pieces, catalog_parts)}})
    if response.get("status") == "error":
        raise RuntimeError(response.get("message") or response)
    print(json.dumps(response, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
