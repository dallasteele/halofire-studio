/**
 * AB2 — IMAP transport adapter.
 *
 * Implements the mailbox-client interface consumed by src/autobid/intake.js
 * ({ listNewMessages(sinceUid), getMessage(uid) }) on top of the `imapflow`
 * package, reading INBOX in READ-ONLY mode.
 *
 * SECURITY (hard rules):
 *   - Credentials come ONLY from the caller (the settings store or env). They are
 *     NEVER hardcoded, NEVER committed, and NEVER logged. This module logs only
 *     non-secret facts (host, port, mailbox, counts) — never the user or
 *     password.
 *   - READ-ONLY: the INBOX is opened with { readOnly: true } and this adapter
 *     offers no delete/move/flag method. A misclassified email stays put
 *     (fail-closed recoverability).
 *
 * The `imapflow` import is dynamic so that environments without the dependency
 * (or tests that use a synthetic transport) never pay for loading it.
 */

const HEADER_BODY_FALLBACK = '';

/**
 * Decode a single MIME part body to UTF-8 text given its transfer encoding.
 * Pure + exported so tests can prove base64/quoted-printable bodies become
 * readable text WITHOUT a live IMAP server. We only ever feed the classifier
 * decoded text — never raw base64/quoted-printable, which both hides real
 * keywords (false negatives) and smuggles junk substrings like 'itb'/'due'
 * (false positives).
 */
export function decodePartBody(buf, encoding) {
  if (buf == null) return '';
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'base64') {
    const text = Buffer.isBuffer(buf) ? buf.toString('ascii') : String(buf);
    return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  if (enc === 'quoted-printable') {
    const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
    return decodeQuotedPrintable(text);
  }
  // 7bit / 8bit / binary / unknown — already text.
  return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
}

/**
 * RFC 2045 quoted-printable decode (handles soft line breaks `=\r\n`).
 * =XX escapes are RAW BYTES, so we collect bytes and interpret the whole result
 * as UTF-8 — otherwise a multi-byte char like `=C3=A9` (é) would be mangled into
 * two latin1 code points.
 */
