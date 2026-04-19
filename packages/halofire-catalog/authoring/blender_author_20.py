"""Author 20 generic fire-sprinkler components via blender-mcp.

Each component is a simple parametric mesh (cylinder + box primitives)
exported to GLB. Dimensions match real-world NFPA-compliant hardware so
the Halofire placer tool has correct scale from day one.

Run:
    python blender_author_20.py

Requires blender-mcp addon running at localhost:9876 (already wired in
ClaudeBot skill tools/blender_mcp_client.py).

Output: 20 .glb files written to
    packages/halofire-catalog/assets/glb/
"""
from __future__ import annotations
import json
import socket
import sys
import time
from pathlib import Path


HOST = "127.0.0.1"
PORT = 9876

OUT_DIR = Path("E:/ClaudeBot/halofire-studio/packages/halofire-catalog/assets/glb")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def send(command: dict) -> dict:
    """Send a JSON command to blender-mcp and read the JSON response."""
    with socket.create_connection((HOST, PORT), timeout=60) as s:
        s.sendall(json.dumps(command).encode())
        chunks = []
        s.settimeout(60)
        try:
            while True:
                buf = s.recv(65536)
                if not buf:
                    break
                chunks.append(buf)
        except socket.timeout:
            pass
    raw = b"".join(chunks)
    if not raw:
        return {"error": "empty response"}
    return json.loads(raw.decode("utf-8"))


def run_code(code: str) -> dict:
    return send({"type": "execute_code", "params": {"code": code}})


# ── Component list ──────────────────────────────────────────────────────────

COMPONENTS: list[tuple[str, str, str]] = []
# Format: (filename_without_ext, human_description, blender_build_code)


def push(name: str, desc: str, code: str) -> None:
    COMPONENTS.append((name, desc, code))


# ─── 5 Sprinkler Heads ───────────────────────────────────────────────────

push(
    "SM_Head_Pendant_Standard_K56",
    "Standard pendant sprinkler head, K=5.6, pointing down from ceiling",
    r"""
import bpy, math
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()

# Stem (threaded body): cylinder 15mm dia x 50mm long, pointing +Z
bpy.ops.mesh.primitive_cylinder_add(radius=0.0075, depth=0.050, location=(0,0,0.025), vertices=16)
stem = bpy.context.active_object; stem.name = "Stem"

# Deflector (flat disc) at bottom of head (-Z of stem): 50mm dia x 2mm
bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.002, location=(0,0,-0.003), vertices=24)
deflector = bpy.context.active_object; deflector.name = "Deflector"

# Frame (2 arms): two boxes forming the inverted Y
for ang_deg in (0, 90):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.010))
    a = bpy.context.active_object
    a.scale = (0.002, 0.028, 0.003)
    a.rotation_euler = (0, 0, math.radians(ang_deg))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# Join all
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = stem
bpy.ops.object.join()
obj = bpy.context.active_object
obj.name = "SM_Head_Pendant_Standard_K56"

# Origin at top of stem (ceiling interface)
bpy.context.scene.cursor.location = (0, 0, 0.050)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Chrome material
mat = bpy.data.materials.new("M_Chrome"); mat.metallic = 1.0; mat.roughness = 0.1
mat.diffuse_color = (0.8, 0.8, 0.85, 1.0)
obj.data.materials.append(mat)
""",
)

push(
    "SM_Head_Pendant_QR_K56",
    "Quick-response pendant, K=5.6, smaller frame than standard",
    r"""
import bpy, math
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Stem
bpy.ops.mesh.primitive_cylinder_add(radius=0.0075, depth=0.045, location=(0,0,0.0225), vertices=16)
stem = bpy.context.active_object
# Compact deflector (smaller dia for fast response)
bpy.ops.mesh.primitive_cylinder_add(radius=0.022, depth=0.002, location=(0,0,-0.002), vertices=24)
# Smaller frame arms
for ang_deg in (0, 90):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.008))
    a = bpy.context.active_object
    a.scale = (0.002, 0.022, 0.002)
    a.rotation_euler = (0, 0, math.radians(ang_deg))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = stem; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Head_Pendant_QR_K56"
bpy.context.scene.cursor.location = (0,0,0.045); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_Chrome"); mat.metallic = 1.0; mat.roughness = 0.1
mat.diffuse_color = (0.85, 0.85, 0.9, 1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Head_Upright_Standard_K56",
    "Standard upright sprinkler head, K=5.6, pointing up (deflector on top)",
    r"""
import bpy, math
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Stem (pointing -Z this time — upright sits below the pipe with deflector above)
bpy.ops.mesh.primitive_cylinder_add(radius=0.0075, depth=0.050, location=(0,0,0.025), vertices=16)
stem = bpy.context.active_object
# Deflector at top
bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.002, location=(0,0,0.053), vertices=24)
# Frame arms going up to deflector
for ang_deg in (0, 90):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.040))
    a = bpy.context.active_object
    a.scale = (0.002, 0.028, 0.003)
    a.rotation_euler = (0, 0, math.radians(ang_deg))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = stem; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Head_Upright_Standard_K56"
