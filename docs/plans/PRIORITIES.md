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
5. **Parts pipeline** — manufacturer connectors + image/dims→3D so the
   nominal-fallback count (126/155) drops toward zero
6. **W9 building extraction** — assisted walls/doors from PDF sheets (the
   long pole; W5B/W8A/W8B are its bricks)

## Standing constraints (never violated)
- PDF-first; DWG never required.
- Fail-closed honesty: design-aid disclaimers, no AHJ/PE/parity claims, no
  outbound email without human approval, nothing fabricated.
- Local models do volume (qwen → Gemma QAT → Kimi ladder); cloud only for
  integration/audit the ladder can't do.
- All 3D work passes the scene-invariants gate + numeric verification.
- New user direction → update THIS file + seed/adjust waves in the same turn.
