# halofire-cad

The authoritative CAD backend for HaloFire Studio. Python service,
agent-driven, open-source CAD kernels only.

## What this is

A replacement for AutoSprink / HydraCAD / SprinkCAD built on:
- **IfcOpenShell** — IFC 4.x read/write, BIM data, QTO, BCF
- **Open CASCADE / pythonocc** — B-rep solid kernel for real pipes
- **ezdxf** — DXF 2018 drafting export
- **shapely + networkx** — 2D polygon ops + pipe-network topology
- **trimesh + pygltflib** — 3D mesh + glTF for web viewer
- **pymupdf + pdfplumber + opencv** — PDF extraction pipeline

## Directory layout

```
cad/                  Low-level CAD utilities (geometry, ifc_io, dxf_io, mesh_io)
agents/               The 13-agent roster — each autonomous, each with a SKILL.md
rules/                NFPA 13 rule YAML + per-AHJ amendment YAML
fixtures/             Real project data used for tests + training
tests/                pytest
```

## Agent roster

| # | Agent | Input | Output |
|---|---|---|---|
| 00 | intake | PDF/IFC/DWG | `Building` JSON |
| 01 | classifier | Rooms | Rooms with hazard_class |
| 02 | placer | Building + hazards | Head[] |
| 03 | router | Heads + Building | PipeSegment[] |
| 04 | hydraulic | PipeSegment[] + Supply | HydraulicResult |
| 05 | rulecheck | Full design | Violation[] |
| 06 | bom | Design | BOM rows + list pricing |
| 07 | labor | BOM | Labor breakdown |
| 08 | drafter | Design | AHJ sheet set PDF |
| 09 | proposal | Design + BOM + labor | Proposal PDF + XLSX |
| 10 | submittal | Full design | AHJ package (cut sheets + IFC) |
| 11 | field | Install photos | As-built deviation report |
| 12 | quickbid | sqft + hazard | Ballpark price (60 s path) |

Each agent is independently dispatchable via the halopenclaw gateway.

## Running

```bash
cd services/halofire-cad
uvicorn main:app --port 18791 --reload
```

## Status

Scaffolding phase. See `docs/plans/2026-04-18-real-ai-gen-design.md`.