bpy.context.scene.cursor.location = (0,0,0)  # pipe-thread end
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_Brass"); mat.metallic = 1.0; mat.roughness = 0.2
mat.diffuse_color = (0.75, 0.65, 0.3, 1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Head_Sidewall_Horizontal_K56",
    "Horizontal sidewall head, K=5.6, mounts to wall, throws water horizontally",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Body pointing +Y (out from wall)
bpy.ops.mesh.primitive_cylinder_add(radius=0.010, depth=0.055, location=(0,0.0275,0), rotation=(1.5708,0,0), vertices=16)
body = bpy.context.active_object
# Flat deflector at end, oriented to spray down+out
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0.058,-0.008))
d = bpy.context.active_object
d.scale = (0.040, 0.004, 0.020); d.rotation_euler = (0.52, 0, 0)  # ~30deg tilt
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Head_Sidewall_Horizontal_K56"
bpy.context.scene.cursor.location = (0, 0, 0)  # at wall interface
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_Chrome"); mat.metallic = 1.0; mat.roughness = 0.1
mat.diffuse_color = (0.85,0.85,0.9,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Head_Concealed_Pendant_K56",
    "Concealed pendant — escutcheon cover plate plus hidden head",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Cover plate disc (visible face)
bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.002, location=(0,0,0.001), vertices=32)
plate = bpy.context.active_object
# Hidden stem extending up into ceiling
bpy.ops.mesh.primitive_cylinder_add(radius=0.0075, depth=0.060, location=(0,0,0.032), vertices=16)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = plate; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Head_Concealed_Pendant_K56"
bpy.context.scene.cursor.location = (0, 0, 0.062)  # top of stem (pipe interface)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_WhiteCover"); mat.metallic = 0.0; mat.roughness = 0.4
mat.diffuse_color = (0.95,0.95,0.95,1.0); obj.data.materials.append(mat)
""",
)

# ─── 6 Pipes ─────────────────────────────────────────────────────────────

for size_in, name_suffix in [
    (1.0, "1in"),
    (1.25, "1_25in"),
    (1.5, "1_5in"),
    (2.0, "2in"),
    (2.5, "2_5in"),
    (3.0, "3in"),
]:
    # Steel SCH10 grooved pipe, 1m length, OD approximates real sizes
    # 1"=33.4mm OD, 1.25"=42.2, 1.5"=48.3, 2"=60.3, 2.5"=73.0, 3"=88.9
    od_mm = {1.0: 33.4, 1.25: 42.2, 1.5: 48.3, 2.0: 60.3, 2.5: 73.0, 3.0: 88.9}[size_in]
    push(
        f"SM_Pipe_SCH10_{name_suffix}_1m",
        f"Steel SCH10 grooved pipe {size_in} inch OD, 1m unit length",
        rf"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
bpy.ops.mesh.primitive_cylinder_add(radius={od_mm / 2 / 1000:.5f}, depth=1.0, location=(0,0,0.5), vertices=20)
obj = bpy.context.active_object
obj.name = "SM_Pipe_SCH10_{name_suffix}_1m"
bpy.context.scene.cursor.location = (0,0,0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedPipe"); mat.metallic = 0.3; mat.roughness = 0.5
mat.diffuse_color = (0.75, 0.15, 0.15, 1.0); obj.data.materials.append(mat)
""",
    )

# ─── 5 Fittings ──────────────────────────────────────────────────────────

