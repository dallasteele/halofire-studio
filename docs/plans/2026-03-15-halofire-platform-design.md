# HaloFire Platform — Design Document

**Date:** 2026-03-15
**Status:** Draft — Iterating with user
**Visual Diagrams:** `docs/architecture-diagrams.html`

---

## Vision

HaloFire is an AI-driven business automation platform for fire protection companies. It is built from a **reusable template** (the "HAL Pattern") that can be adapted for any small business. The goal: remove human error, progressively automate roles, and make the software so intuitive that it teaches itself to users.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Role automation model | **Hybrid (C)** — fixed roles + automation scores | Structure immediately, builds toward replacement |
| Local AI | **CPU-only default** (Qwen 2.5:3b), optional GPU upgrade | Works anywhere, no hardware requirements |
| Integrations | **Full hub** — all major platforms via settings | Every business uses different tools |
| In-app AI | **Guide agent** — setup wizard + tutorials + chat | Users must be able to self-onboard |
| Web scraping | **Scrapling** (MCP server) | Anti-bot, stealth, supplier catalog scraping |
| Brain | **Obsidian vault** with vector embeddings | Human-readable, semantic search, proven in HAL |
| Database | **SQLite** | Simple, portable, encrypted at rest |
| Frontend | **React** (Next.js or Vite) | Modern, component-based, mobile-first |
| Backend | **Express.js** | Lightweight, proven, matches existing demo |
| Cost model | **Tiered AI** — FREE local + paid Claude escalation | 95% of decisions cost $0 |

## Architecture Overview

### 1. Business Automator Plugin (Claude Code)

A Claude Code plugin with 6 slash commands following the Luke Pierce consulting process:

- `/discover` — Client interview + industry research (Scrapling)
- `/map-workflow` — Department process mapping with diagrams
- `/audit` — Top 10 automation opportunities ranked by ROI
- `/architect` — Full system architecture design
- `/scaffold` — Generate codebase from template
- `/dashboard` — Build live monitoring dashboard

Plugin includes:
- **Tools:** Scrapling MCP, Obsidian Brain, Template Engine
- **Agents:** industry-researcher, process-mapper, code-generator

### 2. Template Software Architecture

Every generated business app follows this stack:

```
Role-Based UIs (Browser/Mobile)
    ↓
AI Guide (setup + tutorials + chat, every screen)
    ↓
React Frontend (role router, shared components)
    ↓
Express API (auth, CRUD, tasks, guide, integrations, brain, analytics)
    ↓
SQLite DB + Obsidian Brain Vault
    ↓
Autonomous Agent Server (Tier 0: Watchdog → Tier 1: Qwen → Tier 2: Claude)
    ↓
Integration Hub (Calendar, Email, Slack, QuickBooks, Twilio, Stripe, etc.)
    ↓
Scrapling Engine (supplier catalogs, competitor pricing, regulatory updates)
```

### 3. Integration Hub

Configurable via settings page. Supported integrations:

- **Calendar:** Google Calendar, Outlook, iCloud, CalDAV
- **Email:** Gmail, Outlook, Yahoo, IMAP/SMTP
- **Messaging:** Slack, Teams, Discord, WhatsApp Business
- **Storage:** Google Drive, OneDrive/SharePoint, Dropbox, Box
- **Accounting:** QuickBooks, Xero, FreshBooks, Wave
- **CRM:** HubSpot, Salesforce, Zoho
- **Phone/SMS:** Twilio, RingCentral, Google Voice
- **Project Mgmt:** Asana, Monday.com, Trello, Basecamp
- **Payments:** Stripe, Square, PayPal
- **Industry-Specific:** Custom per client (AutoSPRINK, Dentrix, etc.)

All flow through a Sync Engine → Unified Inbox → AI auto-creates tasks.

### 4. Tiered AI (HAL Pattern)

