/**
 * AB5 — Bid-log follow-up skill (cron entry point for sys:bid-followups).
 *
 * Runs in the skill-cron process (separate from the API server), so it opens its
 * OWN better-sqlite3 connection at the same DB path. READ-ONLY over CRM data:
 * it computes which bid_sent requests are overdue for follow-up (pure logic in
 * src/autobid/followups.js) and logs them. It NEVER transitions a bid, sends
 * mail, or deletes anything.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { dueFollowups, DEFAULT_FOLLOWUP_DAYS } from '../../autobid/followups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(__dirname, '../../../data/halofire.db');

function openDb() {
  const db = new Database(DB_PATH, { readonly: true });
  return db;
}

function readFollowupDays(db) {
  try {
    const cfg = db.prepare('SELECT followup_days FROM autobid_outbound_config WHERE id = 1').get();
    const n = cfg && Number(cfg.followup_days);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FOLLOWUP_DAYS;
  } catch {
    return DEFAULT_FOLLOWUP_DAYS;
  }
}

function hydrate(row) {
  let history = [];
  if (row.status_history) {
    try {
      const parsed = JSON.parse(row.status_history);
      if (Array.isArray(parsed)) history = parsed;
    } catch { /* corrupt history — treat as empty for follow-up purposes */ }
  }
  return { ...row, status_history: history };
}

export async function checkFollowups(ctx) {
  const log = ctx.log;
  let db;
  try {
    db = openDb();
  } catch (err) {
    log.info(`bid-log: skipped (db unavailable: ${err.message})`);
    return { skipped: 'db-unavailable' };
  }
  try {
    let rows;
    try {
      rows = db.prepare("SELECT * FROM bid_requests WHERE status = 'bid_sent'").all().map(hydrate);
    } catch {
      log.info('bid-log: skipped (CRM tables not present yet)');
      return { skipped: 'no-crm-tables' };
    }
    const days = readFollowupDays(db);
    const due = dueFollowups(rows, { days });
    if (due.length) {
      log.info(`bid-log: ${due.length} bid(s) due for follow-up (> ${days}d in bid_sent): `
        + due.map((d) => `#${d.id} "${d.title}" (${d.daysInStatus}d)`).join('; '));
    } else {
      log.info(`bid-log: no follow-ups due (threshold ${days}d)`);
    }
    return { days, due };
  } finally {
    db.close();
  }
}

export default { checkFollowups };
