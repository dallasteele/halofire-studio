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

// AutoDesignPanel wrapper that derives the project id from the
// loaded brief or defaults to 1881-cooperative for the demo loop.
function AutoDesignPanelWithDefault() {
  return <AutoDesignPanel projectId="1881-cooperative" />
}

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
  {
    id: 'halofire-project',
    label: 'Project',
    component: ProjectBriefPanel,
  },
  {
    id: 'halofire-auto',
    label: 'Auto-Design',
    component: AutoDesignPanelWithDefault,
  },
  {
    id: 'halofire-catalog',
    label: 'Catalog',
    component: CatalogPanel,
  },
  {
    // Kept for power-users who want manual step-by-step control.
    // New users land on Auto-Design.
    id: 'halofire-fp',
    label: 'Fire Protection (manual)',
    component: FireProtectionPanel,
  },
]

export default function Home() {
  return (
    <div className="h-screen w-screen">
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
