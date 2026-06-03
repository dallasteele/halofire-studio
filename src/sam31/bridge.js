import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { readCooperative1881BidPackage } from '../data/cooperative-1881-bid-package.js';

export const SAM31_FLOORPLAN_TOOL = 'sam_segment_floorplan';

const DEFAULT_IMAGE_SIZE = Object.freeze({ w: 800, h: 600 });
const DEFAULT_TARGETS = Object.freeze(['building_outline', 'walls', 'rooms', 'layers']);
const DEFAULT_LLM_RUNTIME = 'openclaw-local-llm-best-effort';
const DEFAULT_LLM_PROMPT_REF = 'openclaw.sam31.prompt.identify_objects_vector_3d.v1';
const CLAIM_GATE_EFFECT = 'no_claims_cleared';
const SUPPORTED_APPLICATIONS = Object.freeze(['halo_fire', 'landscout', 'nameforge']);
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
  llm_runtime: z.string().min(1).default(DEFAULT_LLM_RUNTIME),
  prompt_ref: z.string().min(1).default(DEFAULT_LLM_PROMPT_REF),
  prompt: z.string().min(1).optional(),
  sections: z.array(z.record(z.unknown())).default([]),
  object_hypotheses: z.array(z.record(z.unknown())).default([]),
  llm_observations: z.array(z.record(z.unknown())).default([]),
  vector_overlays: z.array(z.record(z.unknown())).default([]),
  model_3d_candidates: z.array(z.record(z.unknown())).default([]),
  source_refs: z.array(z.unknown()).default([]),
}).passthrough();

