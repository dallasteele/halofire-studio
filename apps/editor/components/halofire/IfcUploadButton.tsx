'use client'

/**
 * IfcUploadButton — client-only wrapper around IfcUploadButtonImpl.
 *
 * The real implementation transitively imports @thatopen/components +
 * web-ifc (heavy WASM). SSR'ing those triggers a peer-dep mismatch
 * between @thatopen/components@2.4.x and @thatopen/fragments. Solve
 * both problems at once by using Next.js `dynamic()` with ssr:false.
 *
 * Side benefits:
 *  - First page paint is faster (no @thatopen bundle on initial load)
 *  - Peer-dep drift in the IFC stack can't 500 the whole page
 *  - Users who never touch the Fire Protection tab pay zero cost
 */

import dynamic from 'next/dynamic'

export const IfcUploadButton = dynamic(
  () => import('./IfcUploadButtonImpl'),
  {
    ssr: false,
    loading: () => (
      <button
        type="button"
        disabled
        className="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white opacity-50"
      >
        Loading IFC module…
      </button>
    ),
  },
)
