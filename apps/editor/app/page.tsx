'use client'

import {
  DimensionTool,
  Editor,
  RevisionCloudTool,
  type SidebarTab,
  TextTool,
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
import { AutoDesignPanel } from '@/components/halofire/AutoDesignPanel'
import { CatalogPanel } from '@/components/halofire/CatalogPanel'
import { FireProtectionPanel } from '@/components/halofire/FireProtectionPanel'
import { ProjectBriefPanel } from '@/components/halofire/ProjectBriefPanel'
import {
  ProjectContextHeader,
} from '@/components/halofire/ProjectContextHeader'
import { CommandPalette } from '@/components/halofire/CommandPalette'
import { LayerPanel } from '@/components/halofire/LayerPanel'
import { HalofireProperties } from '@/components/halofire/HalofireProperties'
import { LiveCalc } from '@/components/halofire/LiveCalc'
import { NodeTags } from '@/components/halofire/NodeTags'
import { RemoteAreaDraw } from '@/components/halofire/RemoteAreaDraw'
import { Ribbon, type RibbonCommand } from '@/components/halofire/Ribbon'
import { SystemOptimizer } from '@/components/halofire/SystemOptimizer'
import { useLiveHydraulics } from '@/lib/hooks/useLiveHydraulics'
import { autoDimensionPipeRun } from '@halofire/core/drawing/auto-dim-pipe-runs'
import { SceneBootstrap } from '@/components/halofire/SceneBootstrap'
import { SceneChangeBridge } from '@/components/halofire/SceneChangeBridge'
import { HalofireNodeWatcher } from '@/components/halofire/HalofireNodeWatcher'
import { UndoStack } from '@/components/halofire/UndoStack'
import { AutoPilot } from '@/components/halofire/AutoPilot'
import { PipeHandles } from '@/components/halofire/PipeHandles'
import AutosaveManager from '@/components/halofire/AutosaveManager'
import { useCallback, useEffect, useState } from 'react'
import { StatusBar } from '@/components/halofire/StatusBar'
import { ToolOverlay } from '@/components/halofire/ToolOverlay'
import { ReportTab } from '@/components/halofire/ReportTab'
import { ToolManagerProvider, useToolManager } from '@/lib/tools'
// Side-effect imports — each module registers its Tool with the
// global ToolRegistry. This must run before ToolManagerProvider
// attempts to activate anything.
import '@/lib/tools'
import { connectHalofireSSE } from '@/lib/halofire/scene-store'
import { halofireGateway } from '@/lib/halofire/gateway-client'

const ACTIVE_PROJECT_ID = '1881-cooperative'

/**
 * Wrapper that prepends the persistent project + gateway-health
 * banner to every HaloFire sidebar panel. No more hunting through
 * tabs to learn which project you're in or whether the backend is
 * reachable.
 */
function withProjectChrome<T extends { projectId?: string }>(
  Component: React.ComponentType<T>,
  defaultProjectId: string = ACTIVE_PROJECT_ID,
): React.ComponentType<T> {
  return function WithChrome(props: T) {
    return (
      <div className="flex h-full flex-col">
        <ProjectContextHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Component
            {...props}
            projectId={props.projectId ?? defaultProjectId}
          />
        </div>
      </div>
    )
  }
}

function ScenePanel() {
  return (
    <div className="flex h-full flex-col">
      <ProjectContextHeader />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-neutral-400">
        <p className="italic">
          Built-in SitePanel handles this tab. HaloFire work lives under
          the other tabs.
        </p>
      </div>
    </div>
  )
}

const WrappedProjectBrief = withProjectChrome(
  ProjectBriefPanel as React.ComponentType<{ projectId?: string }>,
)
const WrappedAutoDesign = withProjectChrome(
  AutoDesignPanel as React.ComponentType<{ projectId?: string }>,
)
const WrappedCatalog = withProjectChrome(
  CatalogPanel as React.ComponentType<{ projectId?: string }>,
)
const WrappedFireProtection = withProjectChrome(
  FireProtectionPanel as React.ComponentType<{ projectId?: string }>,
)

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  { id: 'site', label: 'Scene', component: ScenePanel },
  {
    id: 'halofire-auto',
    label: 'Auto-Design',
    component: WrappedAutoDesign,
  },
  {
    id: 'halofire-project',
    label: 'Project',
    component: WrappedProjectBrief,
  },
  {
    id: 'halofire-catalog',
    label: 'Catalog',
    component: WrappedCatalog,
  },
  {
    id: 'halofire-fp',
    label: 'Manual FP',
    component: WrappedFireProtection,
  },
  {
    id: 'halofire-report',
    label: 'Report',
    component: withProjectChrome(
      ReportTab as React.ComponentType<{ projectId?: string }>,
    ) as unknown as React.ComponentType,
  },
]

