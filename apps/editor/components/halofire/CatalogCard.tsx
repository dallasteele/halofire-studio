'use client'

/**
 * Phase H.4 — one SKU thumbnail card in the catalog grid.
 *
 * Presentational only. Parent owns the click handler + any filtering.
 * Paints:
 *   - 120×120px preview: pre-rendered thumbnail if it exists, else a
 *     lazy-mounted `<Canvas>` rendering the GLB, else a kind glyph
 *   - status chip (top-right) with earthen palette
 *   - manufacturer chip (bottom-left, gold small-caps)
 *   - part number (bottom-right, JetBrains Mono)
 */

import { useEffect, useRef, useState } from 'react'
import type { CatalogPart } from '@halofire/core/catalog/load'
import {
  type EnrichmentStatus,
  useEffectiveStatus,
  useInFlight,
} from '../../lib/halofire/catalog-store'

// ── Status chip palette (earthen, Phase G tokens) ───────────────────

export interface StatusChipSpec {
  label: string
  color: string // token reference, CSS var
  filled: boolean
  description: string
}

export const STATUS_CHIP_MAP: Record<EnrichmentStatus, StatusChipSpec> = {
  validated: {
    label: 'OK',
    color: 'var(--color-hf-moss)',
    filled: true,
    description: 'Mesh derived from manufacturer photo + validated.',
  },
  needs_review: {
    label: 'REVIEW',
    color: 'var(--color-hf-gold)',
    filled: true,
    description: 'Pipeline completed with low confidence; human review needed.',
  },
  rejected: {
    label: 'REJECTED',
    color: 'var(--color-hf-brick)',
    filled: true,
    description: 'Mask validator rejected every SAM output. Re-run or flag.',
  },
  fallback: {
    label: 'FALLBACK',
    color: 'var(--color-hf-ink-mute)',
    filled: false,
    description: 'Using crude SCAD render — accuracy: low.',
  },
  not_yet_run: {
    label: 'PENDING',
    color: 'var(--color-hf-ink-deep)',
    filled: false,
    description: 'Enrichment has not been attempted for this SKU yet.',
  },
}

/** Exposed for tests — pure mapper. */
export function statusChipFor(status: EnrichmentStatus): StatusChipSpec {
  return STATUS_CHIP_MAP[status]
}

// ── Small inline kind glyphs (reused aesthetic from Ribbon) ─────────

function KindGlyph({ kind }: { kind: string }) {
  const stroke = 'var(--color-hf-ink-dim)'
  const common = {
    width: 40,
    height: 40,
    fill: 'none',
    stroke,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'sprinkler_head':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        </svg>
      )
    case 'pipe_segment':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M4 12h16" />
          <path d="M4 9v6M20 9v6" />
          <path d="M10 9v6M14 9v6" />
        </svg>
      )
    case 'fitting':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M4 12h8v-8" />
          <path d="M12 12v8" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      )
    case 'valve':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M4 12h16" />
          <path d="M10 8v8h4V8z" />
          <path d="M12 6v-2" />
        </svg>
      )
    case 'hanger':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 3v8" />
          <path d="M6 11h12" />
          <path d="M8 11v8M16 11v8" />
        </svg>
      )
    case 'device':
    case 'fdc':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="5" y="5" width="14" height="14" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      )
    case 'structural':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M4 4h16v16H4z" />
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="5" />
        </svg>
      )
  }
}

// ── Thumbnail preview ───────────────────────────────────────────────
//
// Strategy (per spec):
//   1. try `/halofire-catalog/thumbs/<sku>.png` — static pre-render
//   2. if not found AND card is in viewport, mount a mini `<Canvas>`
//      to render the GLB at 120px (deferred for performance)
//   3. fall back to the kind glyph
//
// We do a HEAD fetch to decide 1 vs 2/3 so hiding 404s out of the
// <img> network tab stays quiet.

type ThumbStrategy = 'loading' | 'image' | 'glyph' | 'canvas'

function useThumbStrategy(
  sku: string,
  hasEnrichedGlb: boolean,
  enabled: boolean = true,
): {
  strategy: ThumbStrategy
  imageUrl: string | null
} {
  const [strategy, setStrategy] = useState<ThumbStrategy>('loading')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStrategy('glyph')
      setImageUrl(null)
      return
    }
    let cancelled = false
    const url = `/halofire-catalog/thumbs/${sku}.png`
    fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setImageUrl(url)
          setStrategy('image')
        } else if (hasEnrichedGlb) {
          // Canvas render deferred to intersection observer in the card.
          setStrategy('canvas')
        } else {
          setStrategy('glyph')
        }
      })
      .catch(() => {
        if (cancelled) return
        setStrategy(hasEnrichedGlb ? 'canvas' : 'glyph')
      })
    return () => {
      cancelled = true
    }
  }, [sku, hasEnrichedGlb, enabled])

  return { strategy, imageUrl }
}

// ── The card ────────────────────────────────────────────────────────

export interface CatalogCardProps {
  part: CatalogPart
  selected?: boolean
  onOpen: (sku: string) => void
  /** When true (tests / Node SSR), skip thumbnail probing. */
  disableThumb?: boolean
  /** Test override — bypass the store hooks so SSR snapshots don't
   *  need a zustand dispatcher. Runtime usage always omits these. */
  statusOverride?: EnrichmentStatus
  inFlightOverride?: boolean
}

