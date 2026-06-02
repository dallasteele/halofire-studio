import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('SAM31 sectioning adapter source visibility', () => {
  it('renders the sectioning-to-sprinkler adapter source chain in workbench rows', () => {
    const html = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(html).toContain('renderSam31SectioningAdapterSourceSummary');
    expect(html).toContain('SAM31 sectioning adapter source evidence');
    expect(html).toContain('source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id');
    expect(html).toContain('halofire_sam31_sectioning_sprinkler_review_adapter');
    expect(html).toContain('source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id');
    expect(html).toContain('source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id');
    expect(html).toContain('source_openclaw_sam31_extrapolation_evidence_id');
  });
});
