import express from 'express';
import { z } from 'zod';

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

  return app;
}
