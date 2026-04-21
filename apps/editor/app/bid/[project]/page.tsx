// Server wrapper for the client-side bid viewer. Required so we can export
// `generateStaticParams` (client components cannot) under Next.js `output: 'export'`
// for the Tauri desktop bundle (R10.1).
import BidClient from './BidClient'

// Under static export we pre-render no project IDs — projects are fetched at
// runtime from the HaloPenClaw gateway, and the Tauri build is primarily for
// the authoring surface, not client-facing bid pages. Passing through an
// empty list + dynamicParams=false keeps the route out of `out/` while still
// satisfying the static-export requirement. Dev/server builds are unaffected.
export function generateStaticParams() {
  // Placeholder entry — static export requires at least one param. The actual
  // bid viewer is fetched at runtime via the gateway; this page is not a core
  // Tauri surface. A stub keeps `next build` happy under `output: 'export'`.
  return [{ project: '_placeholder' }]
}

export const dynamicParams = false

export default async function Page(props: { params: Promise<{ project: string }> }) {
  const { project } = await props.params
  // Static-export placeholder: don't mount the heavy client viewer at build time.
  if (process.env.TAURI_BUILD === '1' && project === '_placeholder') {
    return null
  }
  return <BidClient {...props} />
}
