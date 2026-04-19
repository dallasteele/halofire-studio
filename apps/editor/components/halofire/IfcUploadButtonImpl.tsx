'use client'

/**
 * IfcUploadButton — drop-in file input that parses an architect's IFC
 * via @halofire/ifc and populates the Pascal scene.
 *
 * M1 week 3 scope: upload + parse + return summary. The actual walk +
 * node creation in mapper.ts is still a stub (documented in BUILD_LOG
 * entry 06); this button exercises the upload path end-to-end and
 * surfaces the warning so user sees real feedback.
 */

import { useScene } from '@pascal-app/core'
import { useCallback, useRef, useState } from 'react'

// Lazy-load @halofire/ifc — web-ifc WASM is ~1.2 MB. Only load when the
// user actually picks a file.
async function loadIfcImporter() {
  const { importIfcFile } = await import('@halofire/ifc')
  return importIfcFile
}

interface IngestState {
  running: boolean
  summary?: string
  error?: string
  filename?: string
}

/**
 * Translate a mapper-produced PlannedNode into a Pascal node shape
 * that useScene.createNode accepts. Pascal's strict Zod schemas are
 * the source of truth at runtime; we construct the minimum viable
 * payload for each node type + let the validator fill defaults.
 */
function translatePlannedNode(pn: {
  id: string
  type: string
  name?: string
  elevationM?: number
  hazard?: string
  ifcGuid?: string
}): Record<string, unknown> {
  const base = {
    id: pn.id,
    type: pn.type,
    name: pn.name,
    userData: {
      ifc_guid: pn.ifcGuid,
      ifc_hazard_inferred: pn.hazard,
    },
  }
  switch (pn.type) {
    case 'site':
      return { ...base, position: [0, 0, 0], children: [] }
    case 'building':
      return { ...base, position: [0, 0, 0], children: [] }
    case 'level':
      return { ...base, elevation: pn.elevationM ?? 0, children: [] }
    case 'wall':
      // Minimal wall; geometry walk adds real start/end + thickness later
      return { ...base, start: [0, 0, 0], end: [1, 0, 0], thickness: 0.2, height: 3 }
    case 'slab':
      return { ...base, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]], thickness: 0.2, z: 0 }
    case 'zone':
      return {
        ...base,
        polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
        hazard: pn.hazard,
      }
    default:
      return base
  }
}

export default function IfcUploadButtonImpl() {
  const [state, setState] = useState<IngestState>({ running: false })
  const inputRef = useRef<HTMLInputElement>(null)
  const createNode = useScene((s) => s.createNode)

  const onFileChosen = useCallback(async (file: File | null) => {
    if (!file) return
    setState({ running: true, filename: file.name })
    try {
      const importIfcFile = await loadIfcImporter()
      const buffer = await file.arrayBuffer()
      const result = await importIfcFile({
        file: buffer,
        filename: file.name,
        coordinateSystemFlip: 'ifc_to_pascal',
        preserveGuids: true,
      })

      // Spawn planned nodes into Pascal scene. The mapper returns them
      // in hierarchy order (sites first, then buildings, storeys, etc.)
      // so parentId lookups always succeed.
      let spawned = 0
      const failures: string[] = []
      for (const pn of result.plannedNodes ?? []) {
        try {
          const pascalNode = translatePlannedNode(pn)
          // @ts-expect-error — runtime accepts our constructed shape
          createNode(pascalNode, pn.parentId)
          spawned++
        } catch (e) {
          failures.push(`${pn.type}:${pn.name ?? pn.id}: ${String(e)}`)
        }
      }

      const lines = [
        `Imported: ${file.name}`,
        `  ${result.entitiesProcessed} IFC entities processed`,
        `  ${result.nodesCreated} Pascal nodes planned`,
        `  ${spawned} spawned in scene`,
        `  ${failures.length} failures`,
        `  ${result.skippedEntities.length} skipped`,
        `  ${result.durationMs.toFixed(0)} ms`,
      ]
      for (const w of result.warnings) {
        lines.push(`  WARN: ${w}`)
      }
      for (const f of failures.slice(0, 5)) {
        lines.push(`  FAIL: ${f}`)
      }
      setState({ running: false, summary: lines.join('\n') })
    } catch (e) {
      setState({ running: false, error: String(e) })
    }
  }, [createNode])

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={state.running}
        className="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {state.running
          ? `Parsing ${state.filename ?? '…'}`
          : 'Upload IFC file'}
      </button>
      {(state.summary || state.error) && (
        <pre
          className={`mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded p-2 text-[10px] leading-tight ${
            state.error
              ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
              : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
          }`}
        >
          {state.error ?? state.summary}
        </pre>
      )}
    </div>
  )
}
