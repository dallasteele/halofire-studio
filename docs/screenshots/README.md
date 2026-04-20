# Screenshots of the HaloFire Studio demo

**Auto-Design → viewport populated — 2026-04-20**

The user's explicit blocker from CODEX_REVIEW.md was that they
hadn't seen the full Auto-Design → live 3-D viewport handoff.
Ship-ready evidence:

1. Dev server up:   `http://localhost:3002/` (Next 16 / bun dev).
2. Gateway up:      `http://localhost:18080/health` → `{ok:true}`.
3. Click **Auto-Design** sidebar tab → pick **1881 Cooperative —
   full architectural set** preset → click **Run Auto-Design**.
4. Panel shows live status (`queued` → `running` → `completed`,
   percent polled every 2.5 s).
5. On `completed`, `renderResults(projectId)` fires, loads
   `design.json` from the gateway, walks Pascal's scene store for
   the first `level` node, clears any prior `auto_design`-tagged
   items, and spawns slabs + heads + pipes parented to Level 0.
6. **Viewport shows the system in Level 0** — visible as NFPA-
   colored pipe lines + red head dots.

For demo / reviewer workflows, a secondary **Render last bid**
button on the panel reads the last on-disk `design.json` straight
into the scene without re-running the ~3-minute pipeline.

### Why the full-architectural run is slow

The 173 MB / 110-page architectural PDF runs through CubiCasa5k
on every page. That's ~30 s/page on CPU (~30 min total) for a
first-pass intake. Subsequent runs hit the cached inspection and
finish in ~3 min. This is a known Alpha trade-off flagged in
CODEX_REVIEW.md; a caching pass is queued for the next loop.

### Regression evidence at this screenshot

```
py unit  304 passed in 14.28s
bun test  92 passed, 749 expects
smoke    SMOKE: PASS (20/20 GLBs + CDN pin)
halofire-only typecheck: clean (tsc exit 0)
```
