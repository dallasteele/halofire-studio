# PRIORITIES — the single steering file for ALL loops

> Every automation reads this each cycle: Claude's wakeup loop, the GX10
> build-loop wave seeding, and HAL's self-improve cron (via `loopctl report`).
> When the user gives new direction, THIS file is updated first — loops re-aim
> without losing context. Updated: 2026-06-11.

## North star (the product)
An AI-run AUTO-BID system for Halo Fire: scrape company email → identify bid
invitations → import (PDF-FIRST; DWG is luck) → estimate via the AutoSprink-
clone CAD engine → branded HTML bid → human-approved outbound email → CRM
tracking. Full program: auto-bid-program.md.

## Priority queue (descending)
0. **PARTS PIPELINE + UN-GATE (NEW TOP PRIORITY, user 2026-06-11):** a
   non-human loop scrapes manufacturer cut sheets for ALL 155 catalog parts →
   generates a CAD model for each (parametric OpenSCAD via the Wave 13
   emitters; SAM/vision on cut-sheet images where needed) → every part lands
   with `verificationStatus: 'needs-verification'` + a note, NEVER proxy/
   blocked. Then RE-WIRE the Settings "Parity" surface from a hard-blocked
   gate into a **verification ledger** (N machine-generated / M human-verified
   / coverage %), and apply the same flag-don't-gate pattern system-wide
   (AHJ/PE/manufacturer become flags). Goal: 155/155 usable flagged models,
   0 blocked. Wave 14.
1. ~~AB1+AB2~~ SHIPPED 2026-06-11: AB1 CRM (646a3d4, 787/787), AB2 intake
   (7aed36a, 840/840 — read-only IMAP, spec-exact W7A classifier, fail-closed)
2. ~~AB3-5~~ SHIPPED 2026-06-11 (0973420, 902/902): estimate wiring (CAD
   payload or manual, labeled price provenance — estimated prices surface on
   the bid/board/approval), W7B HTML renderer, outbound DRAFTS with
   per-message admin approval (no auto-send path; mock seam refuses prod
   boot; /data static hole closed — DB no longer downloadable), follow-ups +
   won/lost. **AUTO-BID PIPELINE v1 IS END-TO-END.** Next: operator pilot —
   Halo Fire configures mailbox+SMTP in Settings and runs real ITBs through.
3. **PDF-first assist** — vector linework extraction w/ stroke widths feeding
   the W5B scorer; scale pre-fill (W8A) + sheet triage (W8B) integration
4. **CAD fidelity debts (user-flagged):** junction orientation close-range
   verification + fixes; hangers (W6A) + ceiling grids (W6B) rendering;
   1881-kernel hydraulic solvability — imported pipe-mats have no riser/demand
   topology so the fluid heat map stays dark on 1881 (needs riser inference);
   DONE 2026-06-11: inspector part viewer (6bd2e4a) + flow gradients (87fc40a,
   preview-verified 154/154 gradient segments on the sample project)
5. **Parts pipeline** — UNBLOCKED 2026-06-11: OpenSCAD 2021.01 installed on
   GX10 (/usr/bin/openscad) + Windows dev box; docs at
   docs/research/openscad-parts-pipeline.md. Wave 13 = parametric .scad
   emitters + headless STL render harness so the nominal-fallback count
   (126/155) drops with honest dimensioned-parametric provenance
6. **W9 building extraction** — assisted walls/doors from PDF sheets (the
   long pole; W5B/W8A/W8B are its bricks). SAM raster lane UNBLOCKED
   2026-06-11: hal-sam3 on GX10 now runs geometric prompts on the GB10 GPU
   (torch cu129→cu130 sm_120 kernels; was silently CPU-fallback) — OpenClaw
   sam3 MCP fronts it for scanned-PDF segmentation proposals.

## DOCTRINE — build-complete, flag-don't-gate (user, 2026-06-11, OVERRIDES prior fail-closed)
The system must be **built out completely and be fully usable end to end.**
Where real/verified data is missing, a NON-HUMAN loop machine-generates the
best-effort version (scrape cut sheets → generate CAD models → fill dims/specs)
and gets it as close to correct as it can. EVERY machine-made or unverified
element carries a `verificationStatus: 'needs-verification'` flag with a note
on what to check — but is **NEVER gated, blocked, hidden, or deferred.** Humans
use the whole thing and see plainly what is machine-generated vs human-verified.
- Honesty = truthful LABELING, not withholding. Fabricated/best-effort content
  is allowed AS LONG AS it is flagged needs-verification. The ONE thing still
  never done: claiming something IS verified / PE-stamped / manufacturer-exact
  when it is not. AHJ/PE/manufacturer status becomes a prominent flag, NOT a
  blocking gate.
- A human can flip any flag to `human-verified` (with who/when). Nothing waits
  on that flip to be usable.

## Standing constraints (never violated)
- PDF-first; DWG never required.
- Outbound email still needs per-message human approval; mailbox stays
  read-only. (These are the only true gates — everything else flags, not gates.)
- TOKEN CONSERVATION (user, 2026-06-11): the GX10 loop does ALL build work —
  pure modules AND UI integration (Wave 10+ proves it). Claude is harvest +
  audit + backlog-seeding ONLY; no cloud implementation workflows unless the
  ladder has failed a task twice AND it blocks the queue head. Ladder:
  qwen → Gemma QAT → Kimi.
- All 3D work passes the scene-invariants gate + numeric verification.
- New user direction → update THIS file + seed/adjust waves in the same turn.
