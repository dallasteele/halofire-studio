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
});
