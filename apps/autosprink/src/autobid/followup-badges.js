/**
 * Follow-up badges for the CRM board (W12A).
 *
 * Pure helpers: flag bid_sent bids by how long they have been waiting, so the
 * board surfaces which proposals need a nudge. Days are whole days since the
 * last status_history entry. Bids not in 'bid_sent' carry no badge.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RANK = { overdue: 0, due: 1, ok: 2, none: 3 };

function lastHistoryIso(bid) {
  if (!bid || typeof bid !== 'object' || !Array.isArray(bid.status_history)) {
    throw new TypeError('badgeForBid: bid.status_history must be an array');
  }
  const last = bid.status_history[bid.status_history.length - 1];
  if (!last || typeof last.atIso !== 'string') {
    throw new TypeError('badgeForBid: last status_history entry needs an atIso string');
  }
  return last.atIso;
}

/**
 * Returns { daysOut, level } for a bid_sent bid, else null.
 * level: 'overdue' (>= 2*threshold), 'due' (>= threshold), 'ok' (< threshold).
 */
export function badgeForBid(bid, nowIso, thresholdDays) {
  if (typeof nowIso !== 'string' || nowIso.trim() === '') {
    throw new TypeError('badgeForBid: nowIso is required');
  }
  if (!bid || typeof bid !== 'object') {
    throw new TypeError('badgeForBid: bid is required');
  }
  if (bid.status !== 'bid_sent') return null;

  const sinceMs = Date.parse(lastHistoryIso(bid));
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(sinceMs) || Number.isNaN(nowMs)) {
    throw new TypeError('badgeForBid: invalid date');
  }
  const daysOut = Math.floor((nowMs - sinceMs) / MS_PER_DAY);
  let level = 'ok';
  if (daysOut >= 2 * thresholdDays) level = 'overdue';
  else if (daysOut >= thresholdDays) level = 'due';
  return { daysOut, level };
}

/**
 * Returns a NEW array sorted overdue > due > ok > non-bid_sent, ties broken by
 * daysOut descending. Pure — the input array is not mutated.
 */
export function sortByUrgency(bids, nowIso, thresholdDays) {
  return [...bids]
    .map((bid) => ({ bid, badge: badgeForBid(bid, nowIso, thresholdDays) }))
    .sort((a, b) => {
      const ra = a.badge ? RANK[a.badge.level] : RANK.none;
      const rb = b.badge ? RANK[b.badge.level] : RANK.none;
      if (ra !== rb) return ra - rb;
      const da = a.badge ? a.badge.daysOut : -Infinity;
      const db = b.badge ? b.badge.daysOut : -Infinity;
      return db - da;
    })
    .map((x) => x.bid);
}
