// W2C — .hfcad project file codec (PURE). Serialize/deserialize the Project
// document so an operator's work SURVIVES (save/open + autosave). Fail-soft:
// deserializeProject NEVER throws — bad input returns { ok:false, reason }.
//
// HONESTY: a structural codec. It validates shape, never fabricates content; a
// file that fails validation is rejected with the failing field named.

import type { Project } from './model';

export const PROJECT_FILE_KIND = 'halofire-cad-project';
export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  kind: typeof PROJECT_FILE_KIND;
  version: number;
  savedAt: string;
  project: Project;
}

/** Serialize a project to .hfcad JSON text (2-space indent). */
export function serializeProject(project: Project, savedAt?: string): string {
  const file: ProjectFile = {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_FILE_VERSION,
    savedAt: savedAt ?? new Date().toISOString(),
    project,
  };
  return JSON.stringify(file, null, 2);
}

export type LoadResult =
  | { ok: true; project: Project; savedAt: string }
  | { ok: false; reason: string };

const HAZARDS = new Set(['LIGHT', 'ORDINARY_1', 'ORDINARY_2', 'EXTRA_1', 'EXTRA_2']);
const SOURCES = new Set(['none', 'dxf', 'pdf', 'manual']);

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function str(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Structural validation ONLY — no fabrication, names the failing field. */
export function validateProject(p: unknown): { ok: true } | { ok: false; reason: string } {
  const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (typeof p !== 'object' || p === null) return bad('project is not an object');
  const o = p as Record<string, unknown>;
  if (!str(o.id)) return bad('project.id missing');
  if (!str(o.name)) return bad('project.name missing');

  if (!Array.isArray(o.levels) || o.levels.length === 0) return bad('project.levels must be a non-empty array');
  for (const l of o.levels as Array<Record<string, unknown>>) {
    if (!str(l?.id) || !str(l?.name) || !fin(l?.elevationFt)) return bad('project.levels entry invalid');
  }

  const b = o.building as Record<string, unknown> | undefined;
  if (typeof b !== 'object' || b === null) return bad('project.building missing');
  if (!Array.isArray(b.walls)) return bad('building.walls must be an array');
  if (!Array.isArray(b.rooms)) return bad('building.rooms must be an array');
  if (!fin(b.scaleFtPerUnit) || (b.scaleFtPerUnit as number) <= 0) return bad('building.scaleFtPerUnit must be finite > 0');
  if (!SOURCES.has(b.source as string)) return bad('building.source invalid');
  for (const w of b.walls as Array<Record<string, unknown>>) {
    const s = w?.start as Record<string, unknown> | undefined;
    const e = w?.end as Record<string, unknown> | undefined;
    if (!fin(s?.x) || !fin(s?.y) || !fin(e?.x) || !fin(e?.y)) return bad('building.walls entry has non-finite start/end');
  }
  for (const r of b.rooms as Array<Record<string, unknown>>) {
    const poly = r?.polygon as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(poly) || poly.length < 3) return bad('building.rooms polygon needs >= 3 points');
    for (const pt of poly) if (!fin(pt?.x) || !fin(pt?.y)) return bad('building.rooms polygon point non-finite');
  }

  const n = o.network as Record<string, unknown> | undefined;
  if (typeof n !== 'object' || n === null) return bad('project.network missing');
  if (!Array.isArray(n.nodes) || !Array.isArray(n.segments) || !Array.isArray(n.remoteAreas)) {
    return bad('network.nodes/segments/remoteAreas must be arrays');
  }
  for (const seg of n.segments as Array<Record<string, unknown>>) {
    if (!str(seg?.from) || !str(seg?.to)) return bad('network.segments entry missing from/to');
    if (!fin(seg?.diameterIn) || (seg.diameterIn as number) <= 0) return bad('network.segments diameterIn must be > 0');
    if (!fin(seg?.lengthFt) || (seg.lengthFt as number) < 0) return bad('network.segments lengthFt must be >= 0');
  }

  const h = o.hazardDefaults as Record<string, unknown> | undefined;
  if (typeof h !== 'object' || h === null) return bad('project.hazardDefaults missing');
  if (!HAZARDS.has(h.defaultClass as string)) return bad('hazardDefaults.defaultClass invalid');
  if (!fin(h.defaultCeilingHt) || (h.defaultCeilingHt as number) <= 0) return bad('hazardDefaults.defaultCeilingHt must be > 0');

  return { ok: true };
}

/** Parse + validate .hfcad text. NEVER throws; defaults missing annotations to []. */
export function deserializeProject(json: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { ok: false, reason: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'file is not a JSON object' };
  const f = raw as Record<string, unknown>;
  if (f.kind !== PROJECT_FILE_KIND) return { ok: false, reason: `kind must be '${PROJECT_FILE_KIND}'` };
  if (!Number.isInteger(f.version) || (f.version as number) < 1 || (f.version as number) > PROJECT_FILE_VERSION) {
    return { ok: false, reason: `version must be a positive integer <= ${PROJECT_FILE_VERSION}` };
  }
  if (typeof f.project !== 'object' || f.project === null) return { ok: false, reason: 'project missing' };
  const v = validateProject(f.project);
  if (!v.ok) return { ok: false, reason: v.reason };
  const project = f.project as Project;
  if (!Array.isArray(project.annotations)) project.annotations = [];
  return { ok: true, project, savedAt: str(f.savedAt) ? (f.savedAt as string) : '' };
}
