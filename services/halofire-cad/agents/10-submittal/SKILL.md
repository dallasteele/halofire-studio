---
name: halofire-submittal
description: Emit DXF (AutoSprink-compatible) + GLB (web viewer) + IFC 4 (BIM coordination) from a Design.
inputs: [Design]
outputs: [design.dxf, design.glb, design.ifc]
model: deterministic
budget_seconds: 30
---

# Submittal Agent

## Purpose

Produce CAD-exchange deliverables a GC / architect / reviewer can
open in their native tools.

## Export formats

- **DXF via `ezdxf`** — AutoSprink-style layer naming
  (`FP-HEADS`, `FP-PIPE-2-5`, `FP-RISER`, …) + RGB colors per
  industry convention
- **GLB via `trimesh`** — pipe cylinders + head spheres in glTF 2.0;
  colored per pipe-size convention; used by the web bid viewer and
  Wade's iPad preview
- **IFC 4 via `ifcopenshell`** — entity shells (IfcSprinkler +
  IfcPipeSegment) for clash detection in Revit / Navisworks; full
  placement geometry is Phase D work

## Honesty

Known limitations are surfaced in `manifest.warnings` with stable
codes:

- `IFC_PLACEMENT_GEOMETRY_MISSING` — Alpha IFC lacks swept-solid
  pipe geometry
- `GLB_FALLBACK_PRIMITIVES` — GLB uses generic cylinder primitives,
  not manufacturer cut-sheet geometry
- `DXF_NO_DIMENSIONS` — DXF layers but no dimension lines (Phase D)

## Contract

- In: `Design`
- Out: dict of `{format: path}` + `{format_error: message}` for any
  export that failed

`export_all()` collects failures — a partial bundle is better than
none. Each failure is logged via `warn_swallowed` with a stable code.

## Budget

- 30 seconds for a 1000-head design
- `ifcopenshell` entity creation dominates; GLB is fast; DXF is
  trivial

## Exceptions

Subclassed: `DXFExportError`, `IFCExportError`, `GLBExportError`
(under `cad/exceptions.py`). Individual exporters either raise one
of these or return the path.

## Gateway tool binding

Invoked via orchestrator. Codex's `halofire_export` MCP tool is the
primary user entry point.

## Remediation

Phase D: inspect output in AutoCAD / BlenderBIM / Khronos validator,
fix any drift, add swept-solid pipe geometry in IFC.
