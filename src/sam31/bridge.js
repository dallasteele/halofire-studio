import express from 'express';
import { z } from 'zod';
import { readCooperative1881BidPackage } from '../data/cooperative-1881-bid-package.js';

export const SAM31_FLOORPLAN_TOOL = 'sam_segment_floorplan';

const DEFAULT_IMAGE_SIZE = Object.freeze({ w: 800, h: 600 });
const DEFAULT_TARGETS = Object.freeze(['building_outline', 'walls', 'rooms', 'layers']);
const CLAIM_GATE_EFFECT = 'no_claims_cleared';
const BLOCKED_CLAIMS = Object.freeze([
  'permit_ready',
  'AHJ_approval',
  'PE_review',
  'engineering_grade',
  'fabrication_ready',
  'AutoSprink_parity',
  'manufacturer_exact',
]);

const LIMITATIONS = Object.freeze([
  'Temporary local SAM 3.1 shim for internal-alpha bidding and correction loops only.',
  'Uses deterministic best-effort geometry when a real HAL/OpenClaw SAM runtime is not attached.',
  'Does not clear AHJ, PE, AutoSprink parity, fabrication, manufacturer, or permit-ready claims.',
  'Requires an operator or drawing supplied scale before a floorplan polygon is returned.',
]);

const BridgeEnvelopeSchema = z.object({
  tool: z.union([z.string(), z.record(z.unknown())]),
  args: z.unknown().optional(),
}).passthrough();

const ImageSizeSchema = z.object({
  w: z.coerce.number().positive().optional(),
  h: z.coerce.number().positive().optional(),
  width: z.coerce.number().positive().optional(),
  height: z.coerce.number().positive().optional(),
}).passthrough();

const FloorplanPayloadSchema = z.object({
  service: z.literal('sam-3.1').optional(),
  op: z.literal('segment_floorplan'),
  pdfRef: z.unknown().optional().nullable(),
  pageIndex: z.coerce.number().int().nonnegative().default(0),
  scale: z.coerce.number().positive(),
  targets: z.array(z.string().min(1)).default(DEFAULT_TARGETS.slice()),
  imageSize: ImageSizeSchema.optional(),
}).passthrough();

const ReconstructPayloadSchema = z.object({
  service: z.literal('sam-3.1').optional(),
  op: z.literal('reconstruct'),
  componentKey: z.string().min(1).nullable().optional(),
  imageRef: z.unknown().optional().nullable(),
  outputFormat: z.string().min(1).default('stl'),
}).passthrough();

const ExtrapolatePayloadSchema = z.object({
  project_ref: z.string().min(1).default('halo_fire:The Cooperative 1881 - Salt Lake City UT'),
  application: z.string().min(1).default('halo_fire'),
  source_ref: z.string().min(1).optional(),
  image_ref: z.string().min(1).optional(),
  coordinate_frame_ref: z.string().min(1).optional(),
  unit: z.string().min(1).default('ft'),
  sections: z.array(z.record(z.unknown())).default([]),
  object_hypotheses: z.array(z.record(z.unknown())).default([]),
}).passthrough();

function errorResponse(status, code, message, refs = []) {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        severity: status >= 500 ? 'blocking' : 'warning',
        message,
        refs,
      },
      claim_gate_effect: CLAIM_GATE_EFFECT,
      blocked_claims: BLOCKED_CLAIMS.slice(),
    },
  };
}

function normalizeEnvelope(input) {
  const parsed = BridgeEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: errorResponse(
        400,
        'SAM31_BAD_ENVELOPE',
        'Expected an OpenClaw bridge envelope with tool and optional args.',
      ),
    };
  }
  const envelope = parsed.data;
  if (typeof envelope.tool === 'object' && envelope.tool !== null && envelope.args === undefined) {
    return { ok: true, tool: 'sam-3.1-direct-payload', args: envelope.tool };
  }
  return { ok: true, tool: envelope.tool, args: envelope.args };
}

