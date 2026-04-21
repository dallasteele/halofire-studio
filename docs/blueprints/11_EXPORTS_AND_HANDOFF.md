# Blueprint 11 — Exports & Handoff

**Scope:** Every output the estimator ships — DXF, DWG, IFC,
RVT, PDF sheet set, Hydralist .hlf, NFPA 8-report, proposal
PDF, AHJ submittal bundle, PE stamp, cut sheets.

## 1. Export matrix

| Format | Module | Consumers | Status |
|---|---|---|---|
| **DXF** | `agents/10-submittal/dxf_export.py` | AHJ, AutoCAD users | 🟡 partial |
| **DWG** | `services/halopenclaw-gateway/dwg_export.py` via `libredwg` | AHJ + GC | 🔲 P1 |
| **IFC** | `@halofire/ifc` + `services/halofire-cad/ifc_exporter.py` | BIM coordinators | 🟡 partial |
| **RVT** (Revit) | Autodesk Forge API or IFC→RVT via plugin | Revit shops | 🔲 P2 |
| **PDF** | `packages/hf-core/report/pdf-sheet-set.ts` (pdf-lib) | Everyone | 🟡 partial |
| **GLB** | `agents/10-submittal/glb_export.py` | Web viewer + coordination | ✅ |
| **Hydralist .hlf** | `agents/06-bom/hydralist.py` | Supplier handoff | ✅ |
| **NFPA 8-report (JSON)** | `agents/10-submittal/nfpa_report.py` | AHJ | ✅ |
| **Proposal PDF + HTML** | `agents/09-proposal/agent.py` | Client GC | ✅ |
| **XLSX stocklist** | `agents/06-bom/xlsx_export.py` | Accounting | 🟡 partial |
| **Cut-sheet PDF bundle** | `packages/hf-core/report/cut-sheets.ts` | AHJ | 🔲 P1 |

## 2. AHJ submittal bundle

A bound package that ships as one zip (or one printed-and-bound
package). Contents:

```
<project>_AHJ_Submittal_V1/
├─ 00-cover.pdf
├─ 01-site-plan.pdf
├─ 02-floor-plans/
│  ├─ FP-003.pdf  (Level 1)
│  ├─ FP-004.pdf  (Level 2)
│  └─ …
├─ 03-riser-diagram.pdf
├─ 04-hydraulic-calculations.pdf    (NFPA 13 §27 + Annex E)
├─ 05-stocklist.pdf
├─ 06-cut-sheets/
│  ├─ SM_Head_Pendant_Standard_K56.pdf   (manufacturer data)
│  ├─ SM_Valve_OSY_Gate_4in.pdf
│  └─ …
├─ 07-pe-stamp.pdf                   (signed title-block page)
├─ 08-material-list.xlsx             (stocklist in spreadsheet form)
├─ 09-supplier-hydralist.hlf
└─ MANIFEST.json                     (package contents + hashes)
```

Bundle assembly:

`packages/hf-core/report/ahj-submittal.ts`:

```typescript
export async function buildSubmittal(
  design: Design,
  project: Project,
  opts: { revision: string; pe_stamp?: PEStamp },
): Promise<SubmittalBundle>
```

Implementation orchestrates Rust IPC calls to each export
command + pdf-lib concat for the bound PDF.

## 3. PDF sheet-set renderer

`packages/hf-core/report/pdf-sheet-set.ts`:

```typescript
export async function renderSheetSet(
  sheets: SheetNode[],
  design: Design,
  outPath: string,
): Promise<void>
```

Per sheet:
1. Compose title-block SVG with substituted fields.
2. For each viewport: render three.js scene offscreen at the
   viewport's scale; convert to raster tile; place on paper.
3. Overlay SVG (annotations, dims, revision clouds).
4. Flatten via pdf-lib → single page.
5. Concat pages in sheet-index order.
6. Embed project + catalog version in PDF metadata.
7. Apply PE seal if `opts.pe_stamp` present.

Performance target: ≤ 30 s for a 20-sheet submittal.

## 4. Cut sheets