/** Ribbon command → Phase B tool id. */
const RIBBON_TO_TOOL: Partial<Record<string, string>> = {
  'tool-sprinkler': 'sprinkler',
  'tool-pipe': 'pipe',
  'tool-fitting': 'fitting',
  'tool-hanger': 'hanger',
  'tool-sway-brace': 'sway_brace',
  'tool-remote-area': 'remote_area',
  'tool-move': 'move',
  'tool-resize': 'resize',
  'tool-measure': 'measure',
  'tool-section': 'section',
}

const SILENTLY_HANDLED_ELSEWHERE: readonly string[] = [
  // Legacy commands still consumed by existing overlays via
  // halofire:ribbon — not orphans, just handled upstream.
  'bid-new', 'bid-load', 'bid-save', 'auto-design',
  'layer-heads', 'layer-pipes', 'layer-walls', 'layer-zones',
  'snap-toggle', 'measure', 'section', 'remote-area',
  'auto-dim-pipe-runs', 'dimension', 'text', 'revision-cloud',
  'hydraulic-calc', 'rule-check', 'stress-test',
  'report-proposal', 'report-submittal', 'report-export-dxf',
  'report-export-ifc', 'report-nfpa-8', 'report-approve-submit',
  'report-send-to-client', 'hydraulics-optimize',
  'hydraulics-auto-peak', 'hydraulics-report', 'node-tags-toggle',
]

/**
 * R8.3 — Auto-Dim Pipe Runs.
 *
 * Walks the live scene store, groups pipes + heads per system, and
 * calls `autoDimensionPipeRun` from @halofire/core to produce
 * continuous Dimension objects along every branch and cross-main.
 *
 * The aggregated Dimension[] is:
 *   1. Stashed on `window.__hfAutoDim` so tests + dev tools can
 *      inspect the last run.
 *   2. Broadcast via `halofire:dimensions-ready` so a future sheet
 *      consumer can append them to the active SheetNode's
 *      `dimensions` array. If no system is found we emit a toast-ish
 *      event (`halofire:toast`) instead so the user sees feedback.
 */
async function handleAutoDim(): Promise<void> {
  if (typeof window === 'undefined') return
  const scene = (window as unknown as { __hfScene?: { getState: () => { nodes: Record<string, unknown> } } }).__hfScene
  const nodes: Record<string, unknown> = scene
    ? (scene.getState().nodes ?? {})
    : {}

  const systems: { id: string }[] = []
  const pipesBySystem = new Map<string, unknown[]>()
  const headsBySystem = new Map<string, unknown[]>()
  for (const raw of Object.values(nodes)) {
    const n = raw as { id?: string; type?: string; systemId?: string }
    if (!n?.type) continue
    if (n.type === 'system' && n.id) systems.push({ id: n.id })
    else if (n.type === 'pipe' && n.systemId) {
      const arr = pipesBySystem.get(n.systemId) ?? []
      arr.push(n)
      pipesBySystem.set(n.systemId, arr)
    } else if (n.type === 'sprinkler_head' && n.systemId) {
      const arr = headsBySystem.get(n.systemId) ?? []
      arr.push(n)
      headsBySystem.set(n.systemId, arr)
    }
  }

  if (systems.length === 0) {
    window.dispatchEvent(
      new CustomEvent('halofire:toast', {
        detail: {
          level: 'warn',
          message: 'no systems to dimension',
        },
      }),
    )
    ;(window as unknown as { __hfAutoDim?: unknown[] }).__hfAutoDim = []
    return
  }

  const dims: unknown[] = []
  for (const sys of systems) {
    const pipes = (pipesBySystem.get(sys.id) ?? []) as Parameters<
      typeof autoDimensionPipeRun
    >[1]
    const heads = (headsBySystem.get(sys.id) ?? []) as Parameters<
      typeof autoDimensionPipeRun
    >[2]
    const systemDims = autoDimensionPipeRun(sys, pipes, heads, {
      style_id: 'halofire.default',
      sheet_id: 'sheet_active',
      unit_display: 'ft_in',
    })
    dims.push(...systemDims)
  }

  ;(window as unknown as { __hfAutoDim?: unknown[] }).__hfAutoDim = dims
  window.dispatchEvent(
    new CustomEvent('halofire:dimensions-ready', {
      detail: { dimensions: dims },
    }),
  )
}

