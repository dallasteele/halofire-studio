'use client'

import {
  Editor,
  type SidebarTab,
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
import { RemoteAreaDraw } from '@/components/halofire/RemoteAreaDraw'
import { Ribbon, type RibbonCommand } from '@/components/halofire/Ribbon'
import { SceneBootstrap } from '@/components/halofire/SceneBootstrap'
import { StatusBar } from '@/components/halofire/StatusBar'
import { ToolOverlay } from '@/components/halofire/ToolOverlay'

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
]

function dispatchRibbon(cmd: RibbonCommand): void {
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
    <div className="flex h-screen w-screen flex-col">
      {/* Auto-populate the viewport on first session load so
          catalog SKUs + building shell are visible immediately.
          Addresses "none of these catalog items are real models" —
          now they render as a showcase at x=-50, z=-50. */}
      <SceneBootstrap projectId={ACTIVE_PROJECT_ID} />
      <CommandPalette />
      <ToolOverlay />
      <RemoteAreaDraw projectId={ACTIVE_PROJECT_ID} />
      <LiveCalc projectId={ACTIVE_PROJECT_ID} />
      <LayerPanel />
      {/* V2 Phase 5.3: selection-driven props for halofire items */}
      <HalofireProperties />
      <Ribbon onCommand={dispatchRibbon} />
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
      />
    </div>
  )
}
