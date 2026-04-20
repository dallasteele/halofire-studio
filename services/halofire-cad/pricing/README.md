# `pricing/` — live supply DB + catalog sync

Misquoting a supply price is one of the top reasons a fire-sprinkler
bid loses money. This package is the source of truth for every part
Halo buys and the price they paid this week.

## Why DuckDB

Open-source (MIT), embedded, columnar, SQL. Reads + writes Excel
(`.xlsx`), CSV, Parquet, and JSON natively. A single file on disk
(`supplies.duckdb`) you can open from Excel, Python, Node, or the
DuckDB CLI — no server, no daemon.

## File layout

```
pricing/
  ├── README.md           ← this file
  ├── schema.sql          ← table definitions (idempotent)
  ├── db.py               ← Python API (open, query, upsert, export)
  ├── seed.py             ← import the @halofire/catalog manifest
  ├── sync_agent.py       ← LLM-driven price-update agent (Ollama)
  ├── supplies.duckdb     ← the live DB (gitignored)
  └── exports/
      └── supplies_YYYY-MM-DD.xlsx  ← auto-dumped snapshots
```

## Schema (see `schema.sql`)

Four tables:

| table | purpose |
|---|---|
| `parts` | one row per SKU — category, manufacturer, model, nominal dims, NFPA metadata |
| `prices` | append-only: every price observation with `observed_at`, `source`, `unit_cost_usd`, `currency` |
| `suppliers` | manufacturer + distributor directory (name, website, price-sheet URL, scrape strategy) |
| `sync_runs` | every catalog-sync attempt: when, source, parts affected, SHA of source doc |

Prices are append-only so the BOM agent can pull "price on this
date" for historical bids. The view `latest_prices` returns the
most-recent observation per SKU; that's what BOM queries.

## BOM integration contract

The BOM agent MUST:

1. Call `db.price_for(sku, as_of=today)` for every line item.
2. If `price_for` returns `None` or a value older than 60 days,
   flag the line with `price_stale` and propagate the flag up into
   `violations.json` so the proposal renders a clear warning.
3. Never hard-code prices in Python. If a SKU has no price in the
   DB, the bid is invalid — that's the point.

## Sync agent contract

`sync_agent.py` drives the local LLM (Ollama Qwen) against a
manufacturer source document (PDF, HTML, CSV) and emits typed
`PriceUpdate` records. It never writes to the DB directly — it
produces a JSON patch that `db.apply_updates()` validates and
commits. Every run lands a row in `sync_runs` so you can always
answer "where did this price come from?"

See `sync_agent.py` docstring for the exact contract + prompting
strategy. The agent is designed to run on a cron / Windows Task
Scheduler schedule (default: weekly).

## Windows / VPS parity

Same DuckDB file format everywhere. Ship `supplies.duckdb` to the
VPS alongside deliverables and Halo can read + edit it in Excel on
their own workstations.
