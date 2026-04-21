/**
 * project-io.ts — R5.2
 *
 * Create / load / save / autosave / audit API for the `.hfproj`
 * directory bundle defined in docs/blueprints/01_DATA_MODEL.md.
 *
 * This commit ships the **API surface + contracts** against an
 * in-memory filesystem stub so the editor's project lifecycle can
 * be exercised in tests today, without tying R5.2 to Tauri FS
 * plumbing. A real Tauri adapter backed by `@tauri-apps/plugin-fs`
 * lands in R10.3/R10.4 — at that point `createTauriFsAdapter()`
 * replaces `createMemoryFsAdapter()` behind `detectTauri()` and the
 * rest of the module (manifest/audit/correction/autosave logic)
 * does not change.
 *
 * TODO(R10.3): wire a Tauri FS adapter that writes real
 * `current.json.tmp → rename` atomic saves. Browser dev mode stays
 * on the in-memory stub and may additionally read design JSON from
 * the gateway via `GET /halofire/artifacts/<id>/design.json`.
 */

import { AuditEntry } from '@halofire/schema/audit'
import { Correction } from '@halofire/schema/correction'
import { Design } from '@halofire/schema/design'
import { ProjectManifest } from '@halofire/schema/project'

// ── Types ─────────────────────────────────────────────────────────

export interface LoadedProject {
  manifest: ProjectManifest
  design: Design
  /** Absolute path to corrections.jsonl within the bundle. */
  correctionsPath: string
  /** Absolute path to the `.hfproj` directory. */
  projectDir: string
}

export type ProjectLoadErrorCode =
  | 'corrupt'
  | 'too-new'
  | 'missing-file'
  | 'permission'
  | 'unknown'

export class ProjectLoadError extends Error {
  code: ProjectLoadErrorCode
  detail?: unknown
  constructor(
    code: ProjectLoadErrorCode,
    message: string,
    detail?: unknown,
  ) {
    super(message)
    this.name = 'ProjectLoadError'
    this.code = code
    this.detail = detail
  }
}

// ── Filesystem adapter abstraction ────────────────────────────────
//
// A tiny subset of fs semantics — only what project-io actually
// needs. Paths are POSIX-style strings; adapters normalize internally.

export interface FsAdapter {
  exists(path: string): Promise<boolean>
  mkdirp(path: string): Promise<void>
  readText(path: string): Promise<string>
  /** Atomic write — writes to `path.tmp` then renames over `path`. */
  writeTextAtomic(path: string, data: string): Promise<void>
  appendText(path: string, data: string): Promise<void>
  /** Epoch milliseconds of last modification, or -1 if not present. */
  mtimeMs(path: string): Promise<number>
  /** Test hook: override rename behavior (used to simulate crash). */
  _setRenameHook?(hook: ((from: string, to: string) => void) | null): void
}

/**
 * In-memory adapter: shared Map keyed by absolute path → file body.
 * Directories are implicit (any write under a path creates it).
 * `rename` is a Map delete+set inside `writeTextAtomic`, so we expose
 * a hook to make tests inject a throw and verify the original file
 * survives.
 */
export function createMemoryFsAdapter(): FsAdapter & {
  _files: Map<string, { data: string; mtime: number }>
} {
  const files = new Map<string, { data: string; mtime: number }>()
  let renameHook: ((from: string, to: string) => void) | null = null
  let clock = 1

  const now = () => {
    clock += 1
    return Date.now() + clock
  }

  return {
    _files: files,
    async exists(path: string) {
      return files.has(path)
    },
    async mkdirp(_path: string) {
      // No-op: directories are implicit in the flat map.
    },
    async readText(path: string) {
      const e = files.get(path)
      if (!e) {
        const err = new Error(`ENOENT: ${path}`) as Error & { code?: string }
        err.code = 'ENOENT'
        throw err
      }
      return e.data
    },
    async writeTextAtomic(path: string, data: string) {
      const tmp = `${path}.tmp`
      files.set(tmp, { data, mtime: now() })
      if (renameHook) renameHook(tmp, path)
      // Atomic replace: move tmp → path, then drop tmp.
      const cur = files.get(tmp)
      if (!cur) throw new Error(`tmp vanished: ${tmp}`)
      files.set(path, { data: cur.data, mtime: now() })
      files.delete(tmp)
    },
    async appendText(path: string, data: string) {
      const prev = files.get(path)?.data ?? ''
      files.set(path, { data: prev + data, mtime: now() })
    },
    async mtimeMs(path: string) {
      return files.get(path)?.mtime ?? -1
    },
    _setRenameHook(hook) {
      renameHook = hook
    },
  }
}

