/**
 * Design — skeleton mirror of the authoritative Python schema at
 * `services/halofire-cad/cad/schema.py`. This TS shape is ONLY
 * rich enough for typed construction / round-trip inside Studio
 * and for the .hfproj I/O layer; it intentionally does NOT
 * duplicate every enum and geometry type from the Python side.
 *
 * Parity is enforced via golden-fixture tests per blueprint 14 §3:
 * the same JSON must validate on both sides and hydrate identical
 * runtime objects.
 *
 * For the full TypeScript node types (SprinklerHead, Pipe, System,
 * Wall, etc.), consumers should import from `@pascal-app/core/schema`
 * directly — that's the Pascal-fork node layer. This module is
 * deliberately narrow (project bundle contract only) to avoid
 * pulling three.js into headless schema consumers.
 *
 * See docs/blueprints/01_DATA_MODEL.md §2.2.
 */
import { z } from 'zod'

/** NFPA 13 hazard class names — mirrors Python `NfpaHazard` literal. */
export const NfpaHazard = z.enum([
  'light',
  'ordinary_i',
  'ordinary_ii',
  'extra_i',
  'extra_ii',
  'residential',
])
export type NfpaHazard = z.infer<typeof NfpaHazard>

/** NFPA 13 system type — mirrors Python `SystemType` literal. */
export const DesignSystemType = z.enum([
  'wet',
  'dry',
  'preaction',
  'deluge',
  'combo_standpipe',
])
export type DesignSystemType = z.infer<typeof DesignSystemType>

/** Geometry primitives mirror the Python aliases (meters, Z-up, RH). */
export const Point2D = z.tuple([z.number(), z.number()])
export const Point3D = z.tuple([z.number(), z.number(), z.number()])

/** ProjectRef — minimal project identification embedded in Design. */
export const DesignProjectRef = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
})

/** Building envelope — shape mirror of Python Building. */
export const DesignBuilding = z.object({
  levels: z.array(z.json()).default([]),
  slabs: z.array(z.json()).default([]),
  walls: z.array(z.json()).default([]),
  ceilings: z.array(z.json()).default([]),
})

/** Fire-protection system — shape mirror of Python System. */
export const DesignSystem = z.object({
  id: z.string(),
  type: DesignSystemType,
  hazard: NfpaHazard.optional(),
  heads: z.array(z.json()).default([]),
  pipes: z.array(z.json()).default([]),
  fittings: z.array(z.json()).default([]),
})

export const DesignRemoteArea = z.object({
  id: z.string(),
  system_id: z.string(),
  polygon: z.array(Point2D),
  density_gpm_ft2: z.number().optional(),
})

export const DesignSource = z.object({
  kind: z.string(),
  path: z.string(),
  extracted_at: z.string().optional(),
})

export const DesignIssue = z.object({
  severity: z.enum(['info', 'warning', 'violation']),
  code: z.string(),
  message: z.string(),
  target: z.string().optional(),
})

export const DesignConfidence = z.object({
  overall: z.number().min(0).max(1),
  by_agent: z.record(z.string(), z.number()).default({}),
})

export const DeliverableManifest = z.object({
  proposal_pdf: z.string().optional(),
  submittal_pdfs: z.array(z.string()).default([]),
  dxf: z.string().optional(),
  ifc: z.string().optional(),
  glb: z.string().optional(),
  supplier_hlf: z.string().optional(),
  nfpa_report: z.string().optional(),
})

export const Design = z.object({
  project: DesignProjectRef,
  building: DesignBuilding,
  systems: z.array(DesignSystem),
  remote_areas: z.array(DesignRemoteArea).default([]),
  sources: z.array(DesignSource),
  issues: z.array(DesignIssue),
  confidence: DesignConfidence,
  deliverables: DeliverableManifest,
  metadata: z.json().optional(),
})

export type Design = z.infer<typeof Design>
