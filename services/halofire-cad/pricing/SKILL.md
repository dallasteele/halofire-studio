---
name: halofire-catalog-sync
description: Local-LLM agent that pulls manufacturer price sheets into the HaloFire supplies DB. Runs on a schedule — bids use its output.
---

# halofire-catalog-sync skill

## When to invoke

- On a weekly cron / Task Scheduler trigger
- Manually when a supplier publishes a new price list
- Oracle loop flags `stale_skus > 50` → escalate to this skill

## Inputs

| input | meaning |
|---|---|
| `--supplier <id>` | Row in `suppliers` table (victaulic, viking, tyco, …) |
| `--source <path>` | PDF / HTML / CSV / XLSX the supplier just published |
| `--source-url <url>` | (optional) canonical URL the file came from — logged in sync_runs |
| `--model <tag>` | Override local LLM (default `qwen2.5:7b` via Ollama) |
| `--dry-run` | Parse + print proposed updates; don't commit |

## Outputs

- Rows inserted into `prices` (append-only; old rows preserved)
- Row in `sync_runs` with source hash, LLM model, counts, status
- `stdout` JSON: `{"accepted": n, "errors": [...], "run_id": N}`

## Contract

1. **Never write to the DB directly.** Produce `PriceUpdate`
   records, call `db.apply_updates` — it validates unit + SKU
   existence + confidence range.
2. **Every price has a source hash.** `sha256(source_doc)` lands
   on every row so "where did this number come from?" is always
   answerable.
3. **Unknown SKUs are skipped, not invented.** If the LLM emits a
   SKU not in `parts`, `apply_updates` rejects it loudly — the
   operator must author the part first.
4. **Confidence < 0.7** means the LLM was unsure; the BOM agent
   surfaces these as `price_low_confidence` violations.
5. **One run = one source.** Don't batch multiple supplier PDFs
   into a single run — audit trail breaks.

## Escalation

If a run fails:

- `status='failed'` in `sync_runs` with the exception message
- Oracle loop picks it up on the next cycle and emits
  `SYNC_FAILED <supplier>` to HAL chat-bridge
- Operator gets the source PDF + error to fix manually

## Tests

```
bun test ./packages/halofire-catalog/tests/catalog.test.ts
pytest services/halofire-cad/tests/unit/test_pricing_db.py
pytest services/halofire-cad/tests/unit/test_sync_agent.py
```

Smoke test covers: DB round-trip, freshness detection, stale view,
Excel export, CSV sync (deterministic path, no LLM), run logging.

## Scheduling recipe (Windows)

```powershell
# Weekly, Monday 02:00
$A = New-ScheduledTaskAction -Execute "C:\Python312\python.exe" `
  -Argument "E:\ClaudeBot\halofire-studio\services\halofire-cad\pricing\sync_agent.py --supplier victaulic --source E:\halofire\pricesheets\victaulic-latest.pdf"
$T = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 02:00
Register-ScheduledTask -TaskName "HaloFire-SyncVictaulic" -Action $A -Trigger $T
```