/**
 * Phase C — Hydraulics ribbon commands. Split out into its own
 * dispatcher so Phase B's parallel work on `dispatchRibbon` doesn't
 * collide. The top-level dispatcher delegates to this for any
 * `hydraulics-*` command; other Phase-C commands (`node-tags-toggle`,
 * `hydraulics-report`) route here too.
 *
 * Returns `true` when it handled the command so callers skip the
 * generic bridge.
 */
function dispatchHydraulicsRibbon(cmd: RibbonCommand): boolean {
  if (typeof window === 'undefined') return false
  const HANDLED: readonly RibbonCommand[] = [
    'hydraulics-optimize',
    'hydraulics-auto-peak',
    'hydraulics-report',
    'node-tags-toggle',
  ]
  if (!HANDLED.includes(cmd)) return false

  // All handled commands still broadcast on the bus so listeners
  // (SystemOptimizer, NodeTags) can react. They're idempotent — the
  // components filter by cmd id in their own event listeners.
  window.dispatchEvent(
    new CustomEvent('halofire:ribbon', { detail: { cmd } }),
  )

  if (cmd === 'hydraulics-auto-peak') {
    // Phase A's `/calculate` supports scoping via `scope_system_id`
    // today but not explicit remote-area selection. The heuristic
    // Auto Peak ships in Phase C is client-side: re-run the calc
    // and surface the result; the solver already picks the
    // hydraulically most-remote window (agent.py `_select_remote_area_heads`).
    // If a dedicated endpoint lands in Phase A.1 we'll call it here.
    const gw = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'
    void fetch(`${gw}/projects/${ACTIVE_PROJECT_ID}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => {
      window.dispatchEvent(
        new CustomEvent('halofire:scene-changed', {
          detail: { origin: 'auto-peak' },
        }),
      )
      window.dispatchEvent(
        new CustomEvent('halofire:toast', {
          detail: {
            level: 'info',
            message: 'auto-peak · re-ran hydraulics on most-remote area',
          },
        }),
      )
    }).catch(() => {/* LiveCalc will surface the error */})
  }

  if (cmd === 'hydraulics-report') {
    // The submittal agent writes `reports/hydraulic.pdf` and a JSON
    // payload next to it. Prefer the PDF; fall back to the JSON.
    const gw = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'
    const pdf = `${gw}/projects/${ACTIVE_PROJECT_ID}/deliverable/hydraulic_report.pdf`
    const json = `${gw}/projects/${ACTIVE_PROJECT_ID}/deliverable/hydraulic_report.json`
    // Try PDF first; if it's 404 the tab will show the JSON.
    const w = window.open(pdf, '_blank')
    if (!w) window.open(json, '_blank')
  }

  return true
}

function dispatchRibbon(cmd: RibbonCommand): void {
  // Phase C: hydraulics commands are handled in a sibling dispatcher.
  if (dispatchHydraulicsRibbon(cmd)) return
  // Bridge ribbon events into whatever panel reacts to them. Today
  // we fire a DOM event so any tab/sidebar can listen without a
  // shared store; the AutoDesignPanel handles 'auto-design', the
  // FireProtectionPanel handles layer toggles, etc.
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('halofire:ribbon', { detail: { cmd } }),
  )
  // Quick one-off actions without their own panel handler:
  if (cmd === 'report-send-to-client') {
    // Open the bundled bid demo in a new tab for now.
    window.open(`/bid-demo/${ACTIVE_PROJECT_ID}/proposal.html`, '_blank')
  }
  // V2 Phase 5.1: AHJ submittal — open the NFPA 8-section JSON in a
  // new tab. Once Phase 5.5 ships an HTML renderer this becomes a
  // styled doc; for now the JSON is the audit trail.
  if (cmd === 'report-nfpa-8') {
    const gw = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'
    window.open(
      `${gw}/projects/${ACTIVE_PROJECT_ID}/deliverable/nfpa_report.json`,
      '_blank',
    )
  }
  // V2 Phase 5.2: Wade-flow Approve & Submit — flips bid status,
  // posts to the gateway, opens the proposal preview.
  if (cmd === 'auto-dim-pipe-runs') {
    void handleAutoDim()
  }
  if (cmd === 'report-approve-submit') {
    const gw = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'
    fetch(`${gw}/projects/${ACTIVE_PROJECT_ID}/approve`, {
      method: 'POST',
    }).catch(() => {/* best effort */})
    window.open(`/bid-demo/${ACTIVE_PROJECT_ID}/proposal.html`, '_blank')
  }
}

export default function Home() {
  return (
    <ToolManagerProvider projectId={ACTIVE_PROJECT_ID}>
      <HomeInner />
    </ToolManagerProvider>
  )
}

function HomeInner() {
  const toolManager = useToolManager()
  // V2 step 5 — AutoPilot listens for job-started events that
  // AutoDesignPanel dispatches, then subscribes to the SSE stream.
  const [jobId, setJobId] = useState<string | null>(null)

  // Phase B — open SSE stream so mutations from other tabs / HAL /
  // auto-design runs reflect in the local scene store.
  useEffect(() => {
    const dispose = connectHalofireSSE(ACTIVE_PROJECT_ID)
    return () => dispose()
  }, [])

  // Phase B — ribbon dispatcher that knows about the ToolManager.
  const dispatchRibbonWithTools = useCallback((cmd: RibbonCommand): void => {
    if (typeof window === 'undefined') return
    // Phase B: tool activations
    const toolId = RIBBON_TO_TOOL[cmd]
    if (toolId) {
      void toolManager.activate(toolId)
      window.dispatchEvent(new CustomEvent('halofire:ribbon', { detail: { cmd } }))
      return
    }
    // Phase B: direct backend calls
    if (cmd === 'undo') {
      halofireGateway.undo(ACTIVE_PROJECT_ID)
        .then(() => {
          window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'undo' } }))
        })
        .catch((e) => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'warn', message: `undo: ${String(e)}` },
          }))
        })
      return
    }
    if (cmd === 'redo') {
      halofireGateway.redo(ACTIVE_PROJECT_ID)
        .then(() => {
          window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'redo' } }))
        })
        .catch((e) => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'warn', message: `redo: ${String(e)}` },
          }))
        })
      return
    }
    if (cmd === 'rules-run') {
      halofireGateway.runRules(ACTIVE_PROJECT_ID)
        .then(() => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'info', message: 'rules: check complete — see warnings' },
          }))
        })
        .catch((e) => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'error', message: `rules: ${String(e)}` },
          }))
        })
      return
    }
    if (cmd === 'bom-recompute') {
      halofireGateway.recomputeBom(ACTIVE_PROJECT_ID)
        .then(() => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'info', message: 'BOM recomputed' },
          }))
          window.dispatchEvent(new CustomEvent('halofire:bom-recomputed'))
        })
        .catch((e) => {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'error', message: `bom: ${String(e)}` },
          }))
        })
      return
    }
    // Fall through to legacy dispatcher
    dispatchRibbon(cmd)
    // Fire a "not implemented" toast when a command isn't recognized.
    // This is noisy, so we only warn for unknown commands.
    if (!(SILENTLY_HANDLED_ELSEWHERE as readonly string[]).includes(cmd) && !RIBBON_TO_TOOL[cmd]) {
      const known = ['undo','redo','rules-run','bom-recompute']
      if (!known.includes(cmd)) {
        window.dispatchEvent(new CustomEvent('halofire:toast', {
          detail: { level: 'warn', message: `Not implemented: ${cmd}` },
        }))
      }
    }
  }, [toolManager])

  // Phase F — listen for halofire:ribbon events fired by the
  // CommandPalette (which doesn't go through <Ribbon onCommand>)
  // and re-route tool-activation commands through the tool manager.
  // We key on `cmd.startsWith('tool-')` and only activate; we do not
  // re-broadcast the event (it was already fired by the palette).
  useEffect(() => {
    const onRibbon = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      const cmd = detail?.cmd
      if (!cmd) return
      const toolId = RIBBON_TO_TOOL[cmd]
      if (toolId) {
        // Avoid infinite loop — the palette already dispatched the
        // event, so we just activate the tool without re-dispatching.
        void toolManager.activate(toolId)
      }
    }
    window.addEventListener('halofire:ribbon', onRibbon as EventListener)
    return () => window.removeEventListener('halofire:ribbon', onRibbon as EventListener)
  }, [toolManager])

  // Phase C — page-level live hydraulics so NodeTags + StatusBar
  // share one subscription. LiveCalc keeps its own hook instance
  // so it stays self-contained, but both pull from the same
  // `/calculate` endpoint + SSE stream — the gateway's per-project
  // `SceneStore` debounces duplicate recalc bursts for us.
  const liveHyd = useLiveHydraulics({ projectId: ACTIVE_PROJECT_ID })
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail as { jobId?: string }
      if (detail?.jobId) setJobId(detail.jobId)
    }
    window.addEventListener('halofire:job-started', onStart as EventListener)
    return () =>
      window.removeEventListener(
        'halofire:job-started', onStart as EventListener,
      )
  }, [])

  // R1.6 — HydraulicSystem boot-install is now mounted in
  // HalofireNodeWatcher so the solver comes online as soon as the
  // scene store is live, even if an optional page-level component
  // fails to render.

  return (
    <div className="flex h-screen w-screen flex-col">
      {/* Auto-populate the viewport on first session load so
          catalog SKUs + building shell are visible immediately.
          Addresses "none of these catalog items are real models" —
          now they render as a showcase at x=-50, z=-50. */}
      <SceneBootstrap projectId={ACTIVE_PROJECT_ID} />
      {/* V2 Phase G: bridge granular halofire mutation events into
          a single halofire:scene-changed signal consumed by LiveCalc. */}
      <SceneChangeBridge />
      {/* Real scene-store subscription — fires scene-changed with
          origin='move'/'add-head'/'remove-head' whenever any
          halofire-tagged Pascal node actually mutates. */}
      <HalofireNodeWatcher />
      {/* R5.5: global Cmd/Ctrl-Z undo + optional history dropdown. */}
      <UndoStack />
      <CommandPalette />
      <ToolOverlay />
      <RemoteAreaDraw projectId={ACTIVE_PROJECT_ID} />
      <DimensionTool />
      <TextTool />
      <RevisionCloudTool />
      <LiveCalc projectId={ACTIVE_PROJECT_ID} />
      <NodeTags snapshot={liveHyd.snapshot} />
      <PipeHandles projectId={ACTIVE_PROJECT_ID} />
      {/* Phase F — top-level autosave. Guards internally on null
          project; becomes active once a LoadedProject is threaded
          through the project-loading flow. */}
      <AutosaveManager project={null} />
      <SystemOptimizer projectId={ACTIVE_PROJECT_ID} />
      <LayerPanel />
      {/* V2 Phase 5.3: selection-driven props for halofire items */}
      <HalofireProperties />
      {/* V2 step 5: live pipeline-stage SSE consumer — appears when
          AutoDesignPanel kicks off a job and dispatches job-started. */}
      <AutoPilot jobId={jobId} />
      <Ribbon onCommand={dispatchRibbonWithTools} />
      <div className="min-h-0 flex-1">
        <Editor
          layoutVersion="v2"
          projectId="local-editor"
          sidebarTabs={SIDEBAR_TABS}
          viewerToolbarLeft={<ViewerToolbarLeft />}
          viewerToolbarRight={<ViewerToolbarRight />}
        />
      </div>
      <StatusBar
        projectName="The Cooperative 1881 — Phase I"
        projectAddress="1881 W North Temple, Salt Lake City, UT"
        hydraulics={
          liveHyd.snapshot
            ? {
                pressure_psi:
                  liveHyd.snapshot.headline.supply_residual_psi,
                flow_gpm: liveHyd.snapshot.headline.required_flow_gpm,
                margin_psi: liveHyd.snapshot.headline.safety_margin_psi,
                velocity_warnings:
                  liveHyd.snapshot.headline.velocity_warnings,
              }
            : null
        }
      />
    </div>
  )
}
