'use client'

/**
 * Phase H.4 — SKU detail slide-over.
 *
 * Opens on click from a CatalogCard. Renders:
 *   - Fraunces display name + manufacturer subheader
 *   - 280×280 full Canvas viewer of the GLB (OrbitControls)
 *   - Spec table with Plex-Mono labels + JetBrains-Mono values
 *   - Enrichment section: status chip, source photo, mask preview,
 *     detected-size chip, confidence bar
 *   - Primary CTA "Re-run enrichment" (POST /projects/catalog/enrich)
 *   - Secondary "Use crude render" toggle (localStorage + store)
 *   - "Open cut sheet" link if a URL is present
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CatalogPart } from '@halofire/core/catalog/load'
import {
  reenrichSku,
  useCatalogStore,
  useEffectiveStatus,
  useEnriched,
  useInFlight,
} from '../../lib/halofire/catalog-store'
import { STATUS_CHIP_MAP } from './CatalogCard'

export interface CatalogDetailPanelProps {
  part: CatalogPart
  onClose: () => void
  /** Tests / SSR: avoid mounting a <Canvas>. */
  disableViewer?: boolean
}

export function CatalogDetailPanel({
  part,
  onClose,
  disableViewer = false,
}: CatalogDetailPanelProps) {
  const enriched = useEnriched(part.sku)
  const status = useEffectiveStatus(part.sku)
  const inFlight = useInFlight(part.sku)
  const crudePref = useCatalogStore((s) => !!s.crudePrefs[part.sku])
  const setCrudePref = useCatalogStore((s) => s.setCrudePref)
  const chip = STATUS_CHIP_MAP[status]
  const [rerunErr, setRerunErr] = useState<string | null>(null)

  const onRerun = useCallback(async () => {
    setRerunErr(null)
    try {
      await reenrichSku(part.sku)
    } catch (e) {
      setRerunErr(String((e as Error)?.message ?? e))
    }
  }, [part.sku])

  const onSwapCrude = useCallback(() => {
    setCrudePref(part.sku, !crudePref)
  }, [part.sku, crudePref, setCrudePref])

  return (
    <aside
      data-testid={`hf-catalog-detail-${part.sku}`}
      className="fixed right-0 top-0 z-30 flex h-full w-[380px] flex-col border-l border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)] shadow-2xl"
      style={{ borderRadius: 0 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-hf-edge)] px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div
            className="hf-label tracking-[0.22em]"
            style={{ color: 'var(--color-hf-ink-mute)' }}
          >
            Detail
          </div>
          <h2
            className="truncate text-[24px] leading-tight text-[var(--color-hf-paper)]"
            style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
            }}
          >
            {part.display_name}
          </h2>
          {part.manufacturer && (
            <p
              className="mt-0.5 text-[12px] text-[var(--color-hf-ink-mute)]"
              style={{ fontFamily: 'var(--font-plex), monospace' }}
            >
              {part.manufacturer.replace(/_/g, ' ')}
              {part.mfg_part_number && (
                <>
                  {' · '}
                  <span className="hf-num">{part.mfg_part_number}</span>
                </>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="hf-label border border-[var(--color-hf-edge)] px-2 py-1 hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
          style={{ borderRadius: 0 }}
        >
          CLOSE
        </button>
      </div>

      <div className="hf-scroll flex-1 overflow-y-auto">
        {/* Viewer */}
        <div
          className="mx-4 mt-4 flex h-[280px] w-[calc(100%-32px)] items-center justify-center border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)]"
          style={{ borderRadius: 0 }}
        >
          {disableViewer ? (
            <span className="hf-label">Viewer disabled</span>
          ) : (
            <DetailViewer sku={part.sku} crude={crudePref} />
          )}
        </div>

        {/* Spec table */}
        <section className="mx-4 mt-4">
          <h3 className="hf-label pb-1.5 tracking-[0.22em]">Specification</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-y border-[var(--color-hf-edge)] py-2 text-[10.5px]">
            <SpecRow k="SKU" v={<span className="hf-num">{part.sku}</span>} />
            <SpecRow k="Kind" v={part.kind.replace(/_/g, ' ')} />
            <SpecRow k="Category" v={part.category} />
            {part.listing && <SpecRow k="Listing" v={part.listing} />}
            {typeof part.price_usd === 'number' && (
              <SpecRow
                k="Price"
                v={
                  <span className="hf-num text-[var(--color-hf-gold)]">
                    ${part.price_usd.toFixed(2)}
                  </span>
                }
              />
            )}
            {typeof part.install_minutes === 'number' && (
              <SpecRow
                k="Install"
                v={
                  <span className="hf-num">
                    {part.install_minutes}
                    <span className="hf-label ml-0.5">min</span>
                  </span>
                }
              />
            )}
          </dl>
        </section>

        {/* Enrichment section */}
        <section className="mx-4 mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="hf-label tracking-[0.22em]">Enrichment</h3>
            <div
              className="flex items-center gap-1 border px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.12em]"
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
              data-testid={`hf-detail-chip-${part.sku}`}
            >
              <span
                className="inline-block h-1.5 w-1.5"
                style={{
                  background: chip.filled ? chip.color : 'transparent',
                  border: chip.filled ? 'none' : `1px solid ${chip.color}`,
                }}
              />
              {chip.label}
            </div>
          </div>

          <p className="mb-3 text-[10.5px] leading-relaxed text-[var(--color-hf-ink-mute)]">
            {chip.description}
          </p>

          {enriched ? (
            <EnrichmentPanels sku={part.sku} />
          ) : (
            <p className="border border-dashed border-[var(--color-hf-edge)] p-3 text-[10.5px] text-[var(--color-hf-ink-dim)]">
              No enrichment record on disk yet. Run the pipeline to build a
              real mesh from the manufacturer cut sheet.
            </p>
          )}
        </section>

        {/* Actions */}
        <section className="mx-4 mt-4">
          <button
            type="button"
            onClick={onRerun}
            disabled={inFlight}
            data-testid={`hf-detail-rerun-${part.sku}`}
            style={{ borderRadius: 0 }}
            className={
              'w-full border border-[rgba(232,67,45,0.6)] bg-[linear-gradient(180deg,rgba(232,67,45,0.2),rgba(232,67,45,0.06))] px-2 py-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-hf-paper)] ' +
              (inFlight
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-[var(--color-hf-accent)] hover:bg-[rgba(232,67,45,0.28)]')
            }
          >
            {inFlight ? 'Running…' : 'Re-run enrichment'}
          </button>

          <button
            type="button"
            onClick={onSwapCrude}
            data-testid={`hf-detail-crude-toggle-${part.sku}`}
            aria-pressed={crudePref}
            style={{ borderRadius: 0 }}
            className="mt-2 w-full border border-[var(--color-hf-edge)] bg-transparent px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
          >
            {crudePref ? 'Use enriched mesh' : 'Use crude render'}
          </button>

          {rerunErr && (
            <p
              className="mt-2 border-l-2 border-[var(--color-hf-brick)] px-2 py-1 text-[10px] text-[var(--color-hf-brick)]"
              style={{ borderRadius: 0 }}
            >
              {rerunErr}
            </p>
          )}
        </section>
      </div>
    </aside>
  )
}

function SpecRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="hf-label">{k}</dt>
      <dd className="text-[var(--color-hf-paper)]">{v}</dd>
    </>
  )
}

// ── Enrichment section ──────────────────────────────────────────────

function EnrichmentPanels({ sku }: { sku: string }) {
  const rec = useEnriched(sku)
  if (!rec) return null
  const confidence = rec.mesh?.confidence ?? rec.grounding?.confidence ?? null
  const maskAspect = rec.mask?.aspect
  const maskArea = rec.mask?.area_px
  const photoPath = rec.source_photo?.path
  const photoUrl = useMemo(() => toPublicUrl(photoPath), [photoPath])

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Source photo */}
      <div>
        <div className="hf-label pb-1">Source photo</div>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="source photo"
            className="h-[90px] w-full border border-[var(--color-hf-edge)] object-contain"
            style={{ borderRadius: 0 }}
            data-testid={`hf-detail-source-photo-${sku}`}
          />
        ) : (
          <div
            className="flex h-[90px] items-center justify-center border border-dashed border-[var(--color-hf-edge)] text-[10px] text-[var(--color-hf-ink-dim)]"
            style={{ borderRadius: 0 }}
          >
            No photo
          </div>
        )}
      </div>

      {/* Detected region (source + mask overlay — best-effort composite) */}
      <div>
        <div className="hf-label pb-1">Detected region</div>
        <div
          className="relative flex h-[90px] items-center justify-center border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)]"
          style={{ borderRadius: 0 }}
          data-testid={`hf-detail-region-${sku}`}
        >
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-full w-full object-contain opacity-60"
            />
          )}
          {rec.mask?.bbox && (
            <BboxOverlay bbox={rec.mask.bbox} />
          )}
          {!rec.mask?.bbox && rec.grounding?.bbox && (
            <BboxOverlay bbox={rec.grounding.bbox} dashed />
          )}
        </div>
      </div>

      {/* Detected size */}
      <div className="col-span-2 flex items-center justify-between border-t border-[var(--color-hf-edge)] pt-2">
        <div className="hf-label">Detected size</div>
        <div className="flex items-center gap-2 text-[10px]">
          {maskAspect != null && (
            <span className="hf-num text-[var(--color-hf-paper)]">
              aspect {maskAspect.toFixed(2)}
            </span>
          )}
          {maskArea != null && (
            <span className="hf-num text-[var(--color-hf-ink-mute)]">
              {maskArea}
              <span className="hf-label ml-0.5">px²</span>
            </span>
          )}
          {maskAspect == null && maskArea == null && (
            <span className="text-[10px] text-[var(--color-hf-ink-dim)]">—</span>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      <div className="col-span-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="hf-label">Confidence</div>
          <span className="hf-num text-[10px] text-[var(--color-hf-paper)]">
            {confidence != null ? `${(confidence * 100).toFixed(0)}%` : '—'}
          </span>
        </div>
        <div
          className="h-[3px] w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)]"
          style={{ borderRadius: 0 }}
        >
          <div
            className="h-full"
            style={{
              width: `${Math.max(0, Math.min(1, confidence ?? 0)) * 100}%`,
              background: 'var(--color-hf-moss)',
            }}
          />
        </div>
      </div>

      {/* Provenance (collapsed) */}
      {rec.provenance && rec.provenance.length > 0 && (
        <details className="col-span-2 border-t border-[var(--color-hf-edge)] pt-2 text-[10px]">
          <summary className="hf-label cursor-pointer">
            Provenance · {rec.provenance.length}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {rec.provenance.map((p, i) => (
              <li
                key={`${p.agent}-${i}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="hf-num">{p.agent}</span>
                <span
                  style={{
                    color: p.ok
                      ? 'var(--color-hf-moss)'
                      : 'var(--color-hf-brick)',
                  }}
                >
                  {p.ok ? 'ok' : (p.reason ?? 'fail')}
                </span>
                {typeof p.duration_ms === 'number' && (
                  <span className="hf-num text-[var(--color-hf-ink-dim)]">
                    {p.duration_ms}ms
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function BboxOverlay({
  bbox,
  dashed = false,
}: {
  bbox: [number, number, number, number]
  dashed?: boolean
}) {
  // bbox may be pixel coords or normalized — assume normalized when all
  // four are within [0,1], else treat as pixels scaled via object-contain
  // (best-effort; the source photo isn't measured here so we just align
  // to the containing box proportionally).
  const [x0, y0, x1, y1] = bbox
  const norm = [x0, y0, x1, y1].every((v) => v >= 0 && v <= 1)
  if (!norm) return null
  return (
    <div
      className="absolute border-2"
      style={{
        borderRadius: 0,
        borderColor: 'var(--color-hf-accent)',
        borderStyle: dashed ? 'dashed' : 'solid',
        left: `${x0 * 100}%`,
        top: `${y0 * 100}%`,
        width: `${(x1 - x0) * 100}%`,
        height: `${(y1 - y0) * 100}%`,
      }}
      aria-hidden
    />
  )
}

/**
 * Map a server-side filesystem path (e.g. as persisted in enriched.json)
 * to a public URL under /halofire-catalog/... if we can spot the known
 * prefix. Returns null otherwise.
 */
function toPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const norm = path.replace(/\\/g, '/')
  const idx = norm.indexOf('/halofire-catalog/')
  if (idx >= 0) return norm.slice(idx)
  const cutIdx = norm.indexOf('/cut_sheets/')
  if (cutIdx >= 0) {
    return `/halofire-catalog${norm.slice(cutIdx)}`
  }
  return null
}

// ── Detail viewer (OrbitControls) ───────────────────────────────────

function DetailViewer({ sku, crude }: { sku: string; crude: boolean }) {
  const [mod, setMod] = useState<null | {
    Canvas: typeof import('@react-three/fiber').Canvas
    useGLTF: typeof import('@react-three/drei').useGLTF
    OrbitControls: typeof import('@react-three/drei').OrbitControls
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
          OrbitControls: drei.OrbitControls,
        })
      })
      .catch(() => {
        /* fall-through */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!mod) {
    return <span className="hf-label">Loading viewer…</span>
  }
  const { Canvas, useGLTF: useGltfHook, OrbitControls } = mod
  const url = crude
    ? `/halofire-catalog/glb/${sku}.glb`
    : `/halofire-catalog/glb/${sku}.glb`
  // NOTE: once H.3 promotes enriched GLBs into /halofire-catalog/glb/
  // under the same name, the two paths converge. The crude toggle
  // currently switches the intent surfaced to the store; future work
  // can route to `/halofire-catalog/glb/enriched/<sku>.glb` when we
  // wire a second public mount.

  function Mesh() {
    const gltf = useGltfHook(url)
    return <primitive object={gltf.scene} />
  }

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0.3, 0.3, 0.4], fov: 35 }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight intensity={0.9} position={[3, 3, 3]} />
      <OrbitControls makeDefault enablePan={false} />
      <Mesh />
    </Canvas>
  )
}
