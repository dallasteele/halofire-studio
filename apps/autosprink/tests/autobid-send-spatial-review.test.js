import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pagePath = fileURLToPath(new URL('../autobid-send.html', import.meta.url));
const html = readFileSync(pagePath, 'utf8');

describe('AutoBid final spatial review panel', () => {
  it('renders spatial verification between plan geometry and 3D/design', () => {
    const geometry = html.indexOf('+     geometryPanel(p)');
    const spatial = html.indexOf('+     spatialVerificationPanel(p.spatial_verification)');
    const model3d = html.indexOf('<span class="t">3D massing</span>');
    const design = html.indexOf('<span class="t">Sprinkler design</span>');
    expect(geometry).toBeGreaterThan(0);
    const density = html.indexOf('+     densityResolutionPanel(p)');
    expect(density).toBeGreaterThan(geometry);
    expect(spatial).toBeGreaterThan(geometry);
    const fpVector = html.indexOf('+     fpVectorReviewPanel(p.fp_vector_review)');
    expect(fpVector).toBeGreaterThan(spatial);
    expect(model3d).toBeGreaterThan(spatial);
    expect(design).toBeGreaterThan(model3d);
  });

  it('shows the stored overlay, physical sheet/page, allowlisted metrics, and digests', () => {
    expect(html).toContain('urls.overlay_png');
    expect(html).toContain('Sheet / physical page');
    expect(html).toContain('var SPATIAL_METRICS = [');
    expect(html).toContain("['classified_wall_ink_coverage','Classified wall ink coverage','pct']");
    expect(html).toContain('PNG SHA-256');
    expect(html).toContain('Manifest SHA-256');
    expect(html).toContain('Source PDF SHA-256');
    expect(html).toContain('plate.viewport_provenance');
    expect(html).toContain('Registered source viewports:');
    expect(html).toContain('data-viewport-role=');
    expect(html).not.toContain('Object.keys(plate.metrics');
  });

  it('renders FP vector candidates as estimator-visible, non-gating review evidence', () => {
    expect(html).toContain('function fpVectorReviewPanel(fp)');
    expect(html).toContain('id="fpVectorReviewPanel"');
    expect(html).toContain('data-fp-vector-artifact=');
    expect(html).toContain('fp-vector-overlay');
    expect(html).toContain('not attempted · not scored');
    expect(html).toContain('never clear the spatial or bid-grade gates');
    expect(html).toContain('Truth-free bundle');
    expect(html).toContain('Candidate family groups');
    expect(html).toContain('anchor_family_id');
    expect(html).toContain('support_family_ids');
    expect(html).toContain('candidate occurrences');
    expect(html).toContain('support_co_location_fraction');
    expect(html).toContain('candidate_requires_overlay_eye_gate');
    expect(html).toContain('Reviewed sprinkler-head count');
    expect(html).toContain('data-decision="accepted"');
    expect(html).toContain('Accept semantic count');
    expect(html).toContain("'/fp-vector-review'");
    expect(html).toContain('expected_bundle_sha256');
    expect(html).toContain('expected_overlay_sha256');
  });

  it('surfaces density provenance as diagnostic-only evidence', () => {
    expect(html).toContain('function densityResolutionPanel(p)');
    expect(html).toContain('id="densityResolutionPanel"');
    expect(html).toContain('Density source');
    expect(html).toContain('diagnostic-only; it does not alter NFPA spacing');
    expect(html).toContain('observed');
  });

  it('requires a decoded stored overlay and an automated pass for acceptance', () => {
    expect(html).toContain('data-spatial-overlay-index=');
    expect(html).toContain('data-overlay-visible');
    expect(html).toContain("image.addEventListener('load',markVisible)");
    expect(html).toContain("image.addEventListener('error',markBroken)");
    expect(html).toContain("if(image.complete) (image.naturalWidth>0?markVisible:markBroken)();");
    expect(html).toContain('Stored overlay failed to load or decode. Acceptance remains disabled.');
    expect(html).toContain('data-decision="accepted" disabled');
    expect(html).toContain('>Accept overlay</button>');
    expect(html).toContain('data-decision="rejected">Reject overlay</button>');
    expect(html).toContain("gate.passed!==true || button.getAttribute('data-overlay-visible')!=='true'");
    expect(html).toContain('Reviewed wall recall (0.90-1.00)');
    expect(html).toContain('Phantom room count');
    expect(html).toContain("recall<0.90 || recall>1 || phantoms!==0");
  });

  it('posts the concurrency-bound review command and reloads current state', () => {
    expect(html).toContain("'/spatial-review'");
    expect(html).toMatch(/artifact_id:plate\.artifact_id,[\s\S]*decision:decision,[\s\S]*note:note\?note\.value:'',[\s\S]*reviewed_structural_wall_recall:decision==='accepted'\?recall:null,[\s\S]*phantom_room_count:decision==='accepted'\?phantoms:null,[\s\S]*expected_png_sha256:integrity\.png_sha256,[\s\S]*expected_manifest_sha256:integrity\.manifest_sha256/);
    expect(html).toContain('location.reload();');
  });

  it('keeps honest export independent and sends the corrected qualifier key', () => {
    expect(html).toContain('never blocks honest package export');
    expect(html).toContain('JSON.stringify({ edited_qualifiers: edited })');
    expect(html).not.toContain('JSON.stringify({ qualifiers: edited })');
    expect(html).not.toMatch(/sendBtn[^\n]+spatial_verification/);
  });

  it('withholds provisional studio drawing until accepted vector geometry is present', () => {
    expect(html).toContain('window.__AGD = p.accepted_geometry_drawing || null;');
    expect(html).toContain('window.__AGD && (window.__AGD.available!==true || window.__AGD.accepted_geometry!==true)');
    expect(html).toContain('sd.accepted_geometry!==true');
    expect(html).toContain('Per-room drawing withheld pending human overlay review.');
    expect(html).toContain('provisional raster/rectangle drawing is not rendered');
    expect(html).toContain('var poly=r.polygon_ft||r.poly;');
    expect(html).toContain('p.wallRuns||[]');
    expect(html).toContain('walls+rooms+segs+dots+riser');
  });
});
