# Learning loop — how improvement moves

Short version of how each fix must be shipped. Paired with
`SELF_TRAIN_PLAN.md` and enforced by the cruel-test suite in
`services/halofire-cad/tests/golden/test_cruel_vs_truth.py`.

## Rules

1. **Start every PR by running the delta report.** Capture the
   pre-patch deltas verbatim in the PR description.

   ```bash
   python services/halofire-cad/tests/delta_report.py
   ```

2. **Pick the biggest FAIL.** That's where the next commit goes.
   If multiple metrics fail, attack the one with the largest
   cascade downstream. Head count cascades into pipe count, labor,
   and bid total — fix it first.

3. **Ship the minimum change that moves the delta.** Don't bundle
   unrelated cleanup. Don't add tests that aren't graded against
   truth. Don't rename modules.

4. **Re-run the delta report.** Paste the post-patch numbers into
   the PR description *in the same format*. This is how the
   ratchet is enforced: every PR that makes a delta WORSE gets
   reverted.

5. **If your patch fixes one metric but breaks another**, either:
   - fix both in the same PR (honest, fast), or
   - revert the original fix + open a bug for the tradeoff
     (honest, slow).

   Never ship "the head count is fixed but the bid is now wrong"
   and declare victory.

## Example — Phase 5 (2026-04-20, this session)

| metric | pre-patch | iter 1 (cap=300) | iter 2 (cap=150) | iter 3 (cap=40 + floor-fallback) |
|---|---|---|---|---|
| head_count | 583 (55% under) | 2589 (99% over) | 2446 (88% over) | **1396 (7% over) ✓** |

Three iterations in one session. The winning combination was
`per_room_cap=40` + new `place_heads_for_level_floor` — not the
obvious "raise the cap." The delta report exposed each
intermediate failure in concrete numbers.

Commit message recorded all three attempts so the next engineer
sees the search that produced the answer (`bea0468`).

## Anti-patterns to call out

- **Shipping a synthetic `design.json`** so the Studio viewport
  "looks right" in a screenshot. Caught in `test_cruel_vs_truth`
  by the synthetic-24-head tripwire.
- **Loosening a cruel-test tolerance** to make it pass. The
  tolerance column in every cruel test is defended — 15% is a
  hard bid-accuracy gate, not a negotiation point.
- **Adding chrome when the engine is broken.** LayerPanel /
  CommandPalette / Ribbon all dispatch events nothing consumes
  yet. Fixing the placer is more valuable than another menu.
- **Marking a test PASS when it SKIPS.** Skipped != passed.
  Delta report shows `skipped — truth is None (Phase 1b)` exactly
  so skips aren't confused with green.

## Cadence

Per iteration (usually a day or two):

1. Pick biggest delta from last report.
2. One or two source files change.
3. Re-run pipeline end-to-end.
4. Re-run delta_report.
5. Commit + paste numbers.
6. Persist to Brain with `POST /brain/wiki/remember`.
7. Repeat.

No more than ONE iteration per PR. Each delta should move by at
least 20 percentage points OR reveal an upstream bug (which becomes
the next iteration's target).

## How "Internal Beta" is reached

All six cruel metrics within tolerance on 1881 for THREE
consecutive pipeline runs. No metric PASSES on average but fails
on a particular re-run — the suite must be stable green before
the label moves.

After Internal Beta: Wade PE review. Each red-line becomes a new
row in `bids_corrections` AND a new failing regression test. The
loop continues with Wade's truth instead of just 1881's numbers.