export function CatalogCard({
  part,
  selected = false,
  onOpen,
  disableThumb = false,
  statusOverride,
  inFlightOverride,
}: CatalogCardProps) {
  const hookedStatus = useEffectiveStatus(part.sku)
  const hookedInFlight = useInFlight(part.sku)
  const status = statusOverride ?? hookedStatus
  const inFlight = inFlightOverride ?? hookedInFlight
  const chip = STATUS_CHIP_MAP[status]
  const ref = useRef<HTMLButtonElement | null>(null)
  const [inView, setInView] = useState(false)

  // enriched GLB presence is a heuristic: the card can still render
  // the crude fallback, but we only kick the mini-Canvas for enriched.
  const hasEnrichedGlb = status === 'validated'

  // Intersection observer — only mount heavy thumbnails when visible.
  useEffect(() => {
    if (disableThumb) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setInView(true)
      },
      { rootMargin: '160px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [disableThumb])

  const { strategy, imageUrl } = useThumbStrategy(
    part.sku,
    hasEnrichedGlb,
    !disableThumb,
  )

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(part.sku)}
      data-testid={`hf-catalog-card-${part.sku}`}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      style={{ borderRadius: 0 }}
      className={
        'group relative flex flex-col border transition-[transform,border-color,background-color] ' +
        'text-left outline-none focus-visible:border-[var(--color-hf-accent)] ' +
        (selected
          ? 'border-[var(--color-hf-accent)] bg-[rgba(232,67,45,0.06)]'
          : 'border-[var(--color-hf-edge)] hover:border-[var(--color-hf-accent)]/60 hover:bg-white/[0.02] hover:[transform:scale(1.02)]')
      }
    >
      {/* Preview pane */}
      <div
        className="relative flex h-[120px] w-[120px] items-center justify-center border-b border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)]"
        style={{ borderRadius: 0 }}
      >
        {strategy === 'image' && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={part.display_name}
            src={imageUrl}
            loading="lazy"
            width={120}
            height={120}
            className="h-full w-full object-contain"
          />
        )}
        {strategy === 'canvas' && inView && (
          <GlbMiniPreview sku={part.sku} />
        )}
        {(strategy === 'glyph' || strategy === 'loading' ||
          (strategy === 'canvas' && !inView)) && (
          <KindGlyph kind={part.kind} />
        )}

        {/* Status chip — top right */}
        <div
          className="absolute right-1 top-1 flex items-center gap-1 border px-1 py-[1px] text-[8.5px] font-medium uppercase tracking-[0.1em]"
          style={{
            borderRadius: 0,
            borderColor: chip.color,
            color: chip.filled
              ? 'var(--color-hf-paper)'
              : 'var(--color-hf-ink-mute)',
            background: chip.filled
              ? `color-mix(in srgb, ${chip.color} 18%, transparent)`
              : 'transparent',
          }}
          title={chip.description}
          data-testid={`hf-catalog-chip-${part.sku}`}
        >
          <span
            className="inline-block h-1.5 w-1.5"
            style={{
              background: chip.filled ? chip.color : 'transparent',
              border: chip.filled ? 'none' : `1px solid ${chip.color}`,
            }}
            aria-hidden
          />
          {chip.label}
        </div>

        {/* In-flight spinner */}
        {inFlight && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-[var(--color-hf-bg)]/60"
            aria-hidden
          >
            <span
              className="hf-label animate-pulse"
              style={{ color: 'var(--color-hf-gold)' }}
            >
              RUNNING
            </span>
          </div>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10.5px] font-medium text-[var(--color-hf-paper)]">
            {part.display_name}
          </div>
          {part.manufacturer && (
            <span
              className="mt-0.5 inline-block border border-[rgba(200,154,60,0.35)] bg-[rgba(200,154,60,0.08)] px-1 py-[1px] text-[8.5px] uppercase tracking-[0.14em] text-[var(--color-hf-gold)]"
              style={{ borderRadius: 0 }}
            >
              {part.manufacturer.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {part.mfg_part_number && (
          <span className="hf-num shrink-0 text-[9.5px] text-[var(--color-hf-ink-dim)]">
            {part.mfg_part_number}
          </span>
        )}
      </div>
    </button>
  )
}

// ── Mini GLB Canvas (lazy) ──────────────────────────────────────────
//
// React-three/drei's useGLTF is heavy; import lazily inside the mini
// component so the CatalogCard module can still SSR on the Next.js
// server without pulling three.js into the critical path.

function GlbMiniPreview({ sku }: { sku: string }) {
  const [mod, setMod] = useState<null | {
    Canvas: typeof import('@react-three/fiber').Canvas
    useGLTF: typeof import('@react-three/drei').useGLTF
    PresentationControls: typeof import('@react-three/drei').PresentationControls
  }>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('@react-three/fiber'),
      import('@react-three/drei'),
    ])
      .then(([fiber, drei]) => {
        if (cancelled) return
        setMod({
          Canvas: fiber.Canvas,
          useGLTF: drei.useGLTF,
          PresentationControls: drei.PresentationControls,
        })
      })
      .catch(() => {
        /* module failed; fall through to static glyph */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!mod) return null
  const { Canvas, useGLTF: useGltfHook, PresentationControls } = mod
  const url = `/halofire-catalog/glb/${sku}.glb`

  function Mesh() {
    const gltf = useGltfHook(url)
    return <primitive object={gltf.scene} />
  }

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0.3, 0.3, 0.4], fov: 35 }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight intensity={0.8} position={[3, 3, 3]} />
      <PresentationControls
        global
        rotation={[0, 0, 0]}
        polar={[-Math.PI / 3, Math.PI / 3]}
      >
        <Mesh />
      </PresentationControls>
    </Canvas>
  )
}
