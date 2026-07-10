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
    expect(spatial).toBeGreaterThan(geometry);
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
