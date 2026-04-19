/**
 * Takeoff request + result types.
 * Mirrors the Python gateway's JSON schema one-to-one.
 */

export type LayerSource = 'pdfplumber' | 'opencv_hough' | 'cubicasa5k' | 'claude_vision'

export interface TakeoffRequest {
  /** PDF bytes uploaded as multipart form-data */
  pdfBytes: ArrayBuffer
  /** Project ID this takeoff belongs to */
  projectId: string
  /** Force all layers (even if L1 would have passed) for debugging */
  forceAllLayers?: boolean
}

export interface TakeoffProgress {
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  /** 0-100 */
  percent: number
  /** Which layer is currently running */
  currentLayer?: LayerSource
  message?: string
}

export interface ExtractedWall {
  /** Two endpoints [x0, y0] [x1, y1] in PDF coordinates */
  start: [number, number]
  end: [number, number]
  /** Wall thickness in PDF units */
  thickness: number
  /** Confidence 0-1 */
  confidence: number
  /** Which layer produced this wall */
  source: LayerSource
}

export interface ExtractedRoom {
  /** Convex hull of room polygon */
  polygon: [number, number][]
  /** Human label if available ("Office 101", "Storage", "Corridor") */
  label?: string
  /** NFPA 13 hazard class inferred from label */
  hazard?: 'light' | 'ordinary_i' | 'ordinary_ii' | 'extra_i' | 'extra_ii'
  confidence: number
  source: LayerSource
}

export interface ExtractedOpening {
  /** Opening midpoint */
  position: [number, number]
  type: 'door' | 'window'
  /** Width in PDF units */
  width: number
  /** Which wall this opening cuts through (by wall index) */
  parentWallIndex?: number
  confidence: number
  source: LayerSource
}

export interface TakeoffResult {
  jobId: string
  status: 'succeeded'
  /** Page number processed */
  pageNumber: number
  /** Detected drawing scale: "1:50", "1/4in = 1ft", etc. */
  scale?: string
  /** Pixels per real-world meter */
  pxPerMeter: number
  walls: ExtractedWall[]
  rooms: ExtractedRoom[]
  openings: ExtractedOpening[]
  /** Overall confidence of the extraction */
  overallConfidence: number
  /** Layers that ran + per-layer durations in ms */
  layersRan: { layer: LayerSource; durationMs: number; wasNeeded: boolean }[]
  /** Total processing time */
  durationMs: number
}