function normalizeImageSize(payload) {
  const raw = payload.imageSize || {};
  const w = Number(raw.w ?? raw.width ?? DEFAULT_IMAGE_SIZE.w);
  const h = Number(raw.h ?? raw.height ?? DEFAULT_IMAGE_SIZE.h);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    return { ...DEFAULT_IMAGE_SIZE };
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
}

function rectPolygon(w, h, leftRatio, topRatio, rightRatio, bottomRatio) {
  return [
    [round(w * leftRatio), round(h * topRatio)],
    [round(w * rightRatio), round(h * topRatio)],
    [round(w * rightRatio), round(h * bottomRatio)],
    [round(w * leftRatio), round(h * bottomRatio)],
  ];
}

function refSummary(ref) {
  if (ref == null) return null;
  if (typeof ref === 'string') {
    return ref.length <= 200 ? ref : `${ref.slice(0, 197)}...`;
  }
  if (ArrayBuffer.isView(ref)) return `${ref.constructor.name}:${ref.byteLength} bytes`;
  if (ref instanceof ArrayBuffer) return `ArrayBuffer:${ref.byteLength} bytes`;
  if (Array.isArray(ref)) return `array:${ref.length}`;
  if (typeof ref === 'object') {
    const keys = Object.keys(ref);
    const numericKeys = keys.filter((key) => /^\d+$/.test(key)).length;
    if (numericKeys > Math.max(20, keys.length * 0.8)) return `byte-object:${keys.length} entries`;
    return `object:${keys.slice(0, 8).join(',')}`;
  }
  return String(ref);
}

function buildFloorplanSegmentation(payload) {
  const imageSize = normalizeImageSize(payload);
  const outline = rectPolygon(imageSize.w, imageSize.h, 0.125, 0.166667, 0.875, 0.833333);
  const leftRoom = rectPolygon(imageSize.w, imageSize.h, 0.125, 0.166667, 0.5, 0.833333);
  const rightRoom = rectPolygon(imageSize.w, imageSize.h, 0.5, 0.166667, 0.875, 0.833333);

  return {
    ok: true,
    source: 'sam-3.1-shim',
    service: 'sam-3.1',
    op: 'segment_floorplan',
    runtime: 'halofire-local-sam31-bridge',
    mode: 'temporary_best_effort_shim',
    confidence: 0.35,
    pageIndex: payload.pageIndex,
    scale: payload.scale,
    imageSize,
    targets: payload.targets.slice(),
    layers: {
      building_outline: outline,
      walls: [
        { x1: outline[0][0], y1: outline[0][1], x2: outline[1][0], y2: outline[1][1] },
        { x1: outline[1][0], y1: outline[1][1], x2: outline[2][0], y2: outline[2][1] },
        { x1: outline[2][0], y1: outline[2][1], x2: outline[3][0], y2: outline[3][1] },
        { x1: outline[3][0], y1: outline[3][1], x2: outline[0][0], y2: outline[0][1] },
      ],
      rooms: [
        { name: 'SAM31 Shim Zone A', polygon: leftRoom },
        { name: 'SAM31 Shim Zone B', polygon: rightRoom },
      ],
      layers: [
        { key: 'building_outline', semantic_label: 'best_effort_visual_boundary' },
        { key: 'rooms', semantic_label: 'temporary_review_zones' },
      ],
    },
    label:
      'best-effort temporary SAM 3.1 shim segmentation - NOT AHJ/PE/AutoSprink/manufacturer parity',
    limitations: LIMITATIONS.slice(),
    claim_gate_effect: CLAIM_GATE_EFFECT,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'sprinkler_bid_best_effort',
      'spatial_observation_correction_loop',
    ],
    source_refs: [
      {
        kind: 'pdfRef',
        ref: refSummary(payload.pdfRef),
        pageIndex: payload.pageIndex,
      },
    ],
  };
}

function safeComponentKey(value) {
  const key = value == null || value === '' ? 'unknown_component' : String(value);
  return key.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown_component';
}

