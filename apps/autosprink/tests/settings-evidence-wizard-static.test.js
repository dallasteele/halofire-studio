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

  it('uses the HaloFire public base path for Settings API calls and navigation', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('HALOFIRE_BASE_PATH');
    expect(html).toContain('HALOFIRE_API_BASE');
    expect(html).toContain("window.location.pathname.startsWith('/halo-fire/')");
    expect(html).toContain("HALOFIRE_BASE_PATH + ['', 'api'].join('/')");
    expect(html).not.toContain("HALOFIRE_BASE_PATH + '/api'");
    expect(html).toContain("const apiPathPrefix = ['', 'api'].join('/');");
    expect(html).not.toContain("startsWith('/api/') ? String(href).slice(4)");
    expect(html).toContain("['', 'api', 'projects'].join('/')");
    expect(html).toContain('fetch(HALOFIRE_API_BASE + path');
    expect(html).toContain("location.href = HALOFIRE_BASE_PATH + '/'");
    expect(html).toContain('wizardState.projects.unshift({ name: wizardUrlPrefill.project })');
    expect(html).toContain('href="./workbench.html"');
    expect(html).toContain('href="./autosprink.html"');
  });

  it('can prefill the signed reviewer workflow from Workbench query parameters', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('prefillEvidenceWizardFromUrl');
    expect(html).toContain('URLSearchParams');
    expect(html).toContain("params.get('project')");
    expect(html).toContain("params.get('gate')");
    expect(html).toContain("params.get('evidenceId')");
    expect(html).toContain("params.get('action')");
    expect(html).toContain("action=resolve");
    expect(html).toContain('wizExistingEvidence');
  });

  it('hydrates the signed reviewer form from matching evidence rows', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('hydrateWizardFromExistingEvidence');
    expect(html).toContain("$('wizExistingEvidence').addEventListener('change'");
    expect(html).toContain("$('wizSourceRef').value = row.source_ref || ''");
    expect(html).toContain("$('wizReviewerName').value = signoff.reviewer_name || ''");
    expect(html).toContain("$('wizReviewerTitle').value = signoff.reviewer_title || ''");
    expect(html).toContain("$('wizSignedAt').value = formatWizardDateTimeLocal(signoff.signed_at)");
    expect(html).toContain("$('wizOrganization').value = signoff.organization || ''");
    expect(html).toContain("$('wizLicenseId').value = signoff.license_id || ''");
  });

  it('surfaces saved review packet and resolve audit context from matching signed reviewer evidence', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('packetContext');
    expect(html).toContain('parsed.target_gate_code');
    expect(html).toContain('parsed.review_packet_href');
    expect(html).toContain('parsed.resolve_audit_packet_href');
    expect(html).toContain('packetStatus.textContent = `Prefilled from Workbench for evidence #${selectedEvidenceId}.');
    expect(html).toContain("auditButton.disabled = !selectedPacketContext.resolveAuditHref && gate.status !== 'cleared'");
  });

  it('prefills record-only signed reviewer uploads from official-flow decision context', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('hydrateWizardFromOfficialFlowContextEvidence');
    expect(html).toContain('hydrateWizardFromOfficialFlowUploadPacket');
    expect(html).toContain("params.get('uploadPacketHref')");
    expect(html).toContain('data-official-flow-upload-packet-href');
    expect(html).toContain('data-official-flow-upload-packet-artifact-type');
    expect(html).toContain('requires_real_signed_evidence');
    expect(html).toContain('officialFlowSignedReviewerPrefillConfig');
    expect(html).toContain('official_flow_professional_ahj_review_decision');
    expect(html).toContain('official_flow_signed_reviewer_context');
    expect(html).toContain("source_official_flow_review_decision_evidence_id");
    expect(html).toContain("claim_gate_effect no_claims_cleared");
    expect(html).toContain("actionEl.value = wizardUrlPrefill.action === 'resolve' ? 'resolve' : 'record'");
    expect(html).toContain('real signed evidence resolve mode');
    expect(html).toContain('claim gate clears only after present evidence and signed reviewer metadata are submitted');
    expect(html).toContain('data-official-flow-context-evidence-id');
  });

  it('surfaces resolved signed-reviewer gates and audit packet downloads in Settings', () => {
    const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
    expect(html).toContain('Resolved Signed-Reviewer Gates');
    expect(html).toContain('id="settingsResolvedSignedReviewerGates"');
    expect(html).toContain('loadSettingsResolvedSignedReviewerGates');
    expect(html).toContain('openSettingsResolvedSignedReviewerEvidence');
    expect(html).toContain('data-settings-resolved-gate-inspect');
    expect(html).toContain('Open accepted evidence read-only');
    expect(html).toContain("claimGateAudit=cleared");
    expect(html).toContain('claim_gate_resolve_audit');
    expect(html).toContain('data-settings-resolved-gate-audit-download');
    expect(html).toContain('Download resolved-gate audit');
    expect(html).toContain('gate_cleared_after_explicit_signed_validation');
    expect(html).toContain('no_unrelated_claims_cleared');
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
