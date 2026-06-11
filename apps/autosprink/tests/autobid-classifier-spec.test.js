import { describe, expect, it } from 'vitest';
import { classifyBidEmail } from '../src/autobid/bid-classifier.js';

// AB2 regression — the W7A spec (backlog.json id W7A-bid-classifier) requires
// every text regex to carry \b word boundaries, and the deadline cue to be a
// BODY-only signal. The original implementation dropped both, producing proven
// false positives. These tests lock the spec in. All fixtures are synthetic.

describe('classifyBidEmail — \\b word boundaries (no substring false positives)', () => {
  it('does NOT fire keyword/deadline/sender on the Fitbit/overdue/Megc fixture', () => {
    // The exact empirical repro from the review: every short token is embedded in
    // an unrelated word — 'itb' in 'Fitbit', 'due' in 'overdue'/'residue', 'gc'
    // in 'Megc'. With boundaries none of these text signals may match.
    const email = {
      subject: 'Your Fitbit order has shipped',
      body: 'Payment is overdue? Our packaging is residue-free and recyclable.',
      from: 'Megc Logistics <ship@megc-logistics.example>',
      attachments: [{ filename: 'invoice.pdf', sizeBytes: 12000 }],
    };
    const result = classifyBidEmail(email);
    // Only the plan-attachment (real .pdf) may contribute.
    expect(result.reasons).toEqual(['plan-attachment']);
    expect(result.score).toBeCloseTo(0.25, 5);
    expect(result.isLikelyBid).toBe(false);
  });

  it('keyword still matches a real standalone "ITB" / "RFP" token', () => {
    const email = {
      subject: 'ITB 2026-114 issued',
      body: 'Please review the attached RFP.',
      from: 'someone@personal.example',
      attachments: [],
    };
    const result = classifyBidEmail(email);
    expect(result.reasons).toContain('keyword');
  });

  it('domain "sprinkler" matches as a whole word but not inside another token', () => {
    const yes = classifyBidEmail({
      subject: 'sprinkler scope', body: 'x', from: 'a@b.test', attachments: [],
    });
    expect(yes.reasons).toContain('domain');
    const no = classifyBidEmail({
      subject: 'oversprinklered design notes', body: 'x', from: 'a@b.test', attachments: [],
    });
    // 'oversprinklered' must NOT match /\bsprinkler\b/ — leading boundary fails.
    expect(no.reasons).not.toContain('domain');
  });
});

describe('classifyBidEmail — deadline is a BODY-only signal', () => {
  it('a "due" cue in the SUBJECT does not add the deadline reason', () => {
    const email = {
      subject: 'Payment due notice',
      body: 'Thanks for your business.',
      from: 'billing@vendor.example',
      attachments: [],
    };
    const result = classifyBidEmail(email);
    expect(result.reasons).not.toContain('deadline');
  });

  it('a "due" cue in the BODY does add the deadline reason', () => {
    const email = {
      subject: 'Project update',
      body: 'Proposals are due Friday.',
      from: 'billing@vendor.example',
      attachments: [],
    };
    const result = classifyBidEmail(email);
    expect(result.reasons).toContain('deadline');
  });
});

describe('classifyBidEmail — spec ITB email still scores high', () => {
  it('real-shaped ITB scores >= 0.8 with keyword/domain/plan-attachment/deadline', () => {
    const email = {
      subject: 'Invitation to Bid - Fire Sprinkler - Marriott TI',
      body: 'NFPA 13 wet system. Proposals due Friday. — Acme General Contractor.',
      from: 'estimating@acme-construction.test',
      attachments: [{ filename: 'FP-100.pdf', sizeBytes: 480000 }],
    };
    const result = classifyBidEmail(email);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['keyword', 'domain', 'plan-attachment', 'deadline', 'sender-context']),
    );
    expect(result.isLikelyBid).toBe(true);
  });
});