function buildShimStl(componentKey) {
  const safeKey = safeComponentKey(componentKey);
  return [
    `solid halofire_sam31_shim_${safeKey}`,
    '  facet normal 0 0 1',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 1 0 0',
    '      vertex 0 1 0',
    '    endloop',
    '  endfacet',
    `endsolid halofire_sam31_shim_${safeKey}`,
    '',
  ].join('\n');
}

function polygonPath(points = []) {
  const usable = Array.isArray(points) ? points.filter((point) => Array.isArray(point) && point.length >= 2) : [];
  if (!usable.length) return '';
  return usable
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point[0])} ${round(point[1])}`)
    .join(' ')
    + ' Z';
}

function bboxFromPolygon(points = []) {
  const usable = Array.isArray(points)
    ? points.filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];
  if (!usable.length) return null;
  const xs = usable.map((point) => point[0]);
  const ys = usable.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round);
}

function normalizedSection(section, index, bidTruth) {
  const id = typeof section.id === 'string' && section.id
    ? section.id
    : `section-1881-boundary-${index + 1}`;
  const fallbackDepth = bidTruth.square_feet / 413;
  const polygon = Array.isArray(section.polygon) && section.polygon.length >= 3
    ? section.polygon
    : [[0, 0], [413, 0], [413, round(fallbackDepth)], [0, round(fallbackDepth)], [0, 0]];
  return {
    ...section,
    id,
    semantic_label: typeof section.semantic_label === 'string' && section.semantic_label
      ? section.semantic_label
      : 'sprinkler_room_boundary_candidate',
    polygon,
    bbox: bboxFromPolygon(polygon),
    confidence: Number.isFinite(Number(section.confidence)) ? Math.max(0, Math.min(1, Number(section.confidence))) : 0.35,
    source: typeof section.source === 'string' && section.source
      ? section.source
      : 'halofire-1881-best-effort-section-default',
    limitations: [
      ...(Array.isArray(section.limitations) ? section.limitations : []),
      'Temporary SAM31 section; Halo Fire employee must replace or accept with source-linked review evidence.',
    ],
  };
}

function normalizedObjectHypotheses(rawHypotheses, segments) {
  const supplied = Array.isArray(rawHypotheses) ? rawHypotheses : [];
  const fallback = segments.map((segment) => ({
    id: `object:${segment.id}:room-boundary`,
    segment_id: segment.id,
    semantic_label: 'sprinkler_room_boundary_candidate',
    confidence: Math.min(0.4, segment.confidence ?? 0.35),
  }));
  return (supplied.length ? supplied : fallback).map((hypothesis, index) => {
    const segmentId = typeof hypothesis.segment_id === 'string' && hypothesis.segment_id
      ? hypothesis.segment_id
      : segments[index]?.id || segments[0]?.id || 'section-1881-boundary-1';
    return {
      ...hypothesis,
      id: typeof hypothesis.id === 'string' && hypothesis.id ? hypothesis.id : `object:${segmentId}:${index + 1}`,
      segment_id: segmentId,
      semantic_label: typeof hypothesis.semantic_label === 'string' && hypothesis.semantic_label
        ? hypothesis.semantic_label
        : 'sprinkler_review_candidate',
      confidence: Number.isFinite(Number(hypothesis.confidence))
        ? Math.max(0, Math.min(1, Number(hypothesis.confidence)))
        : 0.35,
      limitations: [
        ...(Array.isArray(hypothesis.limitations) ? hypothesis.limitations : []),
        'LLM/SAM31 object hypothesis only; requires Halo Fire employee and professional review.',
      ],
    };
  });
}

function cooperative1881Truth() {
  const pkg = readCooperative1881BidPackage();
  return {
    project: pkg.project,
    head_count: pkg.headCount,
    square_feet: pkg.sqft,
    bid_total: pkg.total,
    source_refs: pkg.sourceRefs.slice(),
    disclaimer: pkg.disclaimer,
  };
}

function buildSam31ExtrapolationArtifact(payload) {
  const bidTruth = cooperative1881Truth();
  const sections = (payload.sections.length ? payload.sections : [{}])
    .map((section, index) => normalizedSection(section, index, bidTruth));
  const objectHypotheses = normalizedObjectHypotheses(payload.object_hypotheses, sections);
  const vectorOverlays = sections.map((section) => ({
    artifact_type: 'openclaw.sam31.vector_overlay.v1',
    id: `vector:${section.id}`,
    segment_id: section.id,
    kind: 'polygon_path',
    svg_path: polygonPath(section.polygon),
    bbox: section.bbox,
    confidence: Math.min(0.62, section.confidence ?? 0.35),
    source: 'halofire-local-sam31-bridge',
    limitations: ['Best-effort vector overlay; not geometry-accuracy, permit, AHJ, PE, fabrication, or AutoSprink parity evidence.'],
  }));
  const model3dCandidates = sections.map((section) => ({
    artifact_type: 'openclaw.sam31.model_3d_candidate.v1',
    id: `model3d:${section.id}`,
    segment_id: section.id,
    primitive: 'extruded_polygon',
    dimensions: {
      height_ft_best_guess: 10,
      source: 'temporary_default_until_employee_or_professional_review',
    },
    confidence: Math.min(0.45, section.confidence ?? 0.35),
    source: 'halofire-local-sam31-bridge',
    limitations: ['Best-effort 3D candidate; not manufacturer, fabrication, permit, AHJ, PE, or engineering evidence.'],
  }));
  const spatialObservations = sections.map((section) => ({
    artifact_type: 'openclaw.sam31.spatial_observation.v1',
    id: `spatial:${section.id}`,
    source_runtime: 'halofire-local-sam31-bridge',
    coordinate_frame_ref: payload.coordinate_frame_ref || 'halofire-1881-employee-selected-frame',
    unit: payload.unit,
    semantic_label: section.semantic_label,
    polygon: section.polygon,
    bbox: section.bbox,
    confidence: Math.min(0.45, section.confidence ?? 0.35),
    capture_ref: payload.image_ref || payload.source_ref || 'halofire-1881-local-sam31-extrapolate',
    source_refs: [payload.source_ref, payload.image_ref, ...bidTruth.source_refs].filter(Boolean),
    supported_evidence_lanes: ['room_boundary_visual_audit', 'sleeve_or_firestop_candidate_review', 'obstruction_or_clash_review'],
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: LIMITATIONS.slice(),
  }));
  const extrapolationIndex = sections.map((section) => ({
    artifact_type: 'openclaw.sam31.extrapolation_index_item.v1',
    section_id: section.id,
    semantic_label: section.semantic_label,
    object_hypothesis_ids: objectHypotheses
      .filter((hypothesis) => hypothesis.segment_id === section.id)
      .map((hypothesis) => hypothesis.id),
    vector_overlay_ids: [`vector:${section.id}`],
    model_3d_candidate_ids: [`model3d:${section.id}`],
    spatial_observation_ids: [`spatial:${section.id}`],
    use_for_claims: false,
    claim_gate_effect: CLAIM_GATE_EFFECT,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: ['Temporary SAM31 best guess; replace with employee/professional/AHJ/manufacturer evidence before regulated claims.'],
  }));
  const missingEvidenceRows = [
    {
      code: 'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING',
      status: 'missing',
      severity: 'blocking',
      source_evidence_type: 'sam31_room_boundary_visual_audit',
      acceptable_evidence: [
        'employee-selected drawing sheet, scale, and boundary candidate',
        'source-linked PDF page/screenshot showing accepted room or floor boundary',
      ],
      next_action: 'Halo Fire employee reviews the SAM31 boundary/vector/3D candidates and saves replacement or acceptance evidence.',
      ai_fallback: 'Use SAM31 vector/3D best guesses only as correction prompts until employee review is saved.',
      blocked_claims: ['permit_ready', 'fabrication_ready', 'AutoSprink_parity', 'engineering_grade'],
      claim_gate_effect: CLAIM_GATE_EFFECT,
    },
    {
      code: 'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING',
      status: 'missing',
      severity: 'blocking',
      source_evidence_type: 'professional_ahj_review_packet',
      acceptable_evidence: [
        'licensed professional review packet',
        'AHJ approval record',
        'AutoSprink export/parity packet if parity is claimed',
      ],
      next_action: 'Attach professional/AHJ/AutoSprink evidence before permit-ready, engineering-grade, AHJ-ready, or AutoSprink parity claims.',
      ai_fallback: 'Generate review packet and issue list only; do not clear regulated claims.',
      blocked_claims: ['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity', 'engineering_grade'],
      claim_gate_effect: CLAIM_GATE_EFFECT,
    },
  ];
  const perceptionPacket = {
    artifact_type: 'openclaw.sam31_perception_packet',
    status: 'best_effort_perception_ready',
    application: payload.application,
    project_ref: payload.project_ref,
    source_runtime: 'halofire-local-sam31-bridge',
    source_ref: payload.source_ref || null,
    image_ref: payload.image_ref || null,
    coordinate_frame_ref: payload.coordinate_frame_ref || 'halofire-1881-employee-selected-frame',
    unit: payload.unit,
    perception_lanes: ['segmentation', 'object_identification', 'vector_overlay', 'model_3d_candidate', 'spatial_observation'],
    segments: sections,
    object_hypotheses: objectHypotheses,
    vector_overlays: vectorOverlays,
    model_3d_candidates: model3dCandidates,
    spatial_observations: spatialObservations,
    bid_truth: bidTruth,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: LIMITATIONS.slice(),
    use_for_claims: false,
    claim_gate_effect: CLAIM_GATE_EFFECT,
  };
  const productReviewQueueItem = {
    artifact_type: 'openclaw.sam31.product_review_queue_item.v1',
    status: 'ready_for_human_replacement_or_acceptance',
    application: payload.application,
    project_ref: payload.project_ref,
    source_ref: payload.source_ref || null,
    source_runtime: 'halofire-local-sam31-bridge',
    source_packet_ref: perceptionPacket.artifact_type,
    contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
    supported_evidence_lanes: ['room_boundary_visual_audit', 'sleeve_or_firestop_candidate_review', 'obstruction_or_clash_review', 'vector_overlay_generation', 'model_3d_candidate_generation'],
    acceptable_human_updates: ['semantic_label', 'polygon', 'bbox', 'object_hypothesis', 'vector_overlay', 'model_3d_candidate', 'source_ref', 'confidence'],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    extrapolation_index_count: extrapolationIndex.length,
    extrapolation_index: extrapolationIndex,
    missing_evidence_rows: missingEvidenceRows,
    source_refs: [payload.source_ref, payload.image_ref, ...bidTruth.source_refs].filter(Boolean),
    next_action: 'Queue HaloFire employee room-boundary, sleeve/firestop, obstruction, vector, and 3D review; regulated claims remain blocked.',
    use_for_claims: false,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: LIMITATIONS.slice(),
    claim_gate_effect: CLAIM_GATE_EFFECT,
  };
  return {
    ok: true,
    artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
    status: 'best_effort_extrapolation_ready',
    application: payload.application,
    project_ref: payload.project_ref,
    source_ref: payload.source_ref || null,
    image_ref: payload.image_ref || null,
    source_runtime: 'halofire-local-sam31-bridge',
    bid_truth: bidTruth,
    perception_packet: perceptionPacket,
    product_review_queue_item: productReviewQueueItem,
    extrapolation_index: extrapolationIndex,
    extrapolation_index_count: extrapolationIndex.length,
    missing_evidence_rows: missingEvidenceRows,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: LIMITATIONS.slice(),
    claim_gate_effect: CLAIM_GATE_EFFECT,
  };
}

function invokeFloorplan(args) {
  const parsed = FloorplanPayloadSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      400,
      'SAM31_SCALE_REQUIRED',
      'A positive operator or drawing supplied scale is required for SAM 3.1 floorplan segmentation.',
      ['scale'],
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      result: buildFloorplanSegmentation(parsed.data),
    },
  };
}

function invokeReconstruct(args) {
  const parsed = ReconstructPayloadSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      400,
      'SAM31_RECONSTRUCT_BAD_PAYLOAD',
      'Expected a SAM 3.1 reconstruct payload with componentKey and imageRef.',
      ['componentKey', 'imageRef'],
    );
  }
  const payload = parsed.data;
  return {
    status: 200,
    body: {
      ok: true,
      result: buildShimStl(payload.componentKey),
      evidence: {
        source: 'sam-3.1-shim',
        service: 'sam-3.1',
        op: 'reconstruct',
        runtime: 'halofire-local-sam31-bridge',
        componentKey: payload.componentKey || null,
        imageRef: refSummary(payload.imageRef),
        label:
          'best-effort temporary SAM 3.1 shim reconstruction - NOT manufacturer-exact',
        limitations: LIMITATIONS.slice(),
        claim_gate_effect: CLAIM_GATE_EFFECT,
        blocked_claims: BLOCKED_CLAIMS.slice(),
      },
    },
  };
}

function invokeExtrapolate(args) {
  const parsed = ExtrapolatePayloadSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      400,
      'SAM31_EXTRAPOLATE_BAD_PAYLOAD',
      'Expected a SAM 3.1 extrapolate payload with project_ref/application and optional sections/object_hypotheses.',
      ['project_ref', 'application', 'sections'],
    );
  }
  return {
    status: 200,
    body: buildSam31ExtrapolationArtifact(parsed.data),
  };
}

/**
 * Handle one OpenClaw bridge invocation. Expected failures are returned as typed
 * response data so callers fail soft instead of fabricating evidence.
 */
export async function handleSam31BridgeInvoke(input) {
  const normalized = normalizeEnvelope(input);
  if (!normalized.ok) return normalized.error;

  if (normalized.tool === SAM31_FLOORPLAN_TOOL) {
    return invokeFloorplan(normalized.args);
  }

  if (normalized.tool === 'sam-3.1-direct-payload') {
    const op = normalized.args && typeof normalized.args === 'object' ? normalized.args.op : null;
    if (op === 'segment_floorplan') return invokeFloorplan(normalized.args);
    if (op === 'reconstruct') return invokeReconstruct(normalized.args);
    if (op === 'extrapolate') return invokeExtrapolate(normalized.args);
  }

  return errorResponse(
    404,
    'SAM31_UNSUPPORTED_TOOL',
    'This local SAM 3.1 bridge only supports sam_segment_floorplan and direct SAM reconstruct payloads.',
    [typeof normalized.tool === 'string' ? normalized.tool : 'non_string_tool'],
  );
}

export function sam31StatusBody() {
  return {
    ok: true,
    service: 'halofire-sam31-bridge',
    mode: 'temporary_best_effort_shim',
    services: {
      openclaw: { status: 'local-shim' },
      sam31: {
        status: 'online',
        runtime: 'halofire-local-sam31-bridge',
        claim_gate_effect: CLAIM_GATE_EFFECT,
      },
    },
    tools: [SAM31_FLOORPLAN_TOOL, 'sam-3.1-direct-payload'],
    endpoints: ['/vision/sam31/extrapolate'],
    limitations: LIMITATIONS.slice(),
    blocked_claims: BLOCKED_CLAIMS.slice(),
  };
}

export function createSam31BridgeApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'halofire-sam31-bridge' });
  });

  app.get('/status', (_req, res) => {
    res.json(sam31StatusBody());
  });

  app.post('/codex-bridge/invoke', async (req, res) => {
    const out = await handleSam31BridgeInvoke(req.body);
    res.status(out.status).json(out.body);
  });

  app.post('/vision/sam31/extrapolate', async (req, res) => {
    const out = invokeExtrapolate(req.body);
    res.status(out.status).json(out.body);
  });

  return app;
}
