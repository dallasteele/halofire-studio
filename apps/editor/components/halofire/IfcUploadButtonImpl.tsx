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

import { useCallback, useRef, useState } from 'react'

// Lazy-load @halofire/ifc — the @thatopen/components + web-ifc stack is
// heavyweight (WASM, 400 KB+) and has version-resolution quirks with
// @thatopen/fragments. Only load when the user actually picks a file.
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

export default function IfcUploadButtonImpl() {
  const [state, setState] = useState<IngestState>({ running: false })
  const inputRef = useRef<HTMLInputElement>(null)

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
      const lines = [
        `Imported: ${file.name}`,
        `  ${result.entitiesProcessed} IFC entities processed`,
        `  ${result.nodesCreated} Pascal nodes created`,
        `  ${result.skippedEntities.length} skipped`,
        `  ${result.durationMs.toFixed(0)} ms`,
      ]
      for (const w of result.warnings) {
        lines.push(`  WARN: ${w}`)
      }
      setState({ running: false, summary: lines.join('\n') })
    } catch (e) {
      setState({ running: false, error: String(e) })
    }
  }, [])

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