export function decodeQuotedPrintable(text) {
  // Drop soft line breaks first (an '=' at end of line continues the line).
  const src = String(text).replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Literal char — emit its UTF-8 bytes (handles any chars already decoded).
      const b = Buffer.from(ch, 'utf8');
      for (const byte of b) bytes.push(byte);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Strip HTML tags + collapse whitespace so an HTML-only body still classifies. */
export function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk a bodyStructure tree and pick the best body part to classify.
 * Prefers the first text/plain leaf; falls back to the first text/html leaf
 * (which the caller will strip to text). Attachment parts are NEVER chosen, so
 * encoded plan-set blobs never reach the classifier. Returns
 * { part: '<imap part id>', type, encoding } or null.
 */
export function selectBodyPart(node, partId = '') {
  if (!node || typeof node !== 'object') return null;

  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  if (children.length) {
    // Multipart container — recurse, numbering parts 1..n per RFC 3501.
    let htmlCandidate = null;
    for (let i = 0; i < children.length; i += 1) {
      const childId = partId ? `${partId}.${i + 1}` : String(i + 1);
      const found = selectBodyPart(children[i], childId);
      if (found && found.type === 'text/plain') return found; // best match wins immediately
      if (found && found.type === 'text/html' && !htmlCandidate) htmlCandidate = found;
    }
    return htmlCandidate;
  }

  // Leaf node. Skip anything dispositioned as an attachment.
  const disposition = node.disposition ? String(node.disposition).toLowerCase() : '';
  if (disposition === 'attachment') return null;
  const type = node.type ? String(node.type).toLowerCase() : '';
  if (type !== 'text/plain' && type !== 'text/html') return null;
  return {
    part: partId || '1',
    type,
    encoding: node.encoding ? String(node.encoding).toLowerCase() : '',
  };
}

function requireConfig(config) {
  const host = config?.host;
  const user = config?.user;
  const password = config?.password;
  const port = config?.port != null ? Number(config.port) : 993;
  if (!host || typeof host !== 'string') throw new Error('imap-transport: host is required');
  if (!user || typeof user !== 'string') throw new Error('imap-transport: user is required');
  if (!password || typeof password !== 'string') throw new Error('imap-transport: password is required');
  if (!Number.isFinite(port) || port <= 0) throw new Error('imap-transport: port must be a positive number');
  const secure = config?.secure != null ? Boolean(config.secure) : port === 993;
  return { host, port, user, password, secure };
}

/**
 * Turn a decoded body part into the plain text the classifier scores.
 * text/html is stripped to text; text/plain passes through. Pure + exported.
 */
export function partToText(decoded, type) {
  if (!decoded) return HEADER_BODY_FALLBACK;
  const text = String(decoded);
  return String(type || '').toLowerCase() === 'text/html' ? htmlToText(text) : text.trim();
}

/**
 * createImapMailbox(config, opts) -> mailbox client + lifecycle helpers.
 *   config: { host, port, user, password, secure }  (secrets supplied by caller)
 *   opts:   { logger }
 *
 * Returns: { connect(), close(), listNewMessages(sinceUid), getMessage(uid),
 *            uidValidity }
 *
 * After connect(), `mailbox.uidValidity` holds the INBOX UIDVALIDITY (a string)
 * so the caller can detect a mailbox UID-space reset and re-baseline. UIDs are
 * only meaningful within one UIDVALIDITY epoch.
 */
export async function createImapMailbox(config, opts = {}) {
  const cfg = requireConfig(config);
  const log = opts.logger || { info() {}, warn() {}, error() {} };

  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // Silence imapflow's own logger so credentials/commands never reach our logs.
    logger: false,
  });

  let opened = false;
  const state = { uidValidity: null };

  async function connect() {
    await client.connect();
    // READ-ONLY: never let intake mutate the inbox.
    const mb = await client.mailboxOpen('INBOX', { readOnly: true });
    opened = true;
    // UIDVALIDITY can be a BigInt from imapflow — normalise to a plain string.
    const uv = mb && mb.uidValidity != null ? mb.uidValidity : (client.mailbox && client.mailbox.uidValidity);
    state.uidValidity = uv != null ? String(uv) : null;
    log.info(`imap: connected ${cfg.host}:${cfg.port} INBOX (read-only) uidvalidity=${state.uidValidity || 'n/a'}`);
  }

  async function close() {
    try {
      if (opened) await client.logout();
    } catch (err) {
      log.warn(`imap: logout error: ${err.message}`);
    } finally {
      opened = false;
    }
  }

  async function listNewMessages(sinceUid = 0) {
    const since = Number(sinceUid) || 0;
    // Fetch only uids greater than the last-seen uid. imapflow accepts a
    // "<uid>:*" range against the UID space.
    const range = `${since + 1}:*`;
    const out = [];
    for await (const msg of client.fetch(range, { uid: true }, { uid: true })) {
      // imapflow can return the last existing message when the range starts past
      // the end; filter to strictly-newer uids to stay idempotent.
      if (Number(msg.uid) > since) out.push({ uid: msg.uid });
    }
    return out;
  }

  async function getMessage(uid) {
    // Fetch metadata only — NOT `source: true`. Pulling the full RFC822 source
    // buffers multi-MB plan-set attachments into memory AND, when handed to the
    // classifier, leaks encoded attachment bytes as fake text signals. We fetch
    // just the structure here and download only the chosen text part below.
    const msg = await client.fetchOne(
      String(uid),
      { uid: true, envelope: true, bodyStructure: true },
      { uid: true },
    );
    if (!msg) throw new Error(`imap: message uid=${uid} not found`);

    const env = msg.envelope || {};
    const fromAddr = Array.isArray(env.from) && env.from[0]
      ? formatAddress(env.from[0])
      : '';

    const attachments = collectAttachments(msg.bodyStructure);

    // Decode ONLY the text/plain (or text/html) body part — never attachment
    // blobs. A single-part text/* message has no childNodes, so selectBodyPart
    // returns part '1'.
    let body = HEADER_BODY_FALLBACK;
    const chosen = selectBodyPart(msg.bodyStructure);
    if (chosen) {
      try {
        const dl = await client.download(String(uid), chosen.part, { uid: true });
        const buf = dl && dl.content ? await streamToBuffer(dl.content) : null;
        if (buf) {
          // imapflow's download already applies the transfer-encoding, but some
          // servers return it raw — decode defensively, then strip HTML.
          const decoded = decodePartBody(buf, chosen.encoding);
          body = partToText(decoded, chosen.type);
        }
      } catch (err) {
        log.warn(`imap: body download failed uid=${uid}: ${err.message}`);
      }
    }

    return {
      uid: msg.uid,
      messageId: env.messageId || null,
      subject: env.subject || '',
      from: fromAddr,
      date: env.date ? new Date(env.date).toISOString() : null,
      body,
      attachments,
    };
  }

  const mailbox = { connect, close, listNewMessages, getMessage };
  // uidValidity is a live getter — it is null until connect() resolves.
  Object.defineProperty(mailbox, 'uidValidity', { get: () => state.uidValidity, enumerable: true });
  return mailbox;
}

/** Collect a readable stream into a single Buffer. */
async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream === 'string') return Buffer.from(stream);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function formatAddress(addr) {
  const mailbox = addr.address || (addr.mailbox && addr.host ? `${addr.mailbox}@${addr.host}` : '');
  if (addr.name && mailbox) return `${addr.name} <${mailbox}>`;
  return mailbox || addr.name || '';
}

/** Walk a bodyStructure tree collecting attachment {filename, sizeBytes}. */
function collectAttachments(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const disposition = node.disposition ? String(node.disposition).toLowerCase() : '';
  const filename =
    (node.dispositionParameters && (node.dispositionParameters.filename || node.dispositionParameters.FILENAME)) ||
    (node.parameters && (node.parameters.name || node.parameters.NAME)) ||
    null;
  if ((disposition === 'attachment' || filename) && filename) {
    out.push({ filename: String(filename), sizeBytes: Number(node.size) || 0 });
  }
  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  for (const child of children) collectAttachments(child, out);
  return out;
}

export default { createImapMailbox };
