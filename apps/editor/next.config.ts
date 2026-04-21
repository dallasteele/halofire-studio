import type { NextConfig } from 'next'

// R10.1 (Next.js static export for Tauri bundling)
// Tauri desktop bundle needs a static export (no Node runtime inside
// the Tauri webview). Gate on TAURI_BUILD so regular `next build` / `next dev`
// keep full server-side behavior (API routes, dynamic segments, server actions).
const isTauriBuild = process.env.TAURI_BUILD === '1'

const nextConfig: NextConfig = {
  ...(isTauriBuild
    ? {
        output: 'export' as const,
        trailingSlash: true,
        // The Next image loader is a server feature; static export cannot use it.
        // Also suppress server-only experimental flags under Tauri.
      }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ['three', '@pascal-app/viewer', '@pascal-app/core', '@pascal-app/editor'],
  turbopack: {
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  ...(isTauriBuild
    ? {}
    : {
        experimental: {
          serverActions: {
            bodySizeLimit: '100mb',
          },
        },
      }),
  images: {
    unoptimized:
      isTauriBuild ||
      (process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
