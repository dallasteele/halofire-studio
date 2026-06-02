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
});
