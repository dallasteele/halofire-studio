import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const htmlPath = fileURLToPath(new URL('../autosprink.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

describe('accepted AutoBid model3d route contract', () => {
  it('loads accepted model geometry before static extraction and stays fail-closed', () => {
    expect(html).toContain("from '/src/engine/accepted-model3d.js'");
    expect(html).toContain('async function getAcceptedModel3dLevels()');
    expect(html).toContain("'/autobid/package/' + encodeURIComponent(doc) + '?by=doc'");
    expect(html).toContain("data.source === 'accepted-vector-overlay'");
    expect(html).toContain("await getPlanLevelsJson()");
    expect(html).toContain('accepted_model3d_fetch_failed:');
    expect(html).toContain('accepted geometry has no exact physical PDF page mapping');
    expect(html).toContain('evidence.physicalPageNumber');
  });

  it('does not replace the accepted overlay with a typical-floor repeat', () => {
    expect(html).toContain('accepted vector overlays (physical-page bound; needs-verification)');
    expect(html).toContain('acceptedModel3d: data.source ===');
    expect(html).toContain('sourceDocumentId: data.sourceDocumentId || null');
  });
});
