import { describe, expect, it } from 'vitest';
import { classifyBidEmail } from '../src/autobid/bid-classifier.js';

// AB2 — W7A pure classifier heuristics. No I/O; every fixture below is a
// clearly SYNTHETIC email (no real correspondence is presented as real).

describe('classifyBidEmail — real-shaped ITB email', () => {
  it('scores a fire-sprinkler invitation to bid >= 0.8 with >= 3 reasons', () => {
    const email = {
      subject: 'Invitation to Bid — Fire Sprinkler System, Rexburg Warehouse',
      body: [
        'You are invited to submit a proposal for the NFPA 13 wet fire sprinkler',
        'system on the Rexburg warehouse project. Proposals are due Friday.',
        'See attached plan set. — Acme General Contractor',
      ].join('\n'),
      from: 'estimating@acme-construction.test',
      attachments: [
        { filename: 'FP-100-sprinkler-plan.pdf', sizeBytes: 482000 },
        { filename: 'spec-section-21.pdf', sizeBytes: 91000 },
      ],
    };
    const result = classifyBidEmail(email);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.isLikelyBid).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
    expect(result.reasons).toContain('keyword');
    expect(result.reasons).toContain('domain');
    expect(result.reasons).toContain('plan-attachment');
  });
});

describe('classifyBidEmail — non-bid noise', () => {
  it('scores a generic newsletter under 0.3 and isLikelyBid false', () => {
    const email = {
      subject: 'Your weekly industry newsletter is here',
      body: 'Top stories this week, a recipe, and an upcoming webinar. Unsubscribe anytime.',
      from: 'news@somenewsletter.test',
      attachments: [],
    };
    const result = classifyBidEmail(email);
    expect(result.score).toBeLessThan(0.3);
    expect(result.isLikelyBid).toBe(false);
  });
});

describe('classifyBidEmail — malformed input throws', () => {
  it('throws TypeError when subject is missing', () => {
    expect(() => classifyBidEmail({ body: 'x', attachments: [] })).toThrow(TypeError);
  });
  it('throws TypeError when body is missing', () => {
    expect(() => classifyBidEmail({ subject: 'x', attachments: [] })).toThrow(TypeError);
  });
  it('throws TypeError when attachments is not an array', () => {
    expect(() => classifyBidEmail({ subject: 'x', body: 'y', attachments: null })).toThrow(TypeError);
  });
  it('throws TypeError when email itself is not an object', () => {
    expect(() => classifyBidEmail(null)).toThrow(TypeError);
    expect(() => classifyBidEmail('not an email')).toThrow(TypeError);
  });
});

describe('classifyBidEmail — single-signal isolation', () => {
  it('an attachment-only email gets exactly the plan-attachment reason', () => {
    const email = {
      subject: 'see attached',
      body: 'here it is',
      from: 'someone@personal.test',
      attachments: [{ filename: 'drawing.dwg', sizeBytes: 12000 }],
    };
    const result = classifyBidEmail(email);
    expect(result.reasons).toEqual(['plan-attachment']);
    expect(result.score).toBeCloseTo(0.25, 5);
    expect(result.isLikelyBid).toBe(false);
  });

  it('ignores non-plan attachments (e.g. an image)', () => {
    const email = {
      subject: 'photos',
      body: 'from the site visit',
      from: 'someone@personal.test',
      attachments: [{ filename: 'site-photo.jpg', sizeBytes: 2200000 }],
    };
    const result = classifyBidEmail(email);
    expect(result.reasons).toEqual([]);
    expect(result.score).toBe(0);
  });
});

describe('classifyBidEmail — additive cap', () => {
  it('caps at 1.0 even when every signal fires', () => {
    const email = {
      subject: 'Invitation to Bid: Fire Sprinkler / NFPA 13 — proposals due Monday',
      body: 'Request for proposal from the general contractor. Bid date is firm.',
      from: 'estimating@bigbuilders-contracting.test',
      attachments: [{ filename: 'plans.pdf', sizeBytes: 100 }, { filename: 'detail.dxf', sizeBytes: 200 }],
    };
    const result = classifyBidEmail(email);
    // 0.35 + 0.2 + 0.25 + 0.1 + 0.1 = 1.0 exactly; cap holds.
    expect(result.score).toBe(1);
    expect(result.reasons).toEqual(['keyword', 'domain', 'plan-attachment', 'deadline', 'sender-context']);
    expect(result.isLikelyBid).toBe(true);
  });
});