- **Tier 0: Watchdog** — Pure rules, FREE. Deadlines, conflicts, sync failures.
- **Tier 1: Qwen** — Local CPU (3b) or GPU (7b), FREE. Cross-checks, form pre-fill, pattern detection, drafts, tutorials.
- **Tier 2: Claude** — API call, PAID, rare. Complex decisions, code changes, monthly reviews.
- **Brain Cache** — Same problem never costs money twice.

### 5. AI Guide (In-App Chat Agent)

Three modes:
1. **Setup Wizard** — Conversational first-time setup per role (~10 min)
2. **Interactive Tutorials** — Role-specific + platform-wide, with spotlight UI
3. **Ongoing Assistant** — Context-aware chat, proactive nudges

Guide learns from every interaction:
- Questions → FAQ patterns
- Tutorial struggles → UI improvement suggestions
- Accepted/rejected nudges → personalization
- All stored in Brain `06-Patterns/`

### 6. Learn & Replace Loop

1. Behavior Logger records every user action with context
2. Pattern Detector (Qwen, weekly) identifies automatable patterns
3. Guide surfaces automation proposals to users
4. Approved → automation score +%, task auto-handled
5. Denied → brain stores preference, never suggests again
6. Score > 75% → Owner alert: role can be reduced/reassigned

### 7. Security (Non-Negotiable)

- **Auth:** JWT + bcrypt + RBAC per role
- **Cross-Check:** Every human action validated against rules
- **Data:** SQLite encrypted, HTTPS only, no PII in logs, auto-backups
- **AI Safety:** Local Qwen (data stays on-site), Claude anonymized, all decisions auditable
- **Audit Trail:** Immutable, every action logged (who/what/when/where/why)

---

## HaloFire-Specific Application

### Roles
- Owner/Principal
- Estimator
- Project Manager
- Foreman/Field Supervisor
- Service Coordinator/Dispatcher
- Office Admin

### Industry Modules
- Bid management + AI-powered estimating
- Project lifecycle (Design → Fabrication → Installation → Testing → Closeout)
- Pricebook management (live from ARGCO, FFF, Victaulic via Scrapling)
- NFPA compliance tracking
- Multi-state contractor license management
- Service agreement lifecycle
- Deficiency → repair proposal pipeline (automated revenue engine)
- Inspection scheduling + route optimization

### Top 10 Automation Opportunities (by ROI)
1. Pricebook auto-update from supplier catalogs (95% auto, LOW complexity)
2. Deficiency → repair proposal pipeline (85% auto, MED complexity)
3. Inspection scheduling + route optimization (90% auto, LOW complexity)
4. Bid pre-fill from plans + historical pricing (60% auto, HIGH complexity)
5. Multi-state license renewal tracking (80% auto, LOW complexity)
6. Invoice generation on job completion (90% auto, LOW complexity)
7. Email triage + auto-draft responses (70% auto, MED complexity)
8. Material ordering from design takeoff (75% auto, MED complexity)
9. Progress photo → daily report generation (65% auto, MED complexity)
10. NFPA code compliance check on designs (50% auto, HIGH complexity)

---

## Company Research: Halo Fire Protection

- **Full name:** Halo Fire Protection, LLC
- **HQ:** 4811 E. Julep Street Suite 124, Mesa, AZ 85205
- **Founded:** 2007 by Daniel Farnsworth and Nathan Boyd
- **Scale:** 612 permitted projects, $41.8M in building permit value
- **Reach:** Licensed in 30 states, 200+ out-of-state projects
- **Services:** Sprinkler design/install/inspect, fire alarm, hood systems, extinguishers, paint booths
- **Contact:** info@halofireus.com, (480) 325-2280
- **Website:** halofireus.com

---

## Next Steps

1. Approve this design
2. Build the Business Automator plugin for Claude Code
3. Use `/discover` and `/scaffold` to generate the HaloFire codebase
4. Iterate on role UIs with real user feedback
