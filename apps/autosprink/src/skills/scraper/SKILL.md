---
name: "UI Template Scraper"
description: "Scrapes professional UI/UX templates from ThemeForest and similar marketplaces using Scrapling"
version: "1.0.0"
category: "tools"
enabled: "true"
triggers: ["scrape", "template", "ui", "theme", "design", "themeforest", "layout"]
dependencies: ["scrapling"]
cron: ""
---

# UI Template Scraper Skill

Discovers and catalogs professional UI/UX dashboard templates from template
marketplaces (ThemeForest, etc.) using the Scrapling adaptive web scraping framework.

## Actions

### `search`
Search for templates matching criteria (category, framework, price range, rating).

### `preview`
Fetch detailed info about a specific template (screenshots, features, tech stack).

### `catalog`
Build a local catalog of top-rated templates with metadata for Qwen AI to recommend.

### `compare`
Side-by-side comparison of template candidates.

## Scrapling Integration
- Uses `StealthyFetcher` for anti-bot bypass (Cloudflare, etc.)
- Adaptive element tracking with `auto_save=True` / `auto_match=True`
- Session management for paginated results
- Rate-limited to respect marketplace ToS
