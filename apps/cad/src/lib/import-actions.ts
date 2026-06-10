// HaloFire CAD — import orchestration glue between a chosen file and the store.
// Keeps the impure file-reading + parser wiring in one place so the LeftPanel button
// stays declarative. DXF is the reliable lane (true coords + real units -> walls +
// scale auto-applied); PDF renders a raster underlay for manual trace + set-scale.
//
// HONESTY: DXF geometry/scale come from the file's own data; PDF derives nothing —
// it is a raster to trace over, and its scale comes from the operator's set-scale.

import DxfParser from 'dxf-parser';
import { parseDxf, wallCandidates, type ParsedDxf } from './plan-import';
import { loadPdfPage } from './pdf-underlay';
import {
  buildKernelNetwork,
  KERNEL_HEAD_LAYER,
  KERNEL_PIPE_LAYER,
  type KernelNetwork,
} from './kernel-import';
import type { Building, Wall } from './model';
import type { Underlay } from '../store';

/** Outcome of an import attempt — honest success/empty/error, never fabricated. */
export interface ImportOutcome {
  ok: boolean;
  kind: 'dxf' | 'pdf' | 'unsupported';
  message: string;
  /** New building shell to apply (DXF lane only). */
  building?: Building;
  /** New trace underlay to set (both lanes). */
  underlay?: Underlay;
  /** Parsed DXF detail, for callers that want layer/scale info. */
  parsed?: ParsedDxf;
  /**
   * KERNEL lane: when the DXF carries the kernel layers (HALOFIRE_HEADS circles
   * + HALOFIRE_PIPES lines), the reconstructed sprinkler network. Provenance is
   * the predecessor engine's design — a geometry import, not an approved layout.
   */
  kernelNetwork?: KernelNetwork;
}

/** Lower-cased file extension (no dot), or ''. */
function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Import a DXF text body: parse, derive a real scale from its units, pull candidate
 * walls, and build a DXF underlay. Pure given the text + a parser (default real one).
 */
/** Default system elevation (ft) for plan-view kernel imports that carry no
 * elevations — matches the project default ceiling height convention. */
export const KERNEL_DEFAULT_ELEVATION_FT = 10;

export function importDxfText(
  text: string,
  fileName: string,
  parser: { parseSync(s: string): unknown } = new DxfParser(),
  opts?: { kernelElevationFt?: number },
): ImportOutcome {
  const parsed = parseDxf(text, parser);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: 'dxf',
      message: parsed.reason ?? 'DXF import failed',
      parsed,
    };
  }
  // KERNEL layers carry SYSTEM geometry (pipes/heads), never architecture —
  // excluding them prevents pipe runs becoming fake 10-ft wall fins in 3D.
  const isKernel = parsed.layers.includes(KERNEL_PIPE_LAYER) || parsed.layers.includes(KERNEL_HEAD_LAYER);
  const wallSource = isKernel
    ? { ...parsed, lines: parsed.lines.filter((l) => l.layer !== KERNEL_PIPE_LAYER && l.layer !== KERNEL_HEAD_LAYER) }
    : parsed;
  const walls: Wall[] = wallCandidates(wallSource);
  const building: Building = {
    walls,
    rooms: [],
    scaleFtPerUnit: parsed.ftPerUnit,
    source: 'dxf',
  };
  const underlay: Underlay = {
    kind: 'dxf',
    lines: parsed.lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 })),
    bounds: {
      minX: parsed.bounds.minX,
      minY: parsed.bounds.minY,
      maxX: parsed.bounds.maxX,
      maxY: parsed.bounds.maxY,
    },
    label: fileName,
  };
  // KERNEL lane: head circles + pipe lines on the kernel layers -> a real network.
  const headCircles = parsed.circles.filter((c) => c.layer === KERNEL_HEAD_LAYER);
  const pipeLines = parsed.lines.filter((l) => l.layer === KERNEL_PIPE_LAYER);
  let kernelNetwork: KernelNetwork | undefined;
  let kernelNote = '';
  if (headCircles.length > 0 || pipeLines.length > 0) {
    // Plan-view kernel files carry NO elevations. Place the system at the
    // documented default ceiling height (operator-adjustable) — at z=0 the
    // whole system rendered as a flat mat on the ground, which is wrong.
    kernelNetwork = buildKernelNetwork(headCircles, pipeLines, {
      ftPerUnit: parsed.ftPerUnit,
      zFt: opts?.kernelElevationFt ?? KERNEL_DEFAULT_ELEVATION_FT,
    });
    kernelNote =
      ` — KERNEL design detected: ${kernelNetwork.headCount} heads, ` +
      `${kernelNetwork.segments.length} pipes (predecessor-engine geometry)` +
      (walls.length === 0
        ? '. No architectural linework in this file — import/trace the building from the plan sheets.'
        : '');
  }
  return {
    ok: true,
    kind: 'dxf',
    message:
      `DXF: ${parsed.lines.length} lines, ${walls.length} wall candidates, ` +
      `units=${parsed.units} (${parsed.ftPerUnit} ft/unit)` + kernelNote,
    building,
    underlay,
    parsed,
    ...(kernelNetwork ? { kernelNetwork } : {}),
  };
}

/**
 * IMPURE. Import a chosen File: route DXF through importDxfText (auto walls + scale)
 * and PDF through loadPdfPage (raster underlay for manual trace). Returns an honest
 * outcome; unreadable files produce ok:false with a reason, never a fake plan.
 */
export async function importFile(
  file: File,
  opts: { pageNumber?: number } = {},
): Promise<ImportOutcome> {
  const e = ext(file.name);
  if (e === 'dxf') {
    try {
      const text = await file.text();
      return importDxfText(text, file.name);
    } catch (err) {
      return {
        ok: false,
        kind: 'dxf',
        message: `Could not read DXF: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (e === 'pdf') {
    try {
      const page = await loadPdfPage(file, { pageNumber: opts.pageNumber ?? 1 });
      const underlay: Underlay = {
        kind: 'pdf',
        canvas: page.canvas,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
        pageNumber: page.pageNumber,
        numPages: page.numPages,
        label: file.name,
      };
      return {
        ok: true,
        kind: 'pdf',
        message:
          `PDF page ${page.pageNumber}/${page.numPages} loaded as underlay — ` +
          `set the scale (two points) then trace walls/rooms`,
        underlay,
      };
    } catch (err) {
      return {
        ok: false,
        kind: 'pdf',
        message: `Could not render PDF: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return {
    ok: false,
    kind: 'unsupported',
    message: `Unsupported file type ".${e}" — choose a .dxf or .pdf plan`,
  };
}
