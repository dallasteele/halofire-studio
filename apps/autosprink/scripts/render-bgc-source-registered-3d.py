"""Blender 5 background renderer for the BGC source-registered pitched roof."""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "src" / "data" / "bgc-source-plan-section-3d-registration.json"
PROOF = ROOT / "src" / "data" / "proofs" / "bgc-source-plan-section-3d-registration"


def material(name, base, metallic=0.0, roughness=0.5, emission=None, alpha=1.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*base, alpha)
    value.use_nodes = True
    bsdf = value.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 3.5
    if alpha < 1:
        value.surface_render_method = "DITHERED"
    return value


def cylinder_between(name, start, end, radius, mat):
    start, end = Vector(start), Vector(end)
    delta = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=delta.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    return obj


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def main():
    packet = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    nodes = packet["geometryGraph"]["nodes"]
    edges = packet["geometryGraph"]["edges"]
    by_id = {node["id"]: node for node in nodes}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("BGC proof world")
    scene.world.color = (0.008, 0.015, 0.03)

    plan_material = bpy.data.materials.new("Actual as-built FP1.0 plan")
    plan_material.use_nodes = True
    nodes_tree = plan_material.node_tree.nodes
    links = plan_material.node_tree.links
    for item in list(nodes_tree):
        nodes_tree.remove(item)
    output = nodes_tree.new("ShaderNodeOutputMaterial")
    principled = nodes_tree.new("ShaderNodeBsdfPrincipled")
    texture = nodes_tree.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(PROOF / "bgc-plan-source.png"))
    principled.inputs["Roughness"].default_value = 0.72
    links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    crop_width_ft = (1740 - 700) / 9
    crop_height_ft = (1980 - 1040) / 9
    center_x = ((700 + 1740) / 2 - 744.5359497070312) / 9
    center_y = ((1040 + 1980) / 2 - 1488.861328125) / 9
    bpy.ops.mesh.primitive_plane_add(size=2, location=(center_x, center_y, -0.4))
    plan = bpy.context.object
    plan.name = "ACTUAL_AS_BUILT_FP1_0_UNDERLAY"
    plan.scale = (crop_width_ft / 2, crop_height_ft / 2, 1)
    plan.data.materials.append(plan_material)

    roof_mat = material("Source A301 roof surface", (0.08, 0.34, 0.72), metallic=0.1, roughness=0.32, alpha=0.28)
    roof_vertices = [(0, -44.75, 25), (104, -44.75, 25), (104, 0, 32.458333), (0, 0, 32.458333), (0, 44.75, 25), (104, 44.75, 25)]
    roof_mesh = bpy.data.meshes.new("A301_2_IN_12_ROOF")
    roof_mesh.from_pydata(roof_vertices, [], [(0, 1, 2, 3), (3, 2, 5, 4)])
    roof = bpy.data.objects.new("SOURCE_A301_ROOF_SURFACES", roof_mesh)
    bpy.context.collection.objects.link(roof)
    roof.data.materials.append(roof_mat)

    blue = material("Source-covered branch halves", (0.01, 0.28, 1.0), metallic=0.25, roughness=0.25, emission=(0.01, 0.15, 1.0))
    green = material("Source-covered branch feeds", (0.01, 0.72, 0.48), metallic=0.25, roughness=0.25, emission=(0.0, 0.45, 0.24))
    cross_main_materials = {
        ".09": material("FAB #E.09 target centerline", (0.95, 0.02, 0.55), metallic=0.28, roughness=0.24, emission=(0.72, 0.0, 0.32)),
        ".10": material("FAB #E.10 target centerline", (0.78, 0.02, 0.92), metallic=0.28, roughness=0.24, emission=(0.52, 0.0, 0.72)),
        ".11": material("FAB #E.11 target centerline", (0.98, 0.12, 0.32), metallic=0.28, roughness=0.24, emission=(0.75, 0.01, 0.12)),
        ".12": material("FAB #E.12 target centerline", (1.0, 0.35, 0.08), metallic=0.28, roughness=0.24, emission=(0.8, 0.12, 0.0)),
        ".13": material("FAB #E.13 target centerline", (0.9, 0.05, 0.68), metallic=0.28, roughness=0.24, emission=(0.65, 0.0, 0.42)),
    }
    orange = material("Source guarded head centers", (1.0, 0.22, 0.015), metallic=0.2, roughness=0.3, emission=(1.0, 0.08, 0.0))
    gold = material("Ridge", (1.0, 0.55, 0.02), metallic=0.5, roughness=0.28, emission=(1.0, 0.22, 0.0))

    for edge in edges:
        a, b = by_id[edge["from"]], by_id[edge["to"]]
        start = (*a["planPointFt"], a["roofSurfaceTargetElevationFt"] + 0.35)
        end = (*b["planPointFt"], b["roofSurfaceTargetElevationFt"] + 0.35)
        if edge["kind"] == "source-registered-gym-cross-main-axis":
            edge_material, radius = cross_main_materials[edge["fabricationPieceName"]], 0.22
        elif "branch-feed" in edge["kind"]:
            edge_material, radius = green, 0.16
        else:
            edge_material, radius = blue, 0.16
        cylinder_between(edge["id"] + "_TARGET_CENTERLINE_NOT_PART_SOLID", start, end, radius, edge_material)
    for node in nodes:
        if not node["id"].startswith("BGC-H-"):
            continue
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.5, location=(*node["planPointFt"], node["roofSurfaceTargetElevationFt"] + 0.5))
        head = bpy.context.object
        head.name = node["id"] + "_TARGET_MARKER_NOT_PART_GEOMETRY"
        head.data.materials.append(orange)
    for node in nodes:
        if node.get("role") != "registered-gym-cross-main-piece-boundary":
            continue
        location = (*node["planPointFt"], node["roofSurfaceTargetElevationFt"] + 0.7)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.55, location=location)
        marker = bpy.context.object
        marker.name = node["id"] + "_REGISTERED_BOUNDARY_MARKER_NOT_FITTING"
        marker.data.materials.append(gold)
    cylinder_between("A301_RIDGE_132_5_1_2", (0, 0, 32.7), (104, 0, 32.7), 0.16, gold)

    camera_data = bpy.data.cameras.new("Proof camera")
    camera = bpy.data.objects.new("Proof camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (142, -148, 132)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 170
    look_at(camera, (52, 0, 15))
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(30, -20, 120))
    bpy.context.object.data.energy = 2400
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 90
    bpy.ops.object.light_add(type="AREA", location=(105, 70, 75))
    bpy.context.object.data.energy = 1500
    bpy.context.object.data.size = 70

    scene.render.filepath = str(PROOF / "bgc-source-registered-3d.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(PROOF / "bgc-source-registered-3d.blend"))
    bpy.ops.render.render(write_still=True)
    glb_path = str(PROOF / "bgc-source-registered-3d.glb")
    if hasattr(bpy.ops.export_scene, "gltf"):
        bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB")
    else:
        glb_path = "unavailable-in-installed-blender-export-operators"
    print(json.dumps({"render": scene.render.filepath, "blend": bpy.data.filepath, "glb": glb_path, "nodes": len(nodes), "edges": len(edges)}))


if __name__ == "__main__":
    main()
