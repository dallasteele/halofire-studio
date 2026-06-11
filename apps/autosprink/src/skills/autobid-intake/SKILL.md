---
name: "Auto-bid Email Intake"
description: "Polls the configured company inbox (IMAP, read-only) for incoming bid invitations, classifies them, and files matches into the CRM. Disabled until email settings are configured."
version: "1.0.0"
category: "autobid"
enabled: "true"
triggers: ["intake", "email", "bid", "inbox", "poll"]
dependencies: ["imapflow", "better-sqlite3"]
cron: "*/15 * * * *"
---

# Auto-bid Email Intake Skill (AB2)

Every 15 minutes this skill runs ONE read-only pass over the company INBOX:

1. List messages newer than the last-seen uid.
2. Classify each with the pure W7A heuristics (`src/autobid/bid-classifier.js`).
3. For each likely bid: upsert the client, create a `bid_request`
   (source `email`, status `received`), and file `.pdf/.dwg/.dxf` plan
   attachments as `project_evidence`.
4. Record every uid in `autobid_intake_log` so re-polls never duplicate.

## Fail-closed rules

- **Disabled until configured.** If the IMAP host/port/user/password are not all
  set in Settings, the cron run logs ONE quiet skip line and does nothing.
- **Read-only mailbox.** The adapter opens INBOX `{ readOnly: true }` and never
  deletes, moves, or flags mail. A misclassified email stays recoverable.
- **Credentials only from the settings store** (`autobid_intake_config`) — never
  hardcoded, committed, or logged.
- **No outbound.** Intake never sends anything. The local-qwen judgment layer is
  the AB2.1 follow-up; this slice is heuristics only.

## Actions

### `cronRun` / `poll`
Run one intake poll and persist status (last poll time, messages seen, bids
created, last error) to `autobid_intake_config` for the CRM status strip.