let _adapter: FsAdapter = createMemoryFsAdapter()

/** Test helper — swap the active adapter. */
export function _setFsAdapter(next: FsAdapter): void {
  _adapter = next
}

/** Test helper — read the active adapter. */
export function _getFsAdapter(): FsAdapter {
  return _adapter
}

// ── Path helpers ──────────────────────────────────────────────────

function join(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/')
}

function manifestPath(dir: string) {
  return join(dir, 'manifest.json')
}
function designCurrentPath(dir: string) {
  return join(dir, 'design', 'current.json')
}
function autosaveDesignPath(dir: string) {
  return join(dir, '.autosave', 'design.json')
}
function correctionsPathFor(dir: string) {
  return join(dir, 'corrections.jsonl')
}
function auditPathFor(dir: string) {
  return join(dir, 'audit.jsonl')
}

// ── Public API ────────────────────────────────────────────────────

/** Schema version this build writes and tolerates on load. */
export const CURRENT_SCHEMA_VERSION = 1 as const

const APP_VERSION = '0.1.0-R5.2'

function makeProjectId(): string {
  // Small deterministic-ish ID; collisions are project-id-scoped not
  // cryptographic. Good enough for the bundle's self-reference.
  const rand = Math.random().toString(36).slice(2, 10)
  return `hfp_${Date.now().toString(36)}_${rand}`
}

function emptyDesign(projectId: string, name: string, address: string): Design {
  return {
    project: { id: projectId, name, address },
    building: { levels: [], slabs: [], walls: [], ceilings: [] },
    systems: [],
    remote_areas: [],
    sources: [],
    issues: [],
    confidence: { overall: 0, by_agent: {} },
    deliverables: { submittal_pdfs: [] },
  }
}

export async function createProject(args: {
  parentDir: string
  name: string
  address: string
  firm: string
  designer: string
  units?: 'imperial' | 'metric'
  code_edition?: string
}): Promise<LoadedProject> {
  const fs = _adapter
  const safeName = args.name.replace(/[^\w.-]+/g, '_')
  const projectDir = join(args.parentDir, `${safeName}.hfproj`)

  if (await fs.exists(manifestPath(projectDir))) {
    throw new ProjectLoadError(
      'permission',
      `project already exists at ${projectDir}`,
    )
  }

  const now = new Date().toISOString()
  const projectId = makeProjectId()
  const manifest: ProjectManifest = {
    schema_version: CURRENT_SCHEMA_VERSION,
    project_id: projectId,
    name: args.name,
    address: args.address,
    firm: args.firm,
    designer: args.designer,
    units: args.units ?? 'imperial',
    code_edition: args.code_edition ?? 'NFPA 13 2022',
    created_at: now,
    modified_at: now,
    app_version: APP_VERSION,
    capabilities: [],
  }

  const design = emptyDesign(projectId, args.name, args.address)

  await fs.mkdirp(projectDir)
  await fs.mkdirp(join(projectDir, 'design'))
  await fs.mkdirp(join(projectDir, 'design', 'snapshots'))
  await fs.mkdirp(join(projectDir, '.autosave'))
  await fs.mkdirp(join(projectDir, 'underlays'))
  await fs.mkdirp(join(projectDir, 'exports'))

  await fs.writeTextAtomic(
    manifestPath(projectDir),
    JSON.stringify(manifest, null, 2),
  )
  await fs.writeTextAtomic(
    designCurrentPath(projectDir),
    JSON.stringify(design, null, 2),
  )
  // Initialize JSONL files as empty so appends / existence checks
  // behave uniformly regardless of whether the user has edited yet.
  await fs.writeTextAtomic(correctionsPathFor(projectDir), '')
  await fs.writeTextAtomic(auditPathFor(projectDir), '')

  const loaded: LoadedProject = {
    manifest,
    design,
    correctionsPath: correctionsPathFor(projectDir),
    projectDir,
  }
  await appendAudit(loaded, {
    ts: now,
    actor: args.designer,
    action: 'create',
    target: projectId,
  })
  return loaded
}