const ConsumerQueueHandoffSchema = z.object({
  artifact_type: z.literal('openclaw.sam31.consumer_queue_handoff.v1'),
  source_application: z.string().min(1).default('halo_fire'),
  source_project_name: z.string().min(1).optional(),
  source_pdf_boundary_evidence_id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  source_openclaw_sam31_extrapolation_evidence_id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  product_review_queue_item: z.object({
    artifact_type: z.literal('openclaw.sam31.product_review_queue_item.v1'),
  }).passthrough(),
  use_for_claims: z.boolean().optional().default(false),
  claim_gate_effect: z.string().min(1).default(CLAIM_GATE_EFFECT),
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueRefs(values) {
  const seen = new Set();
  return values
    .filter((value) => value !== undefined && value !== null && value !== '')
    .filter((value) => {
      const key = stableJson(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((value) => jsonClone(value));
}

function clampConfidence(value, fallback) {
  return Number.isFinite(Number(value))
    ? Math.max(0, Math.min(1, Number(value)))
    : fallback;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
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

function payloadSourceRefs(payload, bidTruth) {
  return [
    payload.source_ref,
    payload.image_ref,
    ...payload.source_refs,
    ...bidTruth.source_refs,
  ].filter(Boolean);
}

function normalizedLlmObservations(rawObservations, objectHypotheses, segments, payload, sourceRefs) {
  const supplied = Array.isArray(rawObservations) ? rawObservations : [];
  const source = supplied.length
    ? supplied
    : objectHypotheses.map((hypothesis) => {
      const segment = segments.find((entry) => entry.id === hypothesis.segment_id) || segments[0] || {};
      return {
        id: `llm:${hypothesis.id}`,
        segment_id: hypothesis.segment_id || segment.id || 'section-1881-boundary-1',
        object_hypothesis_id: hypothesis.id,
        semantic_label: hypothesis.semantic_label || segment.semantic_label || 'sprinkler_review_candidate',
        confidence: Math.min(0.62, hypothesis.confidence ?? segment.confidence ?? 0.35),
        observation: `${hypothesis.semantic_label || 'sprinkler_review_candidate'} inferred from SAM31 section ${hypothesis.segment_id || segment.id || 'section-1881-boundary-1'} for vector and 3D candidate generation.`,
      };
    });
  return source.map((observation, index) => {
    const segmentId = typeof observation.segment_id === 'string' && observation.segment_id
      ? observation.segment_id
      : objectHypotheses[index]?.segment_id || segments[index]?.id || segments[0]?.id || 'section-1881-boundary-1';
    const objectHypothesisId = typeof observation.object_hypothesis_id === 'string' && observation.object_hypothesis_id
      ? observation.object_hypothesis_id
      : objectHypotheses.find((hypothesis) => hypothesis.segment_id === segmentId)?.id || null;
    return {
      ...observation,
      artifact_type: 'openclaw.sam31.llm_observation.v1',
      id: typeof observation.id === 'string' && observation.id
        ? observation.id
        : (objectHypothesisId ? `llm:${objectHypothesisId}` : `llm:${segmentId}:${index + 1}`),
      segment_id: segmentId,
      object_hypothesis_id: objectHypothesisId,
      semantic_label: typeof observation.semantic_label === 'string' && observation.semantic_label
        ? observation.semantic_label
        : 'sprinkler_review_candidate',
      confidence: Number.isFinite(Number(observation.confidence))
        ? Math.max(0, Math.min(1, Number(observation.confidence)))
        : 0.35,
      source_runtime: 'halofire-local-sam31-bridge',
      llm_runtime: typeof observation.llm_runtime === 'string' && observation.llm_runtime
        ? observation.llm_runtime
        : payload.llm_runtime,
      prompt_ref: typeof observation.prompt_ref === 'string' && observation.prompt_ref
        ? observation.prompt_ref
        : payload.prompt_ref,
      prompt: typeof observation.prompt === 'string' && observation.prompt
        ? observation.prompt
        : (payload.prompt || 'Identify objects, semantic labels, vector overlays, and best-effort 3D model candidates from SAM31 sections.'),
      coordinate_frame_ref: payload.coordinate_frame_ref || 'halofire-1881-employee-selected-frame',
      unit: payload.unit,
      source_refs: Array.isArray(observation.source_refs) && observation.source_refs.length
        ? jsonClone(observation.source_refs)
        : jsonClone(sourceRefs),
      supported_applications: ['halo_fire', 'landscout', 'nameforge'],
      supported_evidence_lanes: ['object_identification_review', 'vector_overlay_generation', 'model_3d_candidate_generation', 'spatial_observation_correction_loop'],
      produces: ['semantic_labels', 'object_hypotheses', 'vector_overlays', 'model_3d_candidates'],
      use_for_claims: false,
      blocked_claims: BLOCKED_CLAIMS.slice(),
      limitations: [
        ...(Array.isArray(observation.limitations) ? observation.limitations : []),
        'LLM observation is best-effort semantic evidence only; replace with employee/product-owner/professional evidence before claims.',
      ],
      claim_gate_effect: CLAIM_GATE_EFFECT,
    };
  });
}

function llmObservationIdsForSegment(llmObservations, segmentId) {
  return llmObservations
    .filter((observation) => observation.segment_id === segmentId)
    .map((observation) => observation.id)
    .filter(Boolean);
}

function artifactSourceRefs(raw, sourceRefs) {
  return uniqueRefs([
    raw.source_ref,
    ...(Array.isArray(raw.source_refs) ? raw.source_refs : []),
    ...sourceRefs,
  ]);
}

function sectionForArtifact(raw, index, sections) {
  const segmentId = typeof raw.segment_id === 'string' && raw.segment_id
    ? raw.segment_id
    : sections[index]?.id || sections[0]?.id || 'section-1881-boundary-1';
  return {
    segmentId,
    section: sections.find((entry) => entry.id === segmentId) || sections[index] || sections[0] || {},
  };
}

function normalizeVectorOverlays(rawOverlays, sections, payload, sourceRefs, llmObservations) {
  const generated = sections.map((section) => ({
    id: `vector:${section.id}`,
    segment_id: section.id,
    kind: 'polygon_path',
    artifact_format: 'svg',
    svg_path: polygonPath(section.polygon),
    bbox: section.bbox,
    confidence: Math.min(0.62, section.confidence ?? 0.35),
    source: 'halofire-local-sam31-bridge',
  }));
  const source = Array.isArray(rawOverlays) && rawOverlays.length ? rawOverlays : generated;
  return source.map((overlay, index) => {
    const { segmentId, section } = sectionForArtifact(overlay, index, sections);
    const observationIds = Array.isArray(overlay.source_llm_observation_ids)
      && overlay.source_llm_observation_ids.length
      ? overlay.source_llm_observation_ids.slice()
      : llmObservationIdsForSegment(llmObservations, segmentId);
    return {
      ...overlay,
      artifact_type: 'openclaw.sam31.vector_overlay.v1',
      id: typeof overlay.id === 'string' && overlay.id ? overlay.id : `vector:${segmentId}`,
      segment_id: segmentId,
      kind: typeof overlay.kind === 'string' && overlay.kind ? overlay.kind : 'polygon_path',
      artifact_format: typeof overlay.artifact_format === 'string' && overlay.artifact_format ? overlay.artifact_format : 'svg',
      svg_path: typeof overlay.svg_path === 'string' && overlay.svg_path ? overlay.svg_path : polygonPath(section.polygon),
      bbox: overlay.bbox || section.bbox || null,
      confidence: clampConfidence(overlay.confidence, Math.min(0.62, section.confidence ?? 0.35)),
      source: typeof overlay.source === 'string' && overlay.source ? overlay.source : 'halofire-local-sam31-bridge',
      source_runtime: 'halofire-local-sam31-bridge',
      coordinate_frame_ref: overlay.coordinate_frame_ref || payload.coordinate_frame_ref || 'halofire-1881-employee-selected-frame',
      unit: overlay.unit || payload.unit,
      source_llm_observation_ids: observationIds,
      source_refs: artifactSourceRefs(overlay, sourceRefs),
      supported_applications: SUPPORTED_APPLICATIONS.slice(),
      supported_evidence_lanes: [
        'object_identification_review',
        'vector_overlay_generation',
        'spatial_observation_correction_loop',
      ],
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      blocked_claims: BLOCKED_CLAIMS.slice(),
      limitations: [
        ...(Array.isArray(overlay.limitations) ? overlay.limitations : []),
        'Best-effort vector overlay; not geometry-accuracy, permit, AHJ, PE, fabrication, manufacturer, or AutoSprink parity evidence.',
      ],
      claim_gate_effect: CLAIM_GATE_EFFECT,
    };
  });
}

function normalizeModel3dCandidates(rawCandidates, sections, payload, sourceRefs, llmObservations) {
  const generated = sections.map((section) => ({
    id: `model3d:${section.id}`,
    segment_id: section.id,
    primitive: 'extruded_polygon',
    generation_method: 'extrude_sam31_section_polygon',
    output_formats: ['glb_candidate_record', 'obj_candidate_record', 'stl_candidate_record'],
    dimensions: {
      height_ft_best_guess: 10,
      source: 'temporary_default_until_employee_or_professional_review',
    },
    confidence: Math.min(0.45, section.confidence ?? 0.35),
    source: 'halofire-local-sam31-bridge',
  }));
  const source = Array.isArray(rawCandidates) && rawCandidates.length ? rawCandidates : generated;
  return source.map((candidate, index) => {
    const { segmentId, section } = sectionForArtifact(candidate, index, sections);
    const observationIds = Array.isArray(candidate.source_llm_observation_ids)
      && candidate.source_llm_observation_ids.length
      ? candidate.source_llm_observation_ids.slice()
      : llmObservationIdsForSegment(llmObservations, segmentId);
    return {
      ...candidate,
      artifact_type: 'openclaw.sam31.model_3d_candidate.v1',
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `model3d:${segmentId}`,
      segment_id: segmentId,
      primitive: typeof candidate.primitive === 'string' && candidate.primitive ? candidate.primitive : 'extruded_polygon',
      generation_method: typeof candidate.generation_method === 'string' && candidate.generation_method
        ? candidate.generation_method
        : 'extrude_sam31_section_polygon',
      output_formats: Array.isArray(candidate.output_formats) && candidate.output_formats.length
        ? candidate.output_formats.slice()
        : ['glb_candidate_record', 'obj_candidate_record', 'stl_candidate_record'],
      dimensions: candidate.dimensions || {
        height_ft_best_guess: 10,
        source: 'temporary_default_until_employee_or_professional_review',
      },
      confidence: clampConfidence(candidate.confidence, Math.min(0.45, section.confidence ?? 0.35)),
      source: typeof candidate.source === 'string' && candidate.source ? candidate.source : 'halofire-local-sam31-bridge',
      source_runtime: 'halofire-local-sam31-bridge',
      coordinate_frame_ref: candidate.coordinate_frame_ref || payload.coordinate_frame_ref || 'halofire-1881-employee-selected-frame',
      unit: candidate.unit || payload.unit,
      source_llm_observation_ids: observationIds,
      source_refs: artifactSourceRefs(candidate, sourceRefs),
      supported_applications: SUPPORTED_APPLICATIONS.slice(),
      supported_evidence_lanes: [
        'object_identification_review',
        'model_3d_candidate_generation',
        'spatial_observation_correction_loop',
      ],
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      blocked_claims: BLOCKED_CLAIMS.slice(),
      limitations: [
        ...(Array.isArray(candidate.limitations) ? candidate.limitations : []),
        'Best-effort 3D candidate; not manufacturer, fabrication, permit, AHJ, PE, engineering, or production evidence.',
      ],
      claim_gate_effect: CLAIM_GATE_EFFECT,
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
  const sectioningPipelineContract = sam31SectioningPipelineContract();
  const sectionToArtifactsContract = sam31SectionToArtifactsContract();
  const sections = (payload.sections.length ? payload.sections : [{}])
    .map((section, index) => normalizedSection(section, index, bidTruth));
  const objectHypotheses = normalizedObjectHypotheses(payload.object_hypotheses, sections);
  const sourceRefs = payloadSourceRefs(payload, bidTruth);
  const llmObservations = normalizedLlmObservations(
    payload.llm_observations,
    objectHypotheses,
    sections,
    payload,
    sourceRefs,
  );
  const vectorOverlays = normalizeVectorOverlays(
    payload.vector_overlays,
    sections,
    payload,
    sourceRefs,
    llmObservations,
  );
  const model3dCandidates = normalizeModel3dCandidates(
    payload.model_3d_candidates,
    sections,
    payload,
    sourceRefs,
    llmObservations,
  );
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
    source_refs: jsonClone(sourceRefs),
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
    vector_overlay_ids: vectorOverlays
      .filter((overlay) => overlay.segment_id === section.id)
      .map((overlay) => overlay.id)
      .filter(Boolean),
    model_3d_candidate_ids: model3dCandidates
      .filter((candidate) => candidate.segment_id === section.id)
      .map((candidate) => candidate.id)
      .filter(Boolean),
    spatial_observation_ids: [`spatial:${section.id}`],
    section_to_artifacts_contract_ref: sectionToArtifactsContract.artifact_type,
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
    llm_observations: llmObservations,
    object_hypotheses: objectHypotheses,
    vector_overlays: vectorOverlays,
    model_3d_candidates: model3dCandidates,
    spatial_observations: spatialObservations,
    sectioning_pipeline_contract: sectioningPipelineContract,
    section_to_artifacts_contract: sectionToArtifactsContract,
    section_to_artifacts_contract_ref: sectionToArtifactsContract.artifact_type,
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
    sectioning_pipeline_contract_ref: sectioningPipelineContract.artifact_type,
    section_to_artifacts_contract_ref: sectionToArtifactsContract.artifact_type,
    llm_observation_count: llmObservations.length,
    llm_observation_ids: llmObservations.map((observation) => observation.id).filter(Boolean),
    supported_evidence_lanes: ['room_boundary_visual_audit', 'sleeve_or_firestop_candidate_review', 'obstruction_or_clash_review', 'vector_overlay_generation', 'model_3d_candidate_generation'],
    acceptable_human_updates: ['semantic_label', 'polygon', 'bbox', 'object_hypothesis', 'vector_overlay', 'model_3d_candidate', 'source_ref', 'confidence'],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    extrapolation_index_count: extrapolationIndex.length,
    extrapolation_index: extrapolationIndex,
    missing_evidence_rows: missingEvidenceRows,
    source_refs: jsonClone(sourceRefs),
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
    sectioning_pipeline_contract: sectioningPipelineContract,
    section_to_artifacts_contract: sectionToArtifactsContract,
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

export function sam31SectioningPipelineContract(sourceRuntime = 'halofire-local-sam31-bridge') {
  const stages = [
    {
      stage: 'sam31_sectioning',
      consumes: ['image_ref', 'sections', 'coordinate_frame_ref', 'unit'],
      produces: ['segments', 'bbox', 'polygon'],
      evidence_role: 'measurement_or_correction_evidence',
    },
    {
      stage: 'llm_object_identification',
      consumes: ['segments', 'object_hypotheses', 'prompt'],
      produces: ['llm_observations', 'object_hypotheses', 'semantic_labels'],
      evidence_role: 'semantic_candidate_evidence',
    },
    {
      stage: 'vector_overlay_generation',
      consumes: ['segments', 'polygon', 'bbox'],
      produces: ['vector_overlays', 'svg_path'],
      evidence_role: 'source_linked_vector_draft',
    },
    {
      stage: 'model_3d_candidate_generation',
      consumes: ['segments', 'vector_overlays', 'unit'],
      produces: ['model_3d_candidates', 'spatial_observations'],
      evidence_role: 'best_effort_3d_candidate',
    },
    {
      stage: 'product_review_queue',
      consumes: ['perception_packet', 'extrapolation_index'],
      produces: ['product_review_queue_item', 'missing_evidence_rows'],
      evidence_role: 'human_replacement_queue',
    },
  ];
  return {
    artifact_type: 'openclaw.sam31.sectioning_pipeline_contract.v1',
    status: 'internal_alpha_ready',
    source_runtime: sourceRuntime,
    supported_applications: ['halo_fire', 'landscout', 'nameforge'],
    stages: stages.map((stage) => ({
      ...stage,
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: CLAIM_GATE_EFFECT,
    })),
    replacement_required_before_claims: true,
    acceptable_replacement_evidence: [
      'employee or product-owner reviewed semantic label',
      'source-linked corrected polygon or bbox',
      'source-linked corrected vector overlay',
      'source-linked corrected 3D model candidate',
      'screenshot or console evidence for reviewed sectioning',
    ],
    blocked_claims: BLOCKED_CLAIMS.slice(),
    final_claim_gate_policy: 'This contract does not clear regulated or owning-product claims; SAM31 sectioning, LLM observations, vector overlays, and 3D candidates require actual replacement or approval evidence.',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: CLAIM_GATE_EFFECT,
    limitations: LIMITATIONS.slice(),
  };
}

export function sam31SectionToArtifactsContract(sourceRuntime = 'halofire-local-sam31-bridge') {
  return {
    artifact_type: 'openclaw.sam31.section_to_artifacts_contract.v1',
    status: 'internal_alpha_ready',
    source_runtime: sourceRuntime,
    supported_applications: SUPPORTED_APPLICATIONS.slice(),
    consumes: [
      'sections',
      'section_polygon',
      'section_bbox',
      'llm_observations',
      'object_hypotheses',
      'coordinate_frame_ref',
      'unit',
      'source_refs',
    ],
    produces: [
      'object_hypotheses',
      'vector_overlays',
      'model_3d_candidates',
      'spatial_observations',
      'extrapolation_index',
      'product_review_queue_item',
    ],
    normalized_artifact_types: [
      'openclaw.sam31.object_hypothesis.v1',
      'openclaw.sam31.vector_overlay.v1',
      'openclaw.sam31.model_3d_candidate.v1',
      'openclaw.sam31.spatial_observation.v1',
    ],
    supported_evidence_lanes: [
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'room_boundary_visual_audit',
      'spatial_observation_correction_loop',
    ],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_human_updates: [
      'semantic_label',
      'polygon',
      'bbox',
      'svg_path',
      'model_3d_candidate',
      'source_ref',
      'confidence',
    ],
    replacement_required_before_claims: true,
    use_for_claims: false,
    no_claim_gates_cleared: true,
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: [
      ...LIMITATIONS,
      'This contract only normalizes AI-perceived objects, SVG/vector overlays, and 3D candidate records for product review queues.',
    ],
    claim_gate_effect: CLAIM_GATE_EFFECT,
  };
}

export function sam31ToolDescriptorBody() {
  return {
    artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
    status: 'ready',
    source_runtime: 'halofire-local-sam31-bridge',
    input_lanes: ['image_ref', 'sections', 'object_hypotheses', 'prompt'],
    output_lanes: ['llm_observations', 'vector_overlays', 'model_3d_candidates', 'extrapolation_index'],
    supported_applications: ['halo_fire', 'landscout', 'nameforge'],
    perception_lanes: ['segmentation', 'object_identification', 'vector_overlay', 'model_3d_candidate', 'spatial_observation'],
    sectioning_pipeline_contract: sam31SectioningPipelineContract(),
    section_to_artifacts_contract: sam31SectionToArtifactsContract(),
    action: {
      method: 'POST',
      href: '/vision/sam31/extrapolate',
      contract_ref: 'openclaw.sam31_extrapolation_contract',
      claim_gate_effect: CLAIM_GATE_EFFECT,
    },
    product_review_queue_contract: {
      artifact_type: 'openclaw.sam31.product_review_queue_contract.v1',
      status: 'ready',
      source_runtime: 'halofire-local-sam31-bridge',
      supported_applications: ['halo_fire', 'landscout', 'nameforge'],
      requires_review_before_claims: true,
      use_for_claims: false,
      claim_gate_effect: CLAIM_GATE_EFFECT,
    },
    consumer_actions: {
      landscout: {
        method: 'POST',
        href: '/landscout/sam31/product-review-queue',
        consumes: 'openclaw.sam31.product_review_queue_item.v1',
        artifact_type: 'openclaw.sam31.consumer_review_queue.landscout.v1',
        claim_gate_effect: CLAIM_GATE_EFFECT,
      },
      nameforge: {
        method: 'POST',
        href: '/nameforge/sam31/product-review-queue',
        consumes: 'openclaw.sam31.product_review_queue_item.v1',
        artifact_type: 'openclaw.sam31.consumer_review_queue.nameforge.v1',
        claim_gate_effect: CLAIM_GATE_EFFECT,
      },
    },
    application_contracts: {
      halo_fire: {
        contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
      },
      landscout: {
        contract_ref: 'openclaw.sam31.application_contract.landscout.v1',
      },
      nameforge: {
        contract_ref: 'openclaw.sam31.application_contract.nameforge.v1',
      },
    },
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_human_updates: ['semantic_label', 'polygon', 'bbox', 'object_hypothesis', 'vector_overlay', 'model_3d_candidate', 'source_ref', 'confidence'],
    blocked_claims: BLOCKED_CLAIMS.slice(),
    limitations: LIMITATIONS.slice(),
    use_for_claims: false,
    claim_gate_effect: CLAIM_GATE_EFFECT,
  };
}

function acceptConsumerQueueHandoff(consumer, body) {
  const parsed = ConsumerQueueHandoffSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      `SAM31_${String(consumer).toUpperCase()}_QUEUE_BAD_HANDOFF`,
      `Expected ${consumer} SAM31 queue handoff artifact openclaw.sam31.consumer_queue_handoff.v1 with product_review_queue_item.`,
      ['artifact_type', 'product_review_queue_item'],
    );
  }
  const handoff = parsed.data;
  if (handoff.use_for_claims !== false || handoff.claim_gate_effect !== CLAIM_GATE_EFFECT) {
    return errorResponse(
      400,
      `SAM31_${String(consumer).toUpperCase()}_QUEUE_CLAIM_GATE_VIOLATION`,
      'SAM31 consumer queue handoffs must be use_for_claims=false and claim_gate_effect=no_claims_cleared.',
      ['use_for_claims', 'claim_gate_effect'],
    );
  }
  const queueId = `sam31-${consumer}-${shortHash({
    consumer,
    source_application: handoff.source_application,
    source_project_name: handoff.source_project_name || handoff.product_review_queue_item.project_ref || null,
    source_pdf_boundary_evidence_id: handoff.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: handoff.source_openclaw_sam31_extrapolation_evidence_id || null,
    product_review_queue_item: handoff.product_review_queue_item,
  })}`;
  return {
    status: 202,
    body: {
      artifact_type: `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
      status: 'queued_for_product_review',
      consumer,
      accepted: true,
      queue_id: queueId,
      persisted_review_packet_ref: `openclaw://${consumer}/sam31/product-review/${queueId}`,
      source_application: handoff.source_application,
      source_project_name: handoff.source_project_name || null,
      source_pdf_boundary_evidence_id: handoff.source_pdf_boundary_evidence_id || null,
      source_openclaw_sam31_extrapolation_evidence_id: handoff.source_openclaw_sam31_extrapolation_evidence_id || null,
      product_review_queue_item_ref: handoff.product_review_queue_item.source_ref || handoff.product_review_queue_item.project_ref || null,
      product_review_queue_item_artifact_type: handoff.product_review_queue_item.artifact_type,
      extrapolation_index_count: Array.isArray(handoff.product_review_queue_item.extrapolation_index)
        ? handoff.product_review_queue_item.extrapolation_index.length
        : 0,
      missing_evidence_row_count: Array.isArray(handoff.product_review_queue_item.missing_evidence_rows)
        ? handoff.product_review_queue_item.missing_evidence_rows.length
        : 0,
      next_action: `${consumer} reviewer replaces or accepts SAM31 object/vector/3D best guesses before any product claim is promoted.`,
      use_for_claims: false,
      blocked_claims: BLOCKED_CLAIMS.slice(),
      limitations: [
        ...LIMITATIONS,
        'This local queue intake proves only that the handoff was accepted for product review; it does not clear downstream product, professional, AHJ, production, survey, brand, trademark, or manufacturer claims.',
      ],
      claim_gate_effect: CLAIM_GATE_EFFECT,
    },
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
    endpoints: [
      '/vision/sam31/tool',
      '/vision/sam31/extrapolate',
      '/landscout/sam31/product-review-queue',
      '/nameforge/sam31/product-review-queue',
    ],
    consumer_queue_endpoints: {
      landscout: '/landscout/sam31/product-review-queue',
      nameforge: '/nameforge/sam31/product-review-queue',
    },
    limitations: LIMITATIONS.slice(),
    blocked_claims: BLOCKED_CLAIMS.slice(),
    claim_gate_effect: CLAIM_GATE_EFFECT,
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

  app.get('/vision/sam31/tool', (_req, res) => {
    res.json(sam31ToolDescriptorBody());
  });

  app.post('/codex-bridge/invoke', async (req, res) => {
    const out = await handleSam31BridgeInvoke(req.body);
    res.status(out.status).json(out.body);
  });

  app.post('/vision/sam31/extrapolate', async (req, res) => {
    const out = invokeExtrapolate(req.body);
    res.status(out.status).json(out.body);
  });

  app.post('/landscout/sam31/product-review-queue', async (req, res) => {
    const out = acceptConsumerQueueHandoff('landscout', req.body);
    res.status(out.status).json(out.body);
  });

  app.post('/nameforge/sam31/product-review-queue', async (req, res) => {
    const out = acceptConsumerQueueHandoff('nameforge', req.body);
    res.status(out.status).json(out.body);
  });

  return app;
}
