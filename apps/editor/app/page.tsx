'use client'

import {
  Editor,
  type SidebarTab,
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
import { CatalogPanel } from '@/components/halofire/CatalogPanel'
import { FireProtectionPanel } from '@/components/halofire/FireProtectionPanel'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
  {
    id: 'halofire-catalog',
    label: 'Catalog',
    component: CatalogPanel,
  },
  {
    id: 'halofire-fp',
    label: 'Fire Protection',
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
