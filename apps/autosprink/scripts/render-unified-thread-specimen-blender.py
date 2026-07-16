"""Render the OpenCascade .375-16 UNC fit specimen in Blender.

Run through Blender MCP execute_code so the inspected scene is the same scene
that produces the proof image. Inputs are the STL meshes exported from the
hash-bound FreeCAD/OpenCascade build; this script does not invent part geometry.
"""

from pathlib import Path
import math

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(r"E:\ClaudeBot\.codex-work\halofire-live-release-20260711")
INPUT_DIR = ROOT / "output" / "3d" / "unified-thread-375-16-unc"
OUTPUT_PNG = INPUT_DIR / "unified-thread-375-16-unc-blender-proof-v3.png"
OUTPUT_BLEND = INPUT_DIR / "unified-thread-375-16-unc-blender-proof.blend"


def material(name, color, metallic=0.0, roughness=0.35, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        mat.surface_render_method = "DITHERED"
    return mat


def import_stl(path, name, mat, location=(0, 0, 0)):
    before = set(bpy.data.objects)
    bpy.ops.wm.stl_import(filepath=str(path))
    created = list(set(bpy.data.objects) - before)
    if len(created) != 1:
        raise RuntimeError(f"Expected one object from {path.name}; got {len(created)}")
    obj = created[0]
    obj.name = name
    obj.location = location
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_text(body, location, size, color, extrude=0.02):
    curve = bpy.data.curves.new(body[:48], "FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.size = size
    curve.extrude = extrude
    obj = bpy.data.objects.new(body[:48], curve)
    obj.location = location
    obj.rotation_euler = (math.radians(72), 0, 0)
    curve.materials.append(color)
    bpy.context.collection.objects.link(obj)
    return obj


def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def cutaway_front_half(obj):
    """Open a visualization copy so the exact imported internal helix is visible."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0.0, 0.0, 0.0),
        plane_no=(0.0, 1.0, 0.0),
        clear_inner=False,
        clear_outer=True,
    )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    pass

male_mat = material("2A external thread", (0.93, 0.22, 0.08), metallic=0.55, roughness=0.23)
female_mat = material("2B internal thread", (0.05, 0.30, 0.95), metallic=0.45, roughness=0.25)
female_glass = material("2B transparent fit body", (0.08, 0.38, 0.95), metallic=0.1, roughness=0.18, alpha=0.24)
for proof_material, emission_color, emission_strength in (
    (male_mat, (0.93, 0.08, 0.015, 1.0), 0.32),
    (female_mat, (0.015, 0.12, 0.95, 1.0), 0.22),
    (female_glass, (0.015, 0.16, 0.95, 1.0), 0.12),
):
    proof_bsdf = proof_material.node_tree.nodes.get("Principled BSDF")
    if "Emission Color" in proof_bsdf.inputs:
        proof_bsdf.inputs["Emission Color"].default_value = emission_color
        proof_bsdf.inputs["Emission Strength"].default_value = emission_strength
white = material("Proof text", (0.95, 0.97, 1.0), roughness=0.45)
white_bsdf = white.node_tree.nodes.get("Principled BSDF")
if "Emission Color" in white_bsdf.inputs:
    white_bsdf.inputs["Emission Color"].default_value = (0.72, 0.86, 1.0, 1.0)
    white_bsdf.inputs["Emission Strength"].default_value = 3.0
dark = material("Ground", (0.045, 0.055, 0.085), metallic=0.0, roughness=0.55)

male_path = INPUT_DIR / "unified-thread-375-16-unc-2a-male.stl"
female_path = INPUT_DIR / "unified-thread-375-16-unc-2b-female.stl"
if not male_path.exists() or not female_path.exists():
    raise FileNotFoundError("Run the FreeCAD/OpenCascade specimen build first")

# Left: assembled at a two-pitch offset, exactly matching the kernel receipt.
import_stl(male_path, "Kernel.Male2A.Assembled", male_mat, (-18, 0, 0))
import_stl(female_path, "Kernel.Female2B.Assembled", female_glass, (-18, 0, 3.175))

# Right: exploded source meshes so both real helical surfaces remain visible.
import_stl(male_path, "Kernel.Male2A.Exploded", male_mat, (9, 0, 0))
female_exploded = import_stl(female_path, "VisualizationCutaway.Female2B.ExactMesh", female_mat, (27, 0, 13))
cutaway_front_half(female_exploded)
female_exploded.rotation_euler = (math.radians(58), 0, math.radians(12))

bpy.ops.mesh.primitive_plane_add(size=140, location=(0, 0, -1.0))
ground = bpy.context.object
ground.name = "ProofGround"
ground.data.materials.append(dark)

add_text("OPEN CASCADE BOOLEAN FIT: 0.000000 mm3 INTERFERENCE", (0, 15, 36), 1.45, white)
add_text(".375-16 UNC 2A / 2B - 16 TPI - 0.0625 in LEAD", (0, 15, 32.5), 1.25, white)
add_text("NIST H28 TABLE 2.21 - PDF SHA256 116D4FBD...0720D", (0, 15, 29.2), 1.0, white)
add_text("STANDARDS SPECIMEN ONLY - NOT A MANUFACTURER OR NEW HOPE PART", (0, 15, 26), 1.05, white)
add_text("ASSEMBLED", (-18, 12, -0.5), 1.35, white)
add_text("EXACT MESH + INTERNAL-HELIX CUTAWAY", (18, 12, -0.5), 1.1, white)

bpy.ops.object.light_add(type="AREA", location=(5, -32, 52))
key = bpy.context.object
key.name = "KeyLight"
key.data.energy = 3200
key.data.shape = "DISK"
key.data.size = 28
key.data.color = (0.80, 0.89, 1.0)

bpy.ops.object.light_add(type="AREA", location=(-42, 12, 24))
fill = bpy.context.object
fill.name = "FillLight"
fill.data.energy = 2400
fill.data.size = 22
fill.data.color = (1.0, 0.35, 0.14)

bpy.ops.object.light_add(type="AREA", location=(42, 14, 30))
rim = bpy.context.object
rim.name = "RimLight"
rim.data.energy = 2600
rim.data.size = 20
rim.data.color = (0.18, 0.42, 1.0)

bpy.ops.object.camera_add(location=(74, -92, 62))
camera = bpy.context.object
camera.name = "ProofCamera"
camera.data.lens = 58
point_camera(camera, (0, 0, 18))
bpy.context.scene.camera = camera
for obj in bpy.context.scene.objects:
    if obj.type == "FONT":
        obj.rotation_euler = (camera.location - obj.location).to_track_quat("Z", "Y").to_euler()

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUTPUT_PNG)
scene.render.film_transparent = False
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.018, 0.026, 0.055, 1.0)
background.inputs["Strength"].default_value = 0.32
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 1.35
scene.render.image_settings.color_mode = "RGBA"

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
bpy.ops.render.render(write_still=True)
print({
    "blend": str(OUTPUT_BLEND),
    "png": str(OUTPUT_PNG),
    "meshObjects": len([obj for obj in scene.objects if obj.type == "MESH"]),
})
