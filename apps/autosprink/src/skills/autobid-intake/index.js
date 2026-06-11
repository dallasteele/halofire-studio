/**
 * AB2 — Auto-bid Email Intake skill (cron entry point).
 *
 * Runs as part of the skill-cron scheduler (a separate process from the API
 * server), so it opens its OWN better-sqlite3 connection at the same DB path the
 * server uses and runs one read-only intake poll.
 *
 * DISABLED-UNLESS-CONFIGURED: when the IMAP host/port/user/password are not all
 * present in autobid_intake_config, the run logs ONE quiet skip line and exits
 * without touching the mailbox or the DB.
 *
 * READ-ONLY + credentials-from-settings-only + no outbound — see SKILL.md.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { pollOnce as runIntakePoll } from '../../autobid/intake.js';
import { createImapMailbox } from '../../autobid/imap-transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(__dirname, '../../../data/halofire.db');

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function readConfig(db) {
  // The table is created by the API server's initDatabase; tolerate its absence
  // (server never started yet) by treating intake as unconfigured.
  try {
    return db.prepare('SELECT * FROM autobid_intake_config WHERE id = 1').get() || null;
  } catch {
    return null;
  }
}

function configured(cfg) {
  return Boolean(cfg && cfg.host && cfg.port && cfg.username && cfg.password);
}

// Re-baseline the watermark + uid-keyed dedup log when the mailbox epoch changes
// (server-side UIDVALIDITY reset). Tolerant of older DBs missing the columns.
function resetIntakeBaseline(db, { host, username, uidvalidity = null }) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM autobid_intake_log').run();
    db.prepare(`UPDATE autobid_intake_config
                SET last_uid = 0, uidvalidity = ?, mbox_host = ?, mbox_username = ?,
                    last_messages_seen = NULL, last_bids_created = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1`)
      .run(uidvalidity, host || null, username || null);
  });
  tx();
}

/**
 * pollAndPersist(db, cfg, { logger, force }) -> result | { skipped }
 * Shared by cronRun and the ad-hoc `poll` action.
 */
async function pollAndPersist(db, cfg, { logger, force = false }) {
  const nowIso = new Date().toISOString();
  let mailbox = null;
  try {
    mailbox = await createImapMailbox(
      { host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password },
      { logger },
    );
    await mailbox.connect();

    let sinceUid = cfg.last_uid || 0;
    const liveUidValidity = mailbox.uidValidity != null ? String(mailbox.uidValidity) : null;
    if (liveUidValidity && cfg.uidvalidity && String(cfg.uidvalidity) !== liveUidValidity) {
      logger.warn(`intake: UIDVALIDITY changed (${cfg.uidvalidity} -> ${liveUidValidity}); re-baselining intake`);
      resetIntakeBaseline(db, { host: cfg.host, username: cfg.username, uidvalidity: liveUidValidity });
      sinceUid = 0;
    } else if (liveUidValidity && !cfg.uidvalidity) {
      db.prepare('UPDATE autobid_intake_config SET uidvalidity = ?, mbox_host = ?, mbox_username = ? WHERE id = 1')
        .run(liveUidValidity, cfg.host || null, cfg.username || null);
    }

    const result = await runIntakePoll(db, mailbox, { sinceUid, nowIso, logger });
    db.prepare(`UPDATE autobid_intake_config
                SET last_poll_at = ?, last_messages_seen = ?, last_bids_created = ?, last_uid = ?,
                    last_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1`)
      .run(
        result.pollFinishedAt || nowIso,
        result.messagesSeen,
        result.bidsCreated,
        result.lastUid,
        result.errors.length ? JSON.stringify(result.errors.slice(0, 5)) : null,
      );
    return result;
  } catch (err) {
    db.prepare(`UPDATE autobid_intake_config
                SET last_poll_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1`)
      .run(nowIso, String(err.message).slice(0, 500));
    return { error: err.message };
  } finally {
    if (mailbox) { try { await mailbox.close(); } catch { /* best-effort */ } }
  }
}

export async function poll(ctx) {
  const log = ctx.log;
  const force = Boolean(ctx.params?.force);
  const db = openDb();
  try {
    const cfg = readConfig(db);
    if (!configured(cfg)) {
      // ONE quiet skip line — never noisy when unconfigured.
      log.info('intake: skipped (email settings not configured)');
      return { skipped: 'unconfigured' };
    }
    if (!force && !cfg.enabled) {
      log.info('intake: skipped (intake disabled in settings)');
      return { skipped: 'disabled' };
    }
    return await pollAndPersist(db, cfg, { logger: log, force });
  } finally {
    db.close();
  }
}

// Cron handler — identical to the manual poll.
export async function cronRun(ctx) {
  return poll(ctx);
}

export default { poll, cronRun };
