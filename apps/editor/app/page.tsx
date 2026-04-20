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
import { SceneBootstrap } from '@/components/halofire/SceneBootstrap'

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

export default function Home() {
  return (
    <div className="h-screen w-screen">
      {/* Auto-populate the viewport on first session load so
          catalog SKUs + building shell are visible immediately.
          Addresses "none of these catalog items are real models" —
          now they render as a showcase at x=-50, z=-50. */}
      <SceneBootstrap projectId={ACTIVE_PROJECT_ID} />
      <Editor
        layoutVersion="v2"
        projectId="local-editor"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </div>
  )
}
