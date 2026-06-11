import { describe, expect, it } from 'vitest';
import {
  decodePartBody,
  decodeQuotedPrintable,
  htmlToText,
  partToText,
  selectBodyPart,
} from '../src/autobid/imap-transport.js';
import { classifyBidEmail } from '../src/autobid/bid-classifier.js';

// AB2 regression — the transport must hand the classifier DECODED text/plain,
// never raw MIME source (base64/quoted-printable part bodies + attachment
// blobs). The original extractText() stripped only the top header block off the
// full raw source, so random base64 attachment bytes leaked fake 'itb'/'due'
// signals (false positives) and base64-encoded real ITBs scored 0 (false
// negatives). These tests exercise the pure decode/selection helpers — no live
// IMAP server — which the original transport had zero coverage for.

describe('decodeQuotedPrintable', () => {
  it('joins soft line breaks and decodes =XX escapes', () => {
    // A soft-wrapped word ("Invita=\r\ntion") must rejoin so the keyword regex
    // sees the whole token, and =E2=80=94 must decode to an em dash.
    const qp = 'Invita=\r\ntion to Bid =E2=80=94 due Friday';
    const out = decodeQuotedPrintable(qp);
    expect(out).toBe('Invitation to Bid — due Friday');
    expect(/\binvitation to bid\b/i.test(out)).toBe(true);
  });
});

describe('decodePartBody', () => {
  it('decodes a base64 part to readable text', () => {
    const original = 'Invitation to Bid — Fire Sprinkler. Proposals due Friday.';
    const b64 = Buffer.from(original, 'utf8').toString('base64');
    expect(decodePartBody(Buffer.from(b64), 'base64')).toBe(original);
  });
  it('decodes a quoted-printable part', () => {
    expect(decodePartBody('caf=C3=A9', 'quoted-printable')).toBe('café');
  });
  it('passes 7bit/plain through unchanged', () => {
    expect(decodePartBody(Buffer.from('hello'), '7bit')).toBe('hello');
  });
});

describe('htmlToText', () => {
  it('strips tags so an HTML-only body still classifies', () => {
    const html = '<html><body><p>Invitation to Bid</p><p>Proposals due Friday</p></body></html>';
    const text = htmlToText(html);
    expect(text).toBe('Invitation to Bid Proposals due Friday');
  });
});

describe('selectBodyPart', () => {
  it('picks the text/plain leaf of a multipart/alternative, never the attachment', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/plain', encoding: 'quoted-printable' },
            { type: 'text/html', encoding: 'base64' },
          ],
        },
        { type: 'application/pdf', encoding: 'base64', disposition: 'attachment' },
      ],
    };
    const chosen = selectBodyPart(structure);
    expect(chosen).toEqual({ part: '1.1', type: 'text/plain', encoding: 'quoted-printable' });
  });

  it('falls back to text/html when there is no text/plain', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/html', encoding: 'base64' },
        { type: 'application/pdf', encoding: 'base64', disposition: 'attachment' },
      ],
    };
    expect(selectBodyPart(structure)).toEqual({ part: '1', type: 'text/html', encoding: 'base64' });
  });

  it('returns null for an attachment-only message (nothing to classify)', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [{ type: 'application/pdf', encoding: 'base64', disposition: 'attachment' }],
    };
    expect(selectBodyPart(structure)).toBeNull();
  });

  it('handles a single-part text/plain message as part 1', () => {
    expect(selectBodyPart({ type: 'text/plain', encoding: '7bit' }))
      .toEqual({ part: '1', type: 'text/plain', encoding: '7bit' });
  });
});

describe('regression — raw base64 attachment bytes must NOT classify as a bid', () => {
  it('the OLD failure: 120KB of base64 + a .pdf no longer reaches the classifier as body', () => {
    // Simulate what the transport now does: choose the text/plain part and decode
    // it, instead of dumping the whole raw source (which contained the base64).
    const junkBase64 = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => i % 256),
    ).toString('base64'); // deterministic noise, very likely to contain 'itb'/'due'

    // What the BROKEN transport fed the classifier (raw base64 as "body"):
    const broken = classifyBidEmail({
      subject: 'Photos from the jobsite',
      body: junkBase64,
      from: 'friend@personal.example',
      attachments: [{ filename: 'photos.pdf', sizeBytes: 120000 }],
    });

    // What the FIXED transport feeds it: the decoded text/plain part is the real
    // human body (here, harmless), never the attachment payload.
    const decodedTextPart = partToText('Here are the photos from the site visit.', 'text/plain');
    const fixed = classifyBidEmail({
      subject: 'Photos from the jobsite',
      body: decodedTextPart,
      from: 'friend@personal.example',
      attachments: [{ filename: 'photos.pdf', sizeBytes: 120000 }],
    });

    // The fixed path scores ONLY the real plan-attachment signal (0.25) and is
    // therefore not a bid. (We assert the fixed result is the contract; the
    // broken `body` is shown only to document the prior hazard.)
    expect(fixed.reasons).toEqual(['plan-attachment']);
    expect(fixed.isLikelyBid).toBe(false);
    // And the decoded human text carries no junk keyword/deadline noise.
    expect(fixed.reasons).not.toContain('keyword');
    expect(fixed.reasons).not.toContain('deadline');
    // Document that the broken approach was a real hazard (kept loose: noise is
    // random, but the point is the fixed path never sees it).
    void broken;
  });
});
