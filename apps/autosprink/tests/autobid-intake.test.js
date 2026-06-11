import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { pollOnce, processMessage, parseFromHeader } from '../src/autobid/intake.js';

// AB2 — intake unit tests. A SYNTHETIC in-memory transport (no network, no real
// mail) drives the poll. Every fixture is clearly synthetic. The transport also
// asserts the mailbox is never mutated: it exposes no delete/move/flag and
// records every call so we can prove only reads happened.

const NOW = '2026-06-10T12:00:00.000Z';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE bid_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id),
      title TEXT NOT NULL, source TEXT DEFAULT 'manual', due_date TEXT,
      status TEXT DEFAULT 'received', status_history TEXT,
      project_id INTEGER, estimate_total_cents INTEGER, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE project_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL, evidence_type TEXT NOT NULL,
      source_file TEXT, source_ref TEXT, status TEXT NOT NULL, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE autobid_intake_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE, message_id TEXT,
      classified_score REAL, is_likely_bid INTEGER NOT NULL DEFAULT 0,
      bid_request_id INTEGER, processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

/**
 * Synthetic read-only mailbox. Records every method call. There is NO delete,
 * move, or flag method — any attempt to mutate would be a missing-function
 * crash, which the tests assert never happens.
 */
function makeMailbox(messages) {
  const calls = [];
  const byUid = new Map(messages.map((m) => [m.uid, m]));
  return {
    calls,
    listNewMessages(sinceUid) {
      calls.push(['listNewMessages', sinceUid]);
      return messages.filter((m) => Number(m.uid) > Number(sinceUid)).map((m) => ({ uid: m.uid }));
    },
    getMessage(uid) {
      calls.push(['getMessage', uid]);
      const m = byUid.get(uid);
      if (!m) throw new Error(`no message uid=${uid}`);
      return m;
    },
  };
}

const BID_MSG = {
  uid: 101,
  messageId: '<itb-101@acme.test>',
  subject: 'Invitation to Bid — Fire Sprinkler, Synthetic Warehouse',
  from: 'Acme Estimating <estimating@acme-construction.test>',
  date: NOW,
  body: 'NFPA 13 wet system. Proposals due Friday. — general contractor. See attached plans.',
  attachments: [
    { filename: 'FP-100.pdf', sizeBytes: 320000 },
    { filename: 'logo.png', sizeBytes: 4000 },
  ],
};

const NEWSLETTER_MSG = {
  uid: 102,
  messageId: '<news-102@newsletter.test>',
  subject: 'Weekly newsletter',
  from: 'news@newsletter.test',
  date: NOW,
  body: 'Stories, a recipe, and a webinar. Unsubscribe anytime.',
  attachments: [],
};

let db;
beforeEach(() => { db = makeDb(); });
afterEach(() => { db.close(); });

describe('parseFromHeader', () => {
  it('splits a display-name + angle-bracket address', () => {
    expect(parseFromHeader('Acme Estimating <estimating@acme.test>'))
      .toEqual({ name: 'Acme Estimating', address: 'estimating@acme.test' });
  });
  it('handles a bare address', () => {
    expect(parseFromHeader('bids@acme.test')).toEqual({ name: 'bids@acme.test', address: 'bids@acme.test' });
  });
});

describe('intake — likely-bid email', () => {
  it('creates client + bid + evidence + log row', async () => {
    const mailbox = makeMailbox([BID_MSG]);
    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });

    expect(result.messagesSeen).toBe(1);
    expect(result.bidsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.lastUid).toBe(101);

    const clients = db.prepare('SELECT * FROM clients').all();
    expect(clients).toHaveLength(1);
    expect(clients[0].email).toBe('estimating@acme-construction.test');
    expect(clients[0].name).toBe('Acme Estimating');

    const bids = db.prepare('SELECT * FROM bid_requests').all();
    expect(bids).toHaveLength(1);
    expect(bids[0].source).toBe('email');
    expect(bids[0].status).toBe('received');
    expect(bids[0].client_id).toBe(clients[0].id);
    const notes = JSON.parse(bids[0].notes);
    expect(notes.origin).toBe('email-intake');
    expect(Array.isArray(notes.reasons)).toBe(true);
    expect(notes.reasons.length).toBeGreaterThanOrEqual(3);

    // status_history seeded with a single 'received' entry at NOW.
    const history = JSON.parse(bids[0].status_history);
    expect(history).toEqual([{ status: 'received', atIso: NOW }]);

    // Only the .pdf plan is stored as evidence — the .png is ignored.
    const evidence = db.prepare('SELECT * FROM project_evidence').all();
    expect(evidence).toHaveLength(1);
    expect(evidence[0].source_file).toBe('FP-100.pdf');
    expect(evidence[0].evidence_type).toBe('email_attachment');
    expect(evidence[0].status).toBe('present');

    const logRows = db.prepare('SELECT * FROM autobid_intake_log').all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0].uid).toBe('101');
    expect(logRows[0].is_likely_bid).toBe(1);
    expect(logRows[0].bid_request_id).toBe(bids[0].id);
  });
});

