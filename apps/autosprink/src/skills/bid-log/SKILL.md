---
name: bid-log
description: Bid follow-up reminders — flags bid_sent requests that have gone quiet past the follow-up threshold.
version: 1.0.0
category: autobid
cron: 0 * * * *
enabled: true
---

# Bid-log follow-up skill (AB5 tracking)

This skill backs the `sys:bid-followups` cron job. Hourly it scans
`bid_requests` for records in `bid_sent` that have been there longer than the
configured follow-up threshold (`autobid_outbound_config.followup_days`,
default 5) and records which are due for a follow-up.

It is READ-ONLY over the CRM data: it never transitions a bid, never sends mail,
and never deletes anything. Follow-up due-ness is computed by the pure
`src/autobid/followups.js` module (`dueFollowups`). The result is surfaced for
the operator on the CRM board (badge on bid_sent cards via
`GET /api/bid-requests/followups`) and logged here so a cron run leaves evidence.

Fail-closed: if the CRM tables do not exist yet (server never started), the run
logs one quiet line and exits.