export async function loadProject(path: string): Promise<LoadedProject> {
  const fs = _adapter
  const mPath = manifestPath(path)
  const dPath = designCurrentPath(path)

  const [mExists, dExists] = await Promise.all([
    fs.exists(mPath),
    fs.exists(dPath),
  ])
  if (!mExists) {
    throw new ProjectLoadError(
      'missing-file',
      `manifest.json not found at ${mPath}`,
    )
  }
  if (!dExists) {
    throw new ProjectLoadError(
      'missing-file',
      `design/current.json not found at ${dPath}`,
    )
  }

  let manifestRaw: unknown
  let designRaw: unknown
  try {
    manifestRaw = JSON.parse(await fs.readText(mPath))
  } catch (err) {
    throw new ProjectLoadError('corrupt', 'manifest.json is not valid JSON', err)
  }
  try {
    designRaw = JSON.parse(await fs.readText(dPath))
  } catch (err) {
    throw new ProjectLoadError(
      'corrupt',
      'design/current.json is not valid JSON',
      err,
    )
  }

  // Pre-check schema_version before strict parsing so we surface
  // 'too-new' with a clearer message than a generic zod failure.
  const sv = (manifestRaw as { schema_version?: unknown })?.schema_version
  if (typeof sv === 'number' && sv > CURRENT_SCHEMA_VERSION) {
    throw new ProjectLoadError(
      'too-new',
      `manifest schema_version ${sv} is newer than this build (${CURRENT_SCHEMA_VERSION})`,
      { schema_version: sv },
    )
  }

  const manifestParsed = ProjectManifest.safeParse(manifestRaw)
  if (!manifestParsed.success) {
    throw new ProjectLoadError(
      'corrupt',
      'manifest.json failed schema validation',
      manifestParsed.error.issues,
    )
  }
  const designParsed = Design.safeParse(designRaw)
  if (!designParsed.success) {
    throw new ProjectLoadError(
      'corrupt',
      'design/current.json failed schema validation',
      designParsed.error.issues,
    )
  }

  return {
    manifest: manifestParsed.data,
    design: designParsed.data,
    correctionsPath: correctionsPathFor(path),
    projectDir: path,
  }
}

export async function saveProject(project: LoadedProject): Promise<void> {
  const fs = _adapter
  const now = new Date().toISOString()
  const nextManifest: ProjectManifest = {
    ...project.manifest,
    modified_at: now,
    app_version: APP_VERSION,
  }
  // Design first, then manifest — if we crash between the two, the
  // manifest still points at a valid on-disk design.
  await fs.writeTextAtomic(
    designCurrentPath(project.projectDir),
    JSON.stringify(project.design, null, 2),
  )
  await fs.writeTextAtomic(
    manifestPath(project.projectDir),
    JSON.stringify(nextManifest, null, 2),
  )
  project.manifest = nextManifest
  await appendAudit(project, {
    ts: now,
    actor: project.manifest.designer,
    action: 'save',
    target: project.manifest.project_id,
  })
}

export async function autosaveProject(project: LoadedProject): Promise<void> {
  const fs = _adapter
  await fs.mkdirp(join(project.projectDir, '.autosave'))
  // Autosave deliberately does NOT touch manifest.modified_at —
  // "modified" tracks user-intent saves, not crash-recovery snapshots.
  await fs.writeTextAtomic(
    autosaveDesignPath(project.projectDir),
    JSON.stringify(project.design),
  )
}

export async function checkAutosaveRecovery(
  path: string,
): Promise<string | null> {
  const fs = _adapter
  const autosave = autosaveDesignPath(path)
  const current = designCurrentPath(path)
  const [a, c] = await Promise.all([fs.mtimeMs(autosave), fs.mtimeMs(current)])
  if (a < 0) return null
  if (a > c) return autosave
  return null
}

export async function appendCorrection(
  project: LoadedProject,
  correction: unknown,
): Promise<void> {
  const parsed = Correction.safeParse(correction)
  if (!parsed.success) {
    throw new ProjectLoadError(
      'corrupt',
      'correction failed schema validation',
      parsed.error.issues,
    )
  }
  const fs = _adapter
  const line = `${JSON.stringify(parsed.data)}\n`
  await fs.appendText(project.correctionsPath, line)
}

export async function appendAudit(
  project: LoadedProject,
  entry: unknown,
): Promise<void> {
  const parsed = AuditEntry.safeParse(entry)
  if (!parsed.success) {
    throw new ProjectLoadError(
      'corrupt',
      'audit entry failed schema validation',
      parsed.error.issues,
    )
  }
  const fs = _adapter
  const line = `${JSON.stringify(parsed.data)}\n`
  await fs.appendText(auditPathFor(project.projectDir), line)
}
