/**
 * AB2 — Email intake module (transport-agnostic).
 *
 * Turns incoming mailbox messages into CRM records. This module owns NO
 * transport: it accepts an already-connected mailbox client and a better-sqlite3
 * `db` handle, so the same logic runs against a real IMAP inbox in production and
 * against a synthetic in-memory transport in tests (no network).
 *
 * For each previously-unseen message:
 *   1. classify it with the pure W7A heuristics (bid-classifier.js);
 *   2. if it looks like a bid -> upsert a client (matched by From address, else
 *      created with a name parsed from the From header), create a bid_request
 *      (source 'email', status 'received', title from subject, notes carrying the
 *      score + reasons), and record plan attachments (.pdf/.dwg/.dxf) as
 *      project_evidence rows following the existing evidence convention;
 *   3. ALWAYS record the message uid in autobid_intake_log so re-polls are
 *      idempotent — a message is processed exactly once.
 *
 * READ-ONLY MAILBOX (fail-closed recoverability): this module NEVER deletes,
 * moves, or marks mail. It only ever reads. A misclassified email must remain in
 * the inbox, untouched, so a human can recover it.
 *
 * HONESTY: the local-qwen judgment layer (AB2.1 follow-up) is intentionally out
 * of this slice — classification here is heuristics only. Nothing is auto-sent.
 */

import { classifyBidEmail } from './bid-classifier.js';

const PLAN_ATTACHMENT_RE = /\.(pdf|dwg|dxf)$/i;

/**
 * Mailbox client interface (duck-typed):
 *   listNewMessages(sinceUid) -> Promise<Array<{ uid }>> | Array<{ uid }>
 *   getMessage(uid) -> Promise<{ uid, subject, body, from, date,
 *                                attachments: [{ filename, sizeBytes, content?:Buffer }] }>
 */

/** Parse a display name + bare address out of a From header. */
export function parseFromHeader(from) {
  const raw = typeof from === 'string' ? from.trim() : '';
  // "Display Name" <addr@host> | Display Name <addr@host> | addr@host
  const angled = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, '').trim();
    const address = angled[2].trim().toLowerCase();
    return { name: name || address || null, address: address || null };
  }
  const address = raw.toLowerCase() || null;
  return { name: raw || null, address };
}

/** Find an existing client by email (case-insensitive) or create one. */
function upsertClientByFrom(db, from) {
  const { name, address } = parseFromHeader(from);
  if (address) {
    const existing = db
      .prepare('SELECT id FROM clients WHERE email IS NOT NULL AND lower(email) = ?')
      .get(address);
    if (existing) return existing.id;
  }
  const clientName = name || address || 'Unknown sender';
  const result = db
    .prepare('INSERT INTO clients (name, company, email) VALUES (?,?,?)')
    .run(clientName, null, address || null);
  return Number(result.lastInsertRowid);
}

/** Record plan attachments as project_evidence; returns the inserted ids. */
function storePlanAttachments(db, { projectName, bidRequestId, message }) {
  const ids = [];
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const att of attachments) {
    if (!att || typeof att.filename !== 'string') continue;
    if (!PLAN_ATTACHMENT_RE.test(att.filename)) continue;
    const sizeBytes = Number.isFinite(att.sizeBytes) ? att.sizeBytes : null;
    // Follows the settings 'upload' convention: source_file is the filename
    // STRING, source_ref a logical ref, notes a JSON metadata blob. NO bytes are
    // persisted to disk in this slice (matches the existing evidence store; a
    // real on-disk attachment store is a later step).
    const notes = JSON.stringify({
      origin: 'email-intake',
      bid_request_id: bidRequestId,
      message_uid: message.uid != null ? String(message.uid) : null,
      message_id: message.messageId || null,
      from: message.from || null,
      size_bytes: sizeBytes,
    });
    const sourceRef = `email-intake://bid-request/${bidRequestId}/${att.filename}`;
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectName, 'email_attachment', att.filename, sourceRef, 'present', notes);
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}

/**
 * processMessage(db, message, nowIso) -> {
 *   uid, classified, isLikelyBid, score, reasons, bidRequestId|null,
 *   clientId|null, evidenceIds: number[], skipped?: 'already-processed'
 * }
 *
 * Idempotent: if the uid is already in autobid_intake_log it short-circuits and
 * creates nothing. All DB writes for a single bid message run in one transaction
 * so a failure leaves no half-written record.
 */