push(
    "SM_Fitting_Elbow_90_2in",
    "2-inch 90-degree elbow, grooved ends",
    r"""
import bpy, math
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
R = 0.030  # OD
LEG = 0.040
# Leg going +X
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG, location=(LEG/2, 0, 0), rotation=(0, 1.5708, 0), vertices=20)
# Corner sphere
bpy.ops.mesh.primitive_uv_sphere_add(radius=R, location=(0,0,0), segments=16, ring_count=12)
# Leg going +Z
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG, location=(0, 0, LEG/2), vertices=20)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Fitting_Elbow_90_2in"
bpy.context.scene.cursor.location = (0,0,0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_BlackIron"); mat.metallic = 0.5; mat.roughness = 0.6
mat.diffuse_color = (0.2,0.2,0.2,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Fitting_Elbow_90_1in",
    "1-inch 90-degree elbow, grooved ends",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
R = 0.017; LEG = 0.030
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG, location=(LEG/2,0,0), rotation=(0,1.5708,0), vertices=20)
bpy.ops.mesh.primitive_uv_sphere_add(radius=R, location=(0,0,0), segments=16, ring_count=12)
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG, location=(0,0,LEG/2), vertices=20)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Fitting_Elbow_90_1in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_BlackIron"); mat.metallic = 0.5; mat.roughness = 0.6
mat.diffuse_color = (0.2,0.2,0.2,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Fitting_Tee_Equal_2in",
    "2-inch equal tee, grooved ends, branches at 90°",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
R = 0.030; LEG = 0.040
# Main run along X
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG*2, location=(0,0,0), rotation=(0,1.5708,0), vertices=20)
# Branch going +Y
bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=LEG, location=(0,LEG/2,0), rotation=(1.5708,0,0), vertices=20)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Fitting_Tee_Equal_2in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_BlackIron"); mat.metallic = 0.5; mat.roughness = 0.6
mat.diffuse_color = (0.2,0.2,0.2,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Fitting_Reducer_2to1",
    "Concentric reducer: 2-inch to 1-inch, grooved ends, straight run",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Cone along +Z from R=0.030 at bottom to R=0.017 at top over 0.060 length
bpy.ops.mesh.primitive_cone_add(radius1=0.030, radius2=0.017, depth=0.060, location=(0,0,0.030), vertices=20)
obj = bpy.context.active_object; obj.name = "SM_Fitting_Reducer_2to1"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_BlackIron"); mat.metallic = 0.5; mat.roughness = 0.6
mat.diffuse_color = (0.2,0.2,0.2,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Fitting_Coupling_Grooved_2in",
    "2-inch rigid grooved coupling (joins two pipe ends)",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Hollow housing around pipe ends — ring-shape cylinder
bpy.ops.mesh.primitive_cylinder_add(radius=0.040, depth=0.080, location=(0,0,0.040), vertices=24)
outer = bpy.context.active_object
# Bolt bosses (2)
for ang, x_off in [(0, 0.038), (1.5708, -0.038)]:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x_off, 0, 0.040))
    b = bpy.context.active_object
    b.scale = (0.014, 0.020, 0.080)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Fitting_Coupling_Grooved_2in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_BlackIron"); mat.metallic = 0.5; mat.roughness = 0.6
mat.diffuse_color = (0.15,0.15,0.15,1.0); obj.data.materials.append(mat)
""",
)

# ─── 2 Valves ────────────────────────────────────────────────────────────

push(
    "SM_Valve_OSY_Gate_4in",
    "4-inch OS&Y gate valve (outside stem + yoke) — main water shutoff",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Body (roughly spherical/oval)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.075, location=(0,0,0.075), segments=24, ring_count=18)
body = bpy.context.active_object
body.scale = (1.0, 1.2, 1.0)
bpy.ops.object.transform_apply(scale=True)
# Inlet/outlet stubs along Y
bpy.ops.mesh.primitive_cylinder_add(radius=0.052, depth=0.060, location=(0,-0.090,0.075), rotation=(1.5708,0,0), vertices=20)
bpy.ops.mesh.primitive_cylinder_add(radius=0.052, depth=0.060, location=(0,0.090,0.075), rotation=(1.5708,0,0), vertices=20)
# Stem going up
bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.200, location=(0,0,0.220), vertices=12)
# Handwheel
bpy.ops.mesh.primitive_torus_add(major_radius=0.080, minor_radius=0.008, location=(0,0,0.320))
# Yoke arms (2)
for x in (-0.055, 0.055):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, 0, 0.220))
    a = bpy.context.active_object
    a.scale = (0.008, 0.014, 0.180)
    bpy.ops.object.transform_apply(scale=True)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Valve_OSY_Gate_4in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedValve"); mat.metallic = 0.3; mat.roughness = 0.5
