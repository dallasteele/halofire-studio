#!/usr/bin/env python3
"""Build the exact New Hope CMI.23-CMI.42 pipe bodies through Blender MCP.

This proof is intentionally narrower than a routed sprinkler system. It binds
the twenty protected T-T fabrication cut lengths to real-scale Blender meshes
and preserves the fitting family as metadata. It does not invent fitting
takeout, per-piece building placement, grade, or centerline Z.
"""

from __future__ import annotations

import json
import socket
from pathlib import Path


HOST = "127.0.0.1"
PORT = 9876
ROOT = Path(__file__).resolve().parents[3]
SCHEDULE_PATH = ROOT / "apps/autosprink/src/data/new-hope-fabrication-end-schedule.json"
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


def blender_code(pieces: list[dict]) -> str:
    payload = json.dumps(pieces, separators=(",", ":"))
    png_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.png").as_posix()
    glb_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.glb").as_posix()
    blend_path = (OUTPUT_DIR / "new-hope-threaded-terminal-parts.blend").as_posix()
    return f'''
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

pieces = json.loads({payload!r})
output_dir = Path({OUTPUT_DIR.as_posix()!r})
output_dir.mkdir(parents=True, exist_ok=True)
png_path = {png_path!r}
glb_path = {glb_path!r}
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

title_y = len(sorted_pieces) * row_spacing + 0.16
add_text("NEW HOPE CMI.23-CMI.42 — PROJECT CUT-LENGTH PIPE BODIES", (-0.78, title_y, 0.055), 0.075, white)
add_text("20 exact pipe identities | nominal OD 33.4 mm | protected T-T ends", (-0.78, title_y - 0.105, 0.055), 0.042, cyan)
add_text("FITTING TAKEOUT + PER-PIECE BUILDING PLACEMENT + GRADE/Z BLOCKED", (-0.78, -0.18, 0.055), 0.045, amber)
add_text("No elbow/reducer mesh is fabricated until a source-valid component and takeout exist.", (-0.78, -0.27, 0.055), 0.031, white)

bpy.ops.object.camera_add(location=(0.72, 1.05, 6.0))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.2
camera.rotation_euler = (0, 0, 0)
camera.rotation_euler = (Vector((0.72, 1.05, 0.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera

bpy.ops.object.light_add(type="AREA", location=(0.9, 1.0, 4.0))
key = bpy.context.object
key.data.energy = 1300
key.data.shape = "RECTANGLE"
key.data.size = 4.0

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for pipe in pipe_objects:
    pipe.select_set(True)
bpy.context.view_layer.objects.active = pipe_objects[0]
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True)

scene.render.filepath = png_path
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print(json.dumps({{
    "artifact": "new-hope-threaded-terminal-project-pipe-bodies",
    "pipeObjectCount": len(pipe_objects),
    "pieceIds": sorted(obj["piece_id"] for obj in pipe_objects),
    "nominalOdMm": {NOMINAL_OD_MM!r},
    "exactCutLengthsReady": True,
    "threadedEndsReady": True,
    "exactFittingTakeoutReady": False,
    "exactBuildingPlacementReady": False,
    "properPipeLayoutReady": False,
    "png": png_path,
    "glb": glb_path,
    "blend": blend_path,
}}, sort_keys=True))
'''


def main() -> None:
    pieces = load_pieces()
    response = send({"type": "execute_code", "params": {"code": blender_code(pieces)}})
    if response.get("status") == "error":
        raise RuntimeError(response.get("message") or response)
    print(json.dumps(response, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
