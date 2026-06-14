import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('SAM31 consumer provenance workbench actions', () => {
  it('renders required provenance fields and replacement-intake actions for consumer tasks', () => {
    const html = fs.readFileSync(path.join(ROOT, 'official-flow.html'), 'utf8');

    expect(html).toContain('renderSam31RequiredSourceProvenanceFields');
    expect(html).toContain('required_source_provenance_fields');
    expect(html).toContain('source_openclaw_sam31_vector_model_artifact_evidence_id');
    expect(html).toContain('source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id');
    expect(html).toContain('Open product-owner replacement intake');
    expect(html).toContain('/openclaw/sam31/product-owner-replacements');
    expect(html).toContain('data-sam31-product-owner-replacement-intake-evidence-id');
    expect(html).toContain('data-sam31-product-owner-replacement-intake-consumer');
    expect(html).toContain('renderSam31ConsumerReviewReplacementSummary');
    expect(html).toContain('replacement_summary');
    expect(html).toContain('semantic_label_count');
    expect(html).toContain('object_hypothesis_count');
    expect(html).toContain('vector_overlay_count');
    expect(html).toContain('model_3d_candidate_count');
    expect(html).toContain('replacement_values_source_ref');
  });
});
