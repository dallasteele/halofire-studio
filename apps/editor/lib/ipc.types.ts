/**
 * HaloFire Studio IPC — shared type surface.
 *
 * These types are the wire shape shared between the Tauri Rust
 * command layer (`apps/halofire-studio-desktop/src-tauri/src/commands/`)
 * and the Next editor runtime. When a field is also present in
 * `@halofire/schema` we re-export from there so there is one
 * authoritative shape; when the desktop host invents a structure
 * (e.g. `ProjectEntry` — a lightweight directory listing of
 * `.hfproj` dirs rather than the full `ProjectManifest`) we define
 * it inline here.
 */

import type { ProjectManifest } from '@halofire/schema'

// Re-export for convenience — callers that want the full manifest
// can import it through the ipc types module too.
export type { ProjectManifest }

/** Tauri host info (`greet` + `versions`). */
export interface HostVersions {
  app: string
  tauri: string
  rustc: string
}

/** Pipeline run arguments — mirrors `RunPipelineArgs` in Rust. */
export interface RunPipelineArgs {
  pdfPath: string
  projectId: string
  mode?: 'pipeline' | 'quickbid'
}

/** Pipeline start response — mirrors `PipelineStarted` in Rust. */
export interface PipelineStarted {
  jobId: string
}

/**
 * Pipeline job status — wire shape returned by `pipeline_status` and
 * by the FastAPI `GET /intake/status/:job_id` fallback. Matches the
 * status shape that AutoDesignPanel already consumes.
 */
export interface JobStatus {
  job_id: string
  project_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  percent: number
  steps_complete: string[]
  error?: string | null
  summary?: {
    project_id: string
    steps: Array<{
      step: string
      stats?: Record<string, unknown>
      error?: string | null
    }>
    files: Record<string, string>
  } | null
}

/** Catalog / OpenSCAD render arguments — mirrors `RenderScadArgs`. */
export interface RenderScadArgs {
  name: string
  params: Record<string, number | string | boolean>
  format?: 'glb' | 'stl'
}

/** Render result — mirrors Rust `RenderResult`. */
export interface RenderResult {
  path: string
  cache_hit: boolean
  cache_key: string
  engine: string
}

/** OpenSCAD runtime status — mirrors Rust `RuntimeStatus`. */
export interface RuntimeStatus {
  openscad_available: boolean
  cache_dir: string
  cached_entries: number
}

/** Catalog template entry — mirrors Rust `CatalogTemplate`. */
export interface CatalogTemplate {
  name: string
  path: string
  bytes: number
}

/** Project listing entry — mirrors Rust `ProjectEntry`. */
export interface ProjectEntry {
  id: string
  name: string
  path: string
  modified_epoch_ms: number
}

/**
 * A pipeline progress event. In Tauri mode this is delivered via
 * `listen('pipeline:progress')`; in fetch-fallback mode it is
 * synthesized from an SSE stream at `/intake/stream/:job_id`.
 */
export interface PipelineProgressEvent {
  job_id: string
  event: {
    step?: string
    stats?: Record<string, unknown>
    error?: string | null
    // The fallback SSE may deliver arbitrary JSON; we preserve it.
    [key: string]: unknown
  }
}

/** Catalog watch event — mirrors `catalog:updated` Tauri event. */
export interface CatalogUpdatedEvent {
  version: string
}
