import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SETTINGS_HTML = path.resolve(import.meta.dirname, '..', 'settings.html');

describe('HaloFire Settings evidence wizard signed reviewer workflow', () => {
  it('surfaces a claim-gate review packet action and status affordance', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('Download review packet');
    expect(html).toContain('id="wizPacketStatus"');
    expect(html).toContain('downloadClaimGateReviewPacket');
  });

  it('surfaces room-boundary floor-plan override actions in the signed settings portal', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('Room-Boundary Floor-Plan Overrides');
    expect(html).toContain('id="settingsRoomBoundaryFloorPlanOverrides"');
    expect(html).toContain('loadSettingsRoomBoundaryFloorPlanOverrides');
    expect(html).toContain('Download floor-plan override action');
    expect(html).toContain('halofire.room_boundary_floor_plan_override_action_packet.v1');
    expect(html).toContain('claim_gate_effect no_claims_cleared');
  });

  it('can record a floor-plan override action acknowledgement without clearing claims', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('recordSettingsRoomBoundaryFloorPlanOverrideAcknowledgement');
    expect(html).toContain('room_boundary_floor_plan_override_action_acknowledgement');
    expect(html).toContain('Record override action acknowledgement');
    expect(html).toContain("recorded_from: 'settings.room_boundary_floor_plan_override_action'");
    expect(html).toContain('no_claim_gates_cleared: true');
  });
});
