# OpenSCAD authoring

Parametric `.scad` source for the shapes behind every catalog
category. This is how we close the 276-SKU gap: instead of
hand-modelling each manufacturer variant in Blender, we render it
from a template on demand.

Run:

```
python packages/halofire-catalog/authoring/scad/render_from_catalog.py \
  --sku ANV-PIPE-SCH10-2in-21ft \
  --out packages/halofire-catalog/assets/glb/
```

The bridge picks the template by `CatalogEntry.category`, plugs in
`pipe_size_in` / `dim_l_cm` / `dim_h_cm`, and drives the `openscad`
CLI to emit a GLB. Requires OpenSCAD 2021.01+ with glTF export.

## Templates

| .scad file | covers |
|---|---|
| `pipe.scad` | `pipe_steel_sch10`, `pipe_steel_sch40`, `pipe_copper`, `pipe_cpvc` |
| `elbow_90.scad` | `fitting_elbow_90` |
| `elbow_45.scad` | `fitting_elbow_45` |
| `tee_equal.scad` | `fitting_tee_equal` |
| `tee_reducing.scad` | `fitting_tee_reducing` |
| `reducer.scad` | `fitting_reducer` |
| `coupling.scad` | `fitting_coupling_grooved`, `fitting_coupling_flexible` |
| `valve_inline.scad` | `valve_osy_gate`, `valve_butterfly`, `valve_check`, `valve_ball` |
| `head_pendant.scad` | `sprinkler_head_pendant`, `sprinkler_head_concealed` |
| `head_upright.scad` | `sprinkler_head_upright` |
| `head_sidewall.scad` | `sprinkler_head_sidewall` |
| `gauge.scad` | `riser_pressure_gauge` |
| `flow_switch.scad` | `riser_flow_switch` |
| `fdc.scad` | `external_fdc` |

Anything NOT in the table renders to a simple category-colored
bounding box via `placeholder.scad` — better than nothing in the
viewport, clearly marked in the BOM as "mesh placeholder".

## Design rules

1. Templates use real-world dimensions in **millimeters**.
2. Local origin = the part's geometric center (matches the
   connector-graph coordinate convention in `connectors.ts`).
3. Every template exposes `size_in` as the primary parameter.
4. No imports, no includes — each file stands alone so the CLI call
   can be a one-liner.

## Why OpenSCAD?

- Open source (GPL). Halo can rebuild any mesh without license
  fees.
- Deterministic — the same `size_in` always emits the same mesh
  bytes (important for golden tests).
- Text-only source lives in git. Diffing + PR review actually
  work.
- Installed footprint is small vs. running Blender headless.
