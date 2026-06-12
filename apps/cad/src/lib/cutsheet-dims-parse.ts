/**
 * Cut-sheet text → CutSheetDims (W15A).
 *
 * A scraped manufacturer cut sheet yields a text blob plus a known partType
 * and nominal size; this extracts the dimensions the emitters need by finding
 * numbers near their labels. Fields not found are OMITTED and reported in
 * `missing` — the caller flags or lets the emitter throw (honest, no invented
 * dimensions).
 */
import type { CutSheetDims } from './cutsheet-to-model';

export interface ParsedCutSheet {
  dims: CutSheetDims;
  missing: string[];
}

const LABELS: Record<string, RegExp> = {
  odIn: new RegExp('(?:outside\\s+diameter|\\bO\\.?D\\.?\\b)[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)', 'i'),
  wallIn: new RegExp('\\bwall(?:\\s+thickness)?\\b[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)', 'i'),
  lengthIn: new RegExp('(?:laying\\s+length|\\blength\\b)[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)', 'i'),
  centerToEndIn: new RegExp('(?:center\\s+to\\s+end|\\bC\\s*to\\s*E\\b)[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)', 'i'),
  branchCenterToEndIn: new RegExp('\\bbranch\\b[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)', 'i'),
};

const REQUIRED_BY_TYPE: Record<string, string[]> = {
  pipe: ['odIn', 'wallIn', 'lengthIn'],
  elbow: ['odIn', 'centerToEndIn'],
  tee: ['odIn', 'centerToEndIn', 'branchCenterToEndIn'],
  coupling: ['odIn', 'lengthIn'],
};

/** Extracts emitter dimensions from cut-sheet text. Pure; throws TypeError
 * only when text is not a string. */
export function parseCutSheetDims(
  text: string,
  partType: CutSheetDims['partType'],
  nominalIn: number,
): ParsedCutSheet {
  if (typeof text !== 'string') {
    throw new TypeError('parseCutSheetDims: text must be a string');
  }
  const found: Record<string, number> = {};
  for (const [field, re] of Object.entries(LABELS)) {
    const m = re.exec(text);
    if (m) {
      const value = Number.parseFloat(m[1]);
      if (Number.isFinite(value)) found[field] = value;
    }
  }
  const required = REQUIRED_BY_TYPE[partType] ?? ['odIn'];
  const missing = required.filter((f) => !(f in found));
  const dims = { partType, nominalIn, ...found } as CutSheetDims;
  return { dims, missing };
}
