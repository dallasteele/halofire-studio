import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { pollOnce } from '../src/autobid/intake.js';

// AB2 regression — pollOnce must NEVER advance the persisted watermark past a
// uid it failed to process. The original code advanced result.lastUid whenever
// ANY later message succeeded, so a transient getMessage failure on a lower uid
// was silently dropped forever (re-list floor = lastUid+1 skipped it). A missed
// ITB is lost revenue, so this is the slice's core fail-closed rule.

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

const BID_MSG = {
  uid: 200,
  messageId: '<itb-200@acme.test>',
  subject: 'Invitation to Bid — Fire Sprinkler',
  from: 'Acme Estimating <estimating@acme-construction.test>',
  date: NOW,
  body: 'NFPA 13 wet system. Proposals due Friday. — general contractor.',
  attachments: [{ filename: 'FP-100.pdf', sizeBytes: 320000 }],
};

let db;
beforeEach(() => { db = makeDb(); });
afterEach(() => { db.close(); });

describe('pollOnce — mid-batch failure does NOT advance the watermark', () => {
  it('a failed low uid (150) followed by a good high uid (200) keeps lastUid below 150', async () => {
    const calls = [];
    const mailbox = {
      listNewMessages(sinceUid) {
        calls.push(['list', sinceUid]);
        // Returned out of order on purpose; pollOnce must process in uid order.
        return [{ uid: 200 }, { uid: 150 }];
      },
      getMessage(uid) {
        calls.push(['get', uid]);
        if (uid === 150) throw new Error('transient IMAP hiccup');
        return BID_MSG;
      },
    };

    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });

    // 150 errored; the watermark must NOT have jumped to 200 (or anywhere >= 150).
    expect(result.lastUid).toBeLessThan(150);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].uid).toBe('150');
    // The next poll's floor (lastUid+1) must still include 150 so it is retried.
    expect(Number(result.lastUid) + 1).toBeLessThanOrEqual(150);
  });

  it('the failed message is re-listed on the next poll and then processed', async () => {
    let failFirstTime = true;
    const mailbox = {
      listNewMessages(sinceUid) {
        return [{ uid: 200 }, { uid: 150 }].filter((m) => Number(m.uid) > Number(sinceUid));
      },
      getMessage(uid) {
        if (uid === 150 && failFirstTime) { failFirstTime = false; throw new Error('transient'); }
        return uid === 150
          ? { ...BID_MSG, uid: 150, messageId: '<itb-150@acme.test>' }
          : BID_MSG;
      },
    };

    const first = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });
    expect(first.errors).toHaveLength(1);

    // Second poll uses the (un-advanced) watermark and now succeeds on 150.
    const second = await pollOnce(db, mailbox, { sinceUid: first.lastUid, nowIso: NOW });
    expect(second.errors).toHaveLength(0);

    // Both ITB emails ended up as bids — none was permanently lost.
    const bids = db.prepare('SELECT COUNT(*) n FROM bid_requests').get().n;
    expect(bids).toBe(2);
    const logged = db.prepare('SELECT uid FROM autobid_intake_log ORDER BY uid').all().map((r) => r.uid);
    expect(logged).toContain('150');
    expect(logged).toContain('200');
  });

  it('all-success batch still advances the watermark to the highest uid', async () => {
    const mailbox = {
      listNewMessages() { return [{ uid: 150 }, { uid: 200 }]; },
      getMessage(uid) {
        return uid === 150
          ? { ...BID_MSG, uid: 150, messageId: '<itb-150@acme.test>' }
          : BID_MSG;
      },
    };
    const result = await pollOnce(db, mailbox, { sinceUid: 0, nowIso: NOW });
    expect(result.errors).toHaveLength(0);
    expect(result.lastUid).toBe(200);
  });
});