export function processMessage(db, message, nowIso = new Date().toISOString()) {
  const uid = message && message.uid != null ? String(message.uid) : null;
  if (!uid) {
    throw new TypeError('processMessage: message.uid is required');
  }

  const already = db.prepare('SELECT id FROM autobid_intake_log WHERE uid = ?').get(uid);
  if (already) {
    return { uid, skipped: 'already-processed', isLikelyBid: false, evidenceIds: [] };
  }

  const email = {
    subject: typeof message.subject === 'string' ? message.subject : '',
    body: typeof message.body === 'string' ? message.body : '',
    from: typeof message.from === 'string' ? message.from : '',
    attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((a) => ({
      filename: a && typeof a.filename === 'string' ? a.filename : '',
      sizeBytes: a && Number.isFinite(a.sizeBytes) ? a.sizeBytes : 0,
    })),
  };

  const { score, isLikelyBid, reasons } = classifyBidEmail(email);
  const messageId = message.messageId || null;

  const tx = db.transaction(() => {
    let bidRequestId = null;
    let clientId = null;
    let evidenceIds = [];

    if (isLikelyBid) {
      clientId = upsertClientByFrom(db, email.from);
      const title = email.subject.trim() || '(untitled email bid)';
      const history = [{ status: 'received', atIso: nowIso }];
      const notes = JSON.stringify({
        origin: 'email-intake',
        classifier: 'W7A-heuristics',
        score,
        reasons,
        from: email.from || null,
        message_uid: uid,
        message_id: messageId,
      });
      const bid = db
        .prepare(`INSERT INTO bid_requests (client_id, title, source, status, status_history, notes)
                  VALUES (?, ?, 'email', 'received', ?, ?)`)
        .run(clientId, title, JSON.stringify(history), notes);
      bidRequestId = Number(bid.lastInsertRowid);

      const projectName = `Email bid #${bidRequestId} — ${title}`.slice(0, 200);
      evidenceIds = storePlanAttachments(db, { projectName, bidRequestId, message });
    }

    db.prepare(`INSERT INTO autobid_intake_log
                  (uid, message_id, classified_score, is_likely_bid, bid_request_id, processed_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uid, messageId, score, isLikelyBid ? 1 : 0, bidRequestId, nowIso);

    return { bidRequestId, clientId, evidenceIds };
  });

  const { bidRequestId, clientId, evidenceIds } = tx();
  return { uid, classified: true, isLikelyBid, score, reasons, bidRequestId, clientId, evidenceIds };
}

/**
 * pollOnce(db, mailbox, opts) -> {
 *   pollStartedAt, pollFinishedAt, messagesSeen, processed, bidsCreated,
 *   skipped, errors: [{ uid, error }], lastUid
 * }
 *
 * READ-ONLY: only calls mailbox.listNewMessages / mailbox.getMessage. Never
 * mutates the mailbox. A single malformed message is logged and skipped — it
 * never crashes the poll (fail-closed: one bad email cannot stop intake).
 *
 * opts:
 *   sinceUid  - highest uid already seen (mailbox decides how to use it)
 *   nowIso    - timestamp injection for deterministic tests
 *   logger    - optional { info, warn, error }
 */
export async function pollOnce(db, mailbox, opts = {}) {
  const { sinceUid = 0, nowIso = new Date().toISOString(), logger = null } = opts;
  const log = logger || { info() {}, warn() {}, error() {} };
  const pollStartedAt = nowIso;

  const result = {
    pollStartedAt,
    pollFinishedAt: null,
    messagesSeen: 0,
    processed: 0,
    bidsCreated: 0,
    skipped: 0,
    errors: [],
    lastUid: sinceUid,
  };

  let listed = [];
  try {
    listed = await mailbox.listNewMessages(sinceUid);
    if (!Array.isArray(listed)) listed = [];
  } catch (err) {
    // A listing failure is the poll's only hard error — surface it but do not throw.
    log.error(`intake: listNewMessages failed: ${err.message}`);
    result.errors.push({ uid: null, error: err.message });
    result.pollFinishedAt = new Date().toISOString();
    return result;
  }

  result.messagesSeen = listed.length;

  // Process in ascending uid order and HALT the watermark at the first failure.
  // The persisted lastUid is the next poll's `${lastUid+1}:*` floor, so it must
  // never jump past a uid we failed to process — otherwise a transient IMAP
  // hiccup on one ITB email silently drops it forever (no retry, no log row).
  // We therefore cap lastUid at (firstFailedUid - 1): every uid below the first
  // failure is durably processed; the failure and everything after it are
  // re-listed on the next poll.
  const ordered = listed
    .map((entry) => (entry && entry.uid != null ? entry.uid : null))
    .sort((a, b) => Number(a) - Number(b));

  let firstFailedUid = null; // lowest uid that errored this batch (numeric)
  for (const uid of ordered) {
    try {
      const message = await mailbox.getMessage(uid);
      if (!message || message.uid == null) {
        throw new Error('mailbox returned a message with no uid');
      }
      const outcome = processMessage(db, message, nowIso);
      if (outcome.skipped) {
        result.skipped += 1;
      } else {
        result.processed += 1;
        if (outcome.isLikelyBid) result.bidsCreated += 1;
      }
      const numericUid = Number(message.uid);
      // Only advance the watermark while no earlier uid has failed, and never
      // past the first failure.
      if (
        Number.isFinite(numericUid)
        && numericUid > Number(result.lastUid)
        && (firstFailedUid == null || numericUid < firstFailedUid)
      ) {
        result.lastUid = numericUid;
      }
    } catch (err) {
      // Fail-closed: a malformed/unreadable message is logged and skipped. We do
      // NOT advance lastUid to or past it (so it is re-fetched next poll) and we
      // never touch the mailbox.
      const numericUid = Number(uid);
      if (Number.isFinite(numericUid) && (firstFailedUid == null || numericUid < firstFailedUid)) {
        firstFailedUid = numericUid;
        // Clamp the watermark below the first failure in case a higher uid was
        // already processed earlier in this loop.
        if (Number(result.lastUid) >= firstFailedUid) result.lastUid = firstFailedUid - 1;
      }
      log.warn(`intake: skipping message uid=${uid}: ${err.message}`);
      result.errors.push({ uid: uid != null ? String(uid) : null, error: err.message });
    }
  }

  result.pollFinishedAt = new Date().toISOString();
  log.info(
    `intake: poll done seen=${result.messagesSeen} processed=${result.processed} bids=${result.bidsCreated} skipped=${result.skipped} errors=${result.errors.length}`,
  );
  return result;
}

export default { pollOnce, processMessage, parseFromHeader };
