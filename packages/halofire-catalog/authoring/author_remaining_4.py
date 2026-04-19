"""Author the remaining 4 components (valves + riser parts) via blender-mcp.

Fresh pass — separate file so we can isolate any problematic component
without rerunning the whole 20.
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
    with socket.create_connection((HOST, PORT), timeout=120) as s:
        s.sendall(json.dumps(command).encode())
        chunks = []
        s.settimeout(120)
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
        return {"error": "empty"}
    return json.loads(raw.decode("utf-8"))


def run_and_export(name: str, code: str) -> bool:
    out = str(OUT_DIR / f"{name}.glb").replace("\\", "/")
    full = code + f"""
import bpy
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(filepath="{out}", export_format="GLB", use_selection=False, export_apply=True)
print("OK")
"""
    r = send({"type": "execute_code", "params": {"code": full}})
    return (OUT_DIR / f"{name}.glb").exists()


# ── 4 remaining components, simplified geometry ────────────────────────────

COMPS = [
    (
        "SM_Valve_OSY_Gate_4in",
        r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Body (cylinder, simplified)
bpy.ops.mesh.primitive_cylinder_add(radius=0.090, depth=0.150, location=(0,0,0.075), vertices=20)
body = bpy.context.active_object; body.name = "Body"
# Stem going up
bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.180, location=(0,0,0.240), vertices=12)
# Handwheel
bpy.ops.mesh.primitive_torus_add(major_radius=0.080, minor_radius=0.008, location=(0,0,0.330),
                                  major_segments=16, minor_segments=8)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Valve_OSY_Gate_4in"
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedValve"); mat.diffuse_color = (0.75, 0.15, 0.15, 1.0)
obj.data.materials.append(mat)
""",
    ),
    (
        "SM_Valve_Butterfly_4in_Grooved",
        r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=0.065, location=(0,0,0.033), vertices=20)
body = bpy.context.active_object; body.name = "Body"
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.090))
act = bpy.context.active_object; act.scale = (0.060, 0.060, 0.050)
bpy.ops.object.transform_apply(scale=True)
bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.045, location=(0,0,0.140), vertices=16)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Valve_Butterfly_4in_Grooved"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedValve"); mat.diffuse_color = (0.75,0.15,0.15,1.0)
obj.data.materials.append(mat)
""",
    ),
    (
        "SM_Riser_FlowSwitch_2in",
        r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Mount stub to pipe
bpy.ops.mesh.primitive_cylinder_add(radius=0.020, depth=0.040, location=(0,0,0.020), vertices=16)
stub = bpy.context.active_object; stub.name = "Stub"
# Enclosure box
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0,0,0.080))
enc = bpy.context.active_object; enc.scale = (0.060, 0.050, 0.080)
bpy.ops.object.transform_apply(scale=True)
# Conduit entry
bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.025, location=(0.040,0,0.100),
                                     rotation=(0, 1.5708, 0), vertices=12)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = stub; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Riser_FlowSwitch_2in"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_RedDevice"); mat.diffuse_color = (0.70,0.15,0.15,1.0)
obj.data.materials.append(mat)
""",
    ),
    (
        "SM_Riser_PressureGauge",
        r"""
import bpy
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
# Petcock stem
bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.050, location=(0,0,0.025), vertices=12)
stem = bpy.context.active_object; stem.name = "Stem"
# Gauge face
bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.015, location=(0,0,0.070), vertices=20)
# Bezel ring
bpy.ops.mesh.primitive_torus_add(major_radius=0.034, minor_radius=0.004, location=(0,0,0.078),
                                  major_segments=16, minor_segments=6)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = stem; bpy.ops.object.join()
obj = bpy.context.active_object; obj.name = "SM_Riser_PressureGauge"
bpy.context.scene.cursor.location = (0,0,0); bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("M_Brass"); mat.diffuse_color = (0.75,0.65,0.3,1.0)
obj.data.materials.append(mat)
""",
    ),
]


def main() -> int:
    print(f"Authoring {len(COMPS)} remaining components...")
    ok = 0
    for name, code in COMPS:
        print(f"  {name}...", end=" ", flush=True)
        if run_and_export(name, code):
            print("OK")
            ok += 1
        else:
            print("FAIL")
        time.sleep(0.5)
    print(f"\n{ok}/{len(COMPS)} authored")
    return 0 if ok == len(COMPS) else 1


if __name__ == "__main__":
    sys.exit(main())