mat.diffuse_color = (0.75,0.15,0.15,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Valve_Butterfly_4in_Grooved",
    "4-inch grooved butterfly valve with integral tamper switch",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Short cylindrical body
bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=0.065, location=(0,0,0.033), vertices=24)
body = bpy.context.active_object
# Actuator mount (box on top)
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.090))
a = bpy.context.active_object; a.scale = (0.060, 0.060, 0.050)
bpy.ops.object.transform_apply(scale=True)
# Handle/gear operator
bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.045, location=(0,0,0.137), vertices=16)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Valve_Butterfly_4in_Grooved"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedValve"); mat.metallic = 0.3; mat.roughness = 0.5
mat.diffuse_color = (0.75,0.15,0.15,1.0); obj.data.materials.append(mat)
""",
)

# ─── 2 Riser Components ──────────────────────────────────────────────────

push(
    "SM_Riser_FlowSwitch_2in",
    "2-inch paddle-type flow switch (detects water flow in riser)",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Body mounted on a tee
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.080))
body = bpy.context.active_object
body.scale = (0.060, 0.050, 0.080)
bpy.ops.object.transform_apply(scale=True)
# Mounting stub going down to pipe
bpy.ops.mesh.primitive_cylinder_add(radius=0.020, depth=0.040, location=(0,0,0.020), vertices=16)
# Conduit entry
bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.025, location=(0.040,0,0.100), rotation=(0,1.5708,0), vertices=12)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Riser_FlowSwitch_2in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedDevice"); mat.metallic = 0.2; mat.roughness = 0.5
mat.diffuse_color = (0.70,0.15,0.15,1.0); obj.data.materials.append(mat)
""",
)

push(
    "SM_Riser_PressureGauge",
    "2.5in pressure gauge on brass petcock valve",
    r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Gauge face (disc)
bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.015, location=(0,0,0.070), vertices=24)
gauge = bpy.context.active_object
# Stem/petcock to riser
bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.050, location=(0,0,0.025), vertices=12)
# Bezel
bpy.ops.mesh.primitive_torus_add(major_radius=0.034, minor_radius=0.004, location=(0,0,0.078))
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = gauge; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Riser_PressureGauge"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_Brass"); mat.metallic = 0.8; mat.roughness = 0.3
mat.diffuse_color = (0.75,0.65,0.3,1.0); obj.data.materials.append(mat)
""",
)


# ── Driver ──────────────────────────────────────────────────────────────────


def author_one(name: str, build_code: str) -> dict:
    """Wipe scene, run the build, export GLB. Returns status dict."""
    out_path = OUT_DIR / f"{name}.glb"
    # str() the path with forward slashes for Blender
    fp = str(out_path).replace("\\", "/")
    full_code = (
        build_code
        + f"""
import bpy
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(
    filepath="{fp}",
    export_format="GLB",
    use_selection=False,
    export_apply=True,
)
print("WROTE:{fp}")
"""
    )
    resp = run_code(full_code)
    return resp


def main() -> int:
    print(f"Authoring {len(COMPONENTS)} components via blender-mcp at {HOST}:{PORT}")
    print(f"Output dir: {OUT_DIR}")
    ok = 0
    failed: list[tuple[str, str]] = []
    for i, (name, desc, code) in enumerate(COMPONENTS, 1):
        print(f"\n[{i}/{len(COMPONENTS)}] {name}")
        print(f"  {desc}")
        r = author_one(name, code)
        res_str = str(r)
        if "WROTE:" in res_str:
            ok += 1
            print(f"  OK -> {OUT_DIR / (name + '.glb')}")
        else:
            failed.append((name, res_str[:200]))
            print(f"  FAIL: {res_str[:200]}")
        time.sleep(0.3)

    print(f"\n=== {ok}/{len(COMPONENTS)} components authored ===")
    if failed:
        print("Failed:")
        for n, msg in failed:
            print(f"  {n}: {msg}")
    return 0 if ok == len(COMPONENTS) else 1


if __name__ == "__main__":
    sys.exit(main())
