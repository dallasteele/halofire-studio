/**
 * AB2 — Bid-email classifier (W7A pure heuristics).
 *
 * Pure ESM, no I/O, no side effects. Given a parsed email it returns a 0..1
 * likelihood that the message is an incoming bid invitation (ITB / RFP / tender)
 * for fire-sprinkler work, plus the human-readable reasons that drove the score.
 *
 * This is the HEURISTIC layer only. The local-qwen judgment layer (ollama on
 * GX10) is intentionally OUT of this slice — it is the AB2.1 follow-up. Keeping
 * the heuristics pure and deterministic means the intake watcher (and the GX10
 * build loop that targets this file) can score an email offline, reproducibly,
 * and the operator can always see WHY a message was or was not flagged.
 *
 * Scoring is ADDITIVE and capped at 1.0. Each signal contributes its weight
 * once (a signal never double-counts). isLikelyBid is score >= 0.5.
 */

// Every text regex below carries \b word boundaries, per the W7A spec
// (backlog.json id W7A-bid-classifier). Without them short tokens false-match
// inside unrelated words: 'itb' inside 'Fitbit', 'due' inside 'overdue', 'gc'
// inside 'Megc'. The boundaries are load-bearing — do not drop them.

/** Subject/body signal: an explicit invitation-to-bid phrase. */
const KEYWORD_RE = /\b(invitation to bid|itb|rfp|request for proposal|bid request|bid invitation|tender)\b/i;
/** Subject/body signal: fire-sprinkler domain language. */
const DOMAIN_RE = /\b(fire (sprinkler|protection|suppression)|nfpa|sprinkler)\b/i;
/** Attachment signal: a plan/drawing file (PDF-first; DWG/DXF are a bonus). */
const PLAN_ATTACHMENT_RE = /\.(pdf|dwg|dxf)$/i;
/** Body-only signal: a due date / deadline cue. */
const DEADLINE_RE = /\b(due|deadline|bid date|proposals? due)\b/i;
/** Sender signal: a construction / GC / estimating context in the From header. */
const SENDER_RE = /\b(gc|construction|builders?|contracting|estimating)\b/i;
/** Body signal: an explicit general-contractor mention. */
const GENERAL_CONTRACTOR_RE = /general contractor/i;

const WEIGHTS = {
  keyword: 0.35,
  domain: 0.2,
  'plan-attachment': 0.25,
  deadline: 0.1,
  'sender-context': 0.1,
};

/**
 * classifyBidEmail(email) -> { score, isLikelyBid, reasons }
 *
 * email = { subject, body, attachments: [{ filename, sizeBytes }], from }
 *   - subject, body: required strings.
 *   - attachments: required array (may be empty). Each entry's `filename` is the
 *     only field this classifier reads; `from` is optional.
 *
 * Throws TypeError when subject/body are not strings or attachments is not an
 * array — the caller must hand over a well-formed, already-parsed message.
 */
export function classifyBidEmail(email) {
  if (email === null || typeof email !== 'object' || Array.isArray(email)) {
    throw new TypeError('classifyBidEmail: email must be an object');
  }
  const { subject, body, attachments, from } = email;
  if (typeof subject !== 'string') {
    throw new TypeError('classifyBidEmail: email.subject must be a string');
  }
  if (typeof body !== 'string') {
    throw new TypeError('classifyBidEmail: email.body must be a string');
  }
  if (!Array.isArray(attachments)) {
    throw new TypeError('classifyBidEmail: email.attachments must be an array');
  }

  const haystack = `${subject}\n${body}`;
  const fromStr = typeof from === 'string' ? from : '';
  const reasons = [];
  let score = 0;

  const add = (reason) => {
    score += WEIGHTS[reason];
    reasons.push(reason);
  };

  if (KEYWORD_RE.test(haystack)) add('keyword');
  if (DOMAIN_RE.test(haystack)) add('domain');

  const hasPlanAttachment = attachments.some(
    (att) => att && typeof att.filename === 'string' && PLAN_ATTACHMENT_RE.test(att.filename),
  );
  if (hasPlanAttachment) add('plan-attachment');

  // Spec: the deadline cue is a BODY-only signal (not subject).
  if (DEADLINE_RE.test(body)) add('deadline');

  if (SENDER_RE.test(fromStr) || GENERAL_CONTRACTOR_RE.test(body)) add('sender-context');

  // Additive cap: never exceed full confidence regardless of signal stacking.
  if (score > 1) score = 1;

  return { score, isLikelyBid: score >= 0.5, reasons };
}

export default { classifyBidEmail };