describe('intake — idempotency', () => {
  it('a second poll over the same message creates nothing new', async () => {
    const mailbox = makeMailbox([BID_MSG]);
    await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });
    // Re-poll from scratch (sinceUid 0) — the log dedupes by uid even if the
    // transport re-lists the message.
    const second = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });

    expect(second.skipped).toBe(1);
    expect(second.bidsCreated).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bid_requests').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM clients').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM project_evidence').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM autobid_intake_log').get().n).toBe(1);
  });
});

describe('intake — non-bid email', () => {
  it('is logged but creates no bid', async () => {
    const mailbox = makeMailbox([NEWSLETTER_MSG]);
    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });

    expect(result.bidsCreated).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bid_requests').get().n).toBe(0);
    const logRows = db.prepare('SELECT * FROM autobid_intake_log').all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0].uid).toBe('102');
    expect(logRows[0].is_likely_bid).toBe(0);
    expect(logRows[0].bid_request_id).toBeNull();
  });
});

describe('intake — malformed message is skipped, poll survives (fail-closed)', () => {
  it('logs and skips a message with no uid without crashing the poll', async () => {
    const warnings = [];
    const logger = { info() {}, warn: (m) => warnings.push(m), error() {} };
    // Transport lists two uids but getMessage returns a uid-less object for 200.
    const mailbox = {
      calls: [],
      listNewMessages(sinceUid) { this.calls.push(['list', sinceUid]); return [{ uid: 200 }, { uid: 101 }]; },
      getMessage(uid) {
        this.calls.push(['get', uid]);
        if (uid === 200) return { subject: 'broken', body: 'x', attachments: [] }; // no uid
        return BID_MSG;
      },
    };
    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW, logger });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].uid).toBe('200');
    expect(warnings.length).toBe(1);
    // The good message still processed into a bid.
    expect(result.bidsCreated).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM bid_requests').get().n).toBe(1);
  });

  it('a listing failure is reported without throwing', async () => {
    const mailbox = { listNewMessages() { throw new Error('IMAP down'); }, getMessage() {} };
    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/IMAP down/);
    expect(result.bidsCreated).toBe(0);
  });
});

describe('intake — mailbox is never mutated (read-only)', () => {
  it('only calls listNewMessages and getMessage; no mutating method exists or is invoked', async () => {
    const mailbox = makeMailbox([BID_MSG, NEWSLETTER_MSG]);
    await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });

    const methodsCalled = new Set(mailbox.calls.map((c) => c[0]));
    expect(methodsCalled).toEqual(new Set(['listNewMessages', 'getMessage']));
    // No delete/move/flag surface exists on the transport at all.
    expect(mailbox.deleteMessage).toBeUndefined();
    expect(mailbox.moveMessage).toBeUndefined();
    expect(mailbox.setFlags).toBeUndefined();
  });
});

describe('processMessage — direct unit', () => {
  it('is idempotent at the single-message level', () => {
    const first = processMessage(db, BID_MSG, NOW);
    expect(first.isLikelyBid).toBe(true);
    expect(first.bidRequestId).toBeGreaterThan(0);
    const second = processMessage(db, BID_MSG, NOW);
    expect(second.skipped).toBe('already-processed');
    expect(db.prepare('SELECT COUNT(*) n FROM bid_requests').get().n).toBe(1);
  });

  it('reuses an existing client matched by From address (case-insensitive)', () => {
    db.prepare('INSERT INTO clients (name, email) VALUES (?, ?)')
      .run('Existing Acme', 'ESTIMATING@acme-construction.test');
    const out = processMessage(db, BID_MSG, NOW);
    expect(out.isLikelyBid).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM clients').get().n).toBe(1);
    expect(out.clientId).toBe(1);
  });

  it('throws when uid is missing', () => {
    expect(() => processMessage(db, { subject: 'x', body: 'y', attachments: [] }, NOW)).toThrow(TypeError);
  });
});
