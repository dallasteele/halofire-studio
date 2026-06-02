import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SAM31_FLOORPLAN_TOOL,
  createSam31BridgeApp,
  handleSam31BridgeInvoke,
} from '../src/sam31/bridge.js';

const FLOORPLAN_PAYLOAD = Object.freeze({
  service: 'sam-3.1',
  op: 'segment_floorplan',
  pdfRef: 'fixtures/cooperative-1881-page-0.pdf',
  pageIndex: 0,
  scale: 0.05,
  targets: ['building_outline', 'walls', 'rooms'],
});

let server;
let baseUrl;

beforeAll(async () => {
  const app = createSam31BridgeApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

describe('SAM 3.1 local bridge contract', () => {
  it('returns a truth-labeled floorplan segmentation through the OpenClaw bridge envelope', async () => {
    const out = await handleSam31BridgeInvoke({
      tool: SAM31_FLOORPLAN_TOOL,
      args: FLOORPLAN_PAYLOAD,
    });

    expect(out.status).toBe(200);
    expect(out.body.result.source).toBe('sam-3.1-shim');
    expect(out.body.result.layers.building_outline).toHaveLength(4);
    expect(out.body.result.imageSize).toEqual({ w: 800, h: 600 });
    expect(out.body.result.claim_gate_effect).toBe('no_claims_cleared');
    expect(out.body.result.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );
    expect(out.body.result.label).toMatch(/best-effort/i);
    expect(out.body.result.label).toMatch(/temporary/i);
    expect(out.body.result.label).toMatch(/NOT AHJ\/PE\/AutoSprink/i);
    expect(out.body.result.limitations.join(' ')).toMatch(/does not clear/i);
  });

  it('requires the operator or drawing scale before returning a floorplan polygon', async () => {
    const out = await handleSam31BridgeInvoke({
      tool: SAM31_FLOORPLAN_TOOL,
      args: { ...FLOORPLAN_PAYLOAD, scale: 0 },
    });

    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe('SAM31_SCALE_REQUIRED');
    expect(out.body.result).toBeUndefined();
  });

  it('supports the direct SAM payload shape used by the existing component reconstruction sourcer', async () => {
    const out = await handleSam31BridgeInvoke({
      tool: {
        service: 'sam-3.1',
        op: 'reconstruct',
        componentKey: 'valve_check_2p5in',
        imageRef: 'fixtures/valve-check-cut-sheet.png',
        outputFormat: 'stl',
      },
    });

    expect(out.status).toBe(200);
    expect(out.body.result).toContain('solid halofire_sam31_shim_valve_check_2p5in');
    expect(out.body.evidence.source).toBe('sam-3.1-shim');
    expect(out.body.evidence.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('supports direct extrapolate payloads through the OpenClaw bridge envelope', async () => {
    const out = await handleSam31BridgeInvoke({
      tool: {
        service: 'sam-3.1',
        op: 'extrapolate',
        project_ref: 'halo_fire:The Cooperative 1881 - Salt Lake City UT',
        application: 'halo_fire',
        sections: [{
          id: 'section-direct-1881',
          semantic_label: 'obstruction_or_clash_candidate',
          polygon: [[1, 1], [9, 1], [9, 7], [1, 7], [1, 1]],
        }],
      },
    });

    expect(out.status).toBe(200);
    expect(out.body.product_review_queue_item.artifact_type).toBe('openclaw.sam31.product_review_queue_item.v1');
    expect(out.body.product_review_queue_item.extrapolation_index[0]).toEqual(expect.objectContaining({
      section_id: 'section-direct-1881',
      claim_gate_effect: 'no_claims_cleared',
      use_for_claims: false,
    }));
    expect(out.body.missing_evidence_rows.map((row) => row.code)).toEqual(expect.arrayContaining([
      'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING',
      'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING',
    ]));
  });

  it('reports unsupported tools as typed bridge errors', async () => {
    const out = await handleSam31BridgeInvoke({ tool: 'unknown_tool', args: {} });

    expect(out.status).toBe(404);
    expect(out.body.error.code).toBe('SAM31_UNSUPPORTED_TOOL');
  });

  it('serves /status and /codex-bridge/invoke over HTTP', async () => {
    const status = await fetch(`${baseUrl}/status`);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.services.openclaw.status).toBe('local-shim');
    expect(statusBody.services.sam31.status).toBe('online');
    expect(statusBody.endpoints).toEqual(expect.arrayContaining([
      '/vision/sam31/tool',
      '/landscout/sam31/product-review-queue',
      '/nameforge/sam31/product-review-queue',
    ]));

    const invoke = await fetch(`${baseUrl}/codex-bridge/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: SAM31_FLOORPLAN_TOOL, args: FLOORPLAN_PAYLOAD }),
    });
    expect(invoke.status).toBe(200);
    const body = await invoke.json();
    expect(body.result.layers.building_outline).toHaveLength(4);
    expect(body.result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('advertises and accepts LandScout and NameForge SAM31 product review queue handoffs', async () => {
    const tool = await fetch(`${baseUrl}/vision/sam31/tool`);
    expect(tool.status).toBe(200);
    const descriptor = await tool.json();
    expect(descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
      status: 'ready',
      source_runtime: 'halofire-local-sam31-bridge',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.consumer_actions.landscout).toEqual(expect.objectContaining({
      method: 'POST',
      href: '/landscout/sam31/product-review-queue',
      consumes: 'openclaw.sam31.product_review_queue_item.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.consumer_actions.nameforge).toEqual(expect.objectContaining({
      method: 'POST',
      href: '/nameforge/sam31/product-review-queue',
      consumes: 'openclaw.sam31.product_review_queue_item.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const handoff = {
      artifact_type: 'openclaw.sam31.consumer_queue_handoff.v1',
      source_application: 'halo_fire',
      source_project_name: 'The Cooperative 1881 - Salt Lake City UT',
      source_pdf_boundary_evidence_id: 101,
      source_openclaw_sam31_extrapolation_evidence_id: 202,
      product_review_queue_item: {
        artifact_type: 'openclaw.sam31.product_review_queue_item.v1',
        application: 'halo_fire',
        project_ref: 'halo_fire:The Cooperative 1881 - Salt Lake City UT',
        source_ref: '1881://sam31/consumer-intake-test',
        extrapolation_index: [
          {
            section_id: 'section-1881-test',
            semantic_label: 'sleeve_or_firestop_candidate',
            use_for_claims: false,
            claim_gate_effect: 'no_claims_cleared',
          },
        ],
        missing_evidence_rows: [
          { code: 'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING' },
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };

    for (const [consumer, route] of [
      ['landscout', '/landscout/sam31/product-review-queue'],
      ['nameforge', '/nameforge/sam31/product-review-queue'],
    ]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(handoff),
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toEqual(expect.objectContaining({
        artifact_type: `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
        status: 'queued_for_product_review',
        consumer,
        accepted: true,
        source_application: 'halo_fire',
        source_project_name: 'The Cooperative 1881 - Salt Lake City UT',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(body.queue_id).toMatch(new RegExp(`^sam31-${consumer}-[a-f0-9]{16}$`));
      expect(body.persisted_review_packet_ref).toBe(`openclaw://${consumer}/sam31/product-review/${body.queue_id}`);
      expect(body.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_approval', 'AutoSprink_parity']));
      expect(body.limitations.join(' ')).toMatch(/does not clear/i);
    }
  });

  it('serves /vision/sam31/extrapolate as a HaloFire 1881 object/vector/3D review packet', async () => {
    const response = await fetch(`${baseUrl}/vision/sam31/extrapolate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_ref: 'halo_fire:The Cooperative 1881 - Salt Lake City UT',
        application: 'halo_fire',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)',
        image_ref: '1881 drawings employee-selected page',
        coordinate_frame_ref: '1881-pdf-page-review',
        unit: 'ft',
        sections: [{
          id: 'section-room-boundary-1881-level-1',
          semantic_label: 'sprinkler_room_boundary_candidate',
          polygon: [[0, 0], [413, 0], [413, 413.206], [0, 413.206], [0, 0]],
          confidence: 0.42,
          source: 'employee-selected-pdf-boundary-candidate',
        }],
        object_hypotheses: [{
          id: 'object:sleeve-candidate-1881-1',
          segment_id: 'section-room-boundary-1881-level-1',
          semantic_label: 'sleeve_or_firestop_candidate',
          confidence: 0.36,
        }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
      application: 'halo_fire',
      project_ref: 'halo_fire:The Cooperative 1881 - Salt Lake City UT',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.bid_truth).toEqual(expect.objectContaining({
      project: 'The Cooperative 1881 - Salt Lake City UT',
      head_count: 1420,
      square_feet: 170654,
      bid_total: 538792.35,
    }));
    expect(body.perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_packet',
      application: 'halo_fire',
      source_runtime: 'halofire-local-sam31-bridge',
      coordinate_frame_ref: '1881-pdf-page-review',
      unit: 'ft',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.perception_packet.segments[0]).toEqual(expect.objectContaining({
      id: 'section-room-boundary-1881-level-1',
      semantic_label: 'sprinkler_room_boundary_candidate',
    }));
    expect(body.perception_packet.object_hypotheses[0].semantic_label).toBe('sleeve_or_firestop_candidate');
    expect(body.perception_packet.vector_overlays[0]).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.vector_overlay.v1',
      segment_id: 'section-room-boundary-1881-level-1',
      kind: 'polygon_path',
    }));
    expect(body.perception_packet.model_3d_candidates[0]).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.model_3d_candidate.v1',
      segment_id: 'section-room-boundary-1881-level-1',
      primitive: 'extruded_polygon',
    }));
    expect(body.product_review_queue_item).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.product_review_queue_item.v1',
      application: 'halo_fire',
      project_ref: 'halo_fire:The Cooperative 1881 - Salt Lake City UT',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.product_review_queue_item.extrapolation_index[0]).toEqual(expect.objectContaining({
      section_id: 'section-room-boundary-1881-level-1',
      vector_overlay_ids: ['vector:section-room-boundary-1881-level-1'],
      model_3d_candidate_ids: ['model3d:section-room-boundary-1881-level-1'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.missing_evidence_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING',
        acceptable_evidence: expect.arrayContaining(['employee-selected drawing sheet, scale, and boundary candidate']),
        blocked_claims: expect.arrayContaining(['permit_ready', 'AutoSprink_parity']),
      }),
      expect.objectContaining({
        code: 'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING',
        acceptable_evidence: expect.arrayContaining(['licensed professional review packet', 'AHJ approval record']),
        blocked_claims: expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review']),
      }),
    ]));
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']));
    expect(body.limitations.join(' ')).toMatch(/temporary/i);
  });
});
