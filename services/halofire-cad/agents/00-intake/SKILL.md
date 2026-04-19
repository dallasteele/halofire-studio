---
name: halofire-intake
description: Ingest an architect's PDF / IFC / DWG and emit a validated Building JSON with levels, rooms, walls, obstructions, stair shafts, and mech rooms.
inputs: [pdf_path, ifc_path, dwg_path]
outputs: [Building]
model: sonnet
---

# Intake Agent

Takes an architect's deliverable (PDF, IFC, or DWG) and extracts the
structured building data every downstream agent needs.

## The 4-layer PDF pipeline

Architect PDFs come in every variety — vector-native from Revit, PDF-
over-raster from AutoCAD's plotter, scanned paper from a 1980s job.
The pipeline tries layers in order until one produces high confidence:

1. **L1 pdfplumber** — parse vector strokes directly. Works on modern
   vector-native PDFs. Best signal: dense line geometry + bimodal
   stroke widths (thick walls, thin annotations).
2. **L2 OpenCV** — rasterize page, run Hough line detection + LSD line
   segment detector. Fills in where L1 has gaps. Required for PDFs that
   went through a plotter.
3. **L3 CubiCasa5k** — semantic floor-plan segmentation CNN (MIT
   licensed). Labels each pixel: wall / door / window / room. Lifted to
   polygon sets via contour extraction.
4. **L4 Claude Vision** — reads the rasterized plan + text callouts,
   returns structured annotations (room labels, dimension callouts,
   keynotes). Annotates rooms from L3 with their use class.

Each layer emits a confidence score. The orchestrator picks the
highest-confidence layer per geometric feature.

## Wall clustering algorithm

From L1 lines + L2 raster lines:
1. Filter to thick strokes (linewidth > 1.0 pt) — candidate walls
2. Snap to orthogonal axes (within 2° of 0° or 90°)
3. Find parallel line pairs within typical wall-thickness range
   (4-12" = 0.10-0.30 m at drawing scale)
4. Each pair → one Wall with start/end at the midline midpoint
5. Extend walls to nearest neighbor to close small gaps

## Room detection

Once walls are clustered:
1. Build a planar graph from wall endpoints
2. Enumerate minimal cycles (closed loops)
3. Each loop → a Room polygon via shapely
4. Label via L4 Claude Vision reading text fragments inside polygon

## Level separation

Architect PDFs have one floor plan per page. Use:
- Page title-block text ("LEVEL 1", "SECOND FLOOR PARKING")
- Sheet number ("A-101", "A-210")
- Page count heuristic when labels are ambiguous

## Scale detection

From title block text: `SCALE: 1/4" = 1'-0"` → 0.02083 model-units /
pt. Fallback: look for a dimension line with a known numeric callout
(e.g., "25'-0\"" along a 100 pt line → scale 0.25 ft/pt).

## Output

One `Building` JSON per input file, containing all levels found. The
caller saves this and passes it to the classifier agent.

## Known failure modes

- Scanned paper with no vector strokes → L1/L2 fail; L3/L4 must carry
- Non-orthogonal walls (angled buildings) → snap tolerance widened
- Double-line walls that are actually glass partitions → vision call
  disambiguates
- Merged stair shafts that span levels → architect often stacks 3
  floors on one page; page classifier catches and re-runs L1 per
  stacked region

## Gateway tool

Invokable via `halofire_intake_pdf { pdf_path, page_index? }`.