For every unique SKU in the BOM, the manufacturer's data sheet
is linked or embedded:

- If we have a cached manufacturer PDF (from the catalog
  crawler) → embed it.
- If not → render a placeholder with "Manufacturer data sheet
  — cross-reference SKU {SKU} with supplier before approval"
  and a QR code to the supplier page.

Placeholder templates in
`packages/halofire-catalog/cut-sheet-templates/`.

## 5. PE stamp

Licensed engineers stamp the drawings. Workflow:

1. User with PE role opens the project.
2. Reviews all sheets. Approves on a per-sheet basis or
   whole-bundle.
3. Applies stamp: a digital signature using the PE's cert
   (stored in OS keychain for v1.0; smart-card later).
4. The stamp image is overlaid on each stamped sheet's title
   block `pe_seal_slot`.
5. A `pe-stamped.pdf` page is appended with full sig metadata.

Audit trail: every stamp action logged in `audit.jsonl`.

Multi-PE projects (residential + commercial): separate stamps
per discipline; architectural-review gates commercial.

## 6. DXF export

`agents/10-submittal/dxf_export.py` (existing) produces:

- Model-space entities on named layers: `FP-HEADS`,
  `FP-PIPES-MAIN`, `FP-PIPES-BRANCH`, `FP-PIPES-DROP`,
  `FP-VALVES`, `FP-HANGERS`, `FP-DIMS`, `FP-ANNOT`, `0-TITLE`.
- Paper-space layouts if SheetNodes present.
- Dimensions as ACAD_DIMENSION entities.

Uses `ezdxf` (Python). Target: AutoCAD LT 2018+ compatible.

## 7. DWG export

LibreDWG or ODA File Converter wrapped. Fallback: export DXF
+ server-side DXF→DWG conversion.

## 8. IFC export

Building (slabs, walls, ceilings) + fire-protection systems
as IfcFireProtectionSystem / IfcSanitaryTerminal /
IfcPipeSegment / IfcPipeFitting / IfcValve / IfcSprinkler.

Round-trip tested against Navisworks Freedom + Solibri.

## 9. Hydralist (.hlf)

Already landed. `packages/halofire-cad/agents/06-bom/hydralist.py`.
Ships supplier-ready text file.

## 10. NFPA 8-report

Already landed. 8-section JSON per NFPA 13 §27 + Annex E:

1. Design density + area
2. Pipe schedule + HW friction
3. Device summary
4. Riser diagram description
5. Hydraulic calc worksheet
6. Demand curve (supply vs demand)
7. System summary
8. Pressure test + antifreeze notes

Rendered to PDF for the submittal bundle.

## 11. Proposal

Already landed. Client-facing PDF with:

- Cover + executive summary
- Scope of work (acknowledgements + inclusions + exclusions)
- Priced BOM summary (by system)
- Schedule
- Terms + PE signature

## 12. Stocklist grouping

BOM with fab-vs-field-cut, per-system, per-level, per-crew
breakdowns. XLSX with multiple tabs:

- Tab 1: Summary (total by category).
- Tab 2: Fab-shop (pipe ≥ 3" + all fittings that need shop
  prefabrication).
- Tab 3: Field-cut (pipe < 3" — cut on site).
- Tab 4 per system: one tab per SystemNode, with BOM roll-up.
- Tab 5: Labor (per LaborRow).

## 13. Tests

- `services/halofire-cad/tests/test_submittal_exports.py` —
  end-to-end bundle build, verify every expected file present.
- `packages/hf-core/tests/report/pdf-sheet-set.spec.ts` —
  render 3 sheets, assert PDF page count + raster dimensions.
- Round-trip DXF import in AutoCAD (manual, pre-release).

## 14. Open questions

- Cloud submittal portal integration (NYC, LA, Miami): P2.
  Stub now as "Open AHJ portal in browser + provide manifest".
- Revit export: Forge API vs IFC round-trip. Forge requires
  cloud + account; IFC works offline. Default to IFC; Forge as
  optional.
- E-signature standard for PE stamps: Adobe Sign vs DocuSign
  vs on-premise certificate. Local cert store for v1.0.
