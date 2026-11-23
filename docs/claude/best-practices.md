# Best practices from the 2026-09-04 audit

Distilled rules for trusting a test, a measurement or a document, changing dependencies and automating GitHub.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

Distilled from the 2026-09-04 audit (14 parallel work units, 15 PRs). Each line
below cost something to learn; none of it is generic advice.

### Before you trust a test

1. **Does the test file import the thing it tests?** Six suites here did not —
   they declared the component or endpoint inside the test file. 195 tests,
   green forever, measuring nothing. Deleting them raised coverage.
2. **Mutate the claim.** Revert the fix, confirm RED, restore. Assert the
   anchor string is present AND unique before replacing, or a short anchor
   matches a different site and reads exactly like a surviving mutant.
3. **Make the fixture discriminate.** If both branches produce the same output,
   the fixture is too nice. A polyline fixture must BEND (a straight line hid a
   sign error in the shared band rasteriser through two whole suites). Three
   synthetic fixtures let a `_render_profiles` mutation survive; real kymograph
   rows killed it instantly.
4. **Never assert on wall-clock.** `performance.now()` resolves to a whole
   millisecond under vitest, and measured clean-vs-regressed distributions here
   **overlap** under load — so no threshold exists and tuning one is
   self-deception. Assert the deterministic thing: renders counted, queries
   issued, calls made, work cancelled.
5. **Check what actually runs it.** A suite can be red or unwired for months.
   Before trusting coverage, ask which command reaches the file.

### Before you trust a measurement

6. **Measure both distributions, not just the improved one.** "Faster" without
   a regressed baseline is a story, not a result.
7. **Validate on real production data.** Synthetic fixtures pass because you
   built them to match your assumption. Every performance claim in this batch
   that survived was proven byte-identical on real containers.
8. **A green build proves the build, not the behaviour.** CI here cannot run the
   ML suite at all (no GPU on the runner), the frontend `tsc` is vacuous, and
   backend test files are unlinted.

### Before you trust a document

9. **Re-measure a number before repeating it.** The `transformers` ceiling in
   this repo's own comments was wrong by seven minors, and a brief written from
   it would have shipped a broken ML service.
10. **Rehearse the runbook.** `docs/database-backup.md` documented a restore
    against a database that does not exist, with a glob matching no files. It
    failed twice, and only under an actual incident would anyone find out.

### When changing dependencies

11. `npm ls <pkg>` before removing anything — a direct import may resolve only
    transitively (`qs`, `ioredis`). Grep the BUILD config too (`vite.config.ts`
    `manualChunks`), not just `src/`.
12. Prefer bumping the real parent; reach for `overrides` only when no parent
    admits the patched version, and say why. This repo moved away from
    hand-maintained overrides because they went stale unnoticed.
13. If a bot regenerates the PR you closed, closing it again is a treadmill —
    fix the `ignore` rule.

### When automating against GitHub

14. After a rebase the API still reports the PREVIOUS run's checks; poll on the
    new run, and keep an independent `mergeStateStatus` guard.
15. `UNSTABLE` means required checks passed and something non-required did not.
16. `git branch -r --merged` reports 0 **by construction** in a squash-merge
    repo — it can never be evidence of anything here.

### When you are about to be clever

17. Don't weaken a guard for your own convenience. `allow_auto_merge` is off
    **on purpose**, and `dependabot.yml` documents why.
18. Don't route around a soft-denied command. If a gate blocks you, finish
    everything else and hand over the exact steps.
19. Don't "simplify" code whose docstring carries measured numbers —
    `rasterize_band`, `vicinity_mask` and `focus_qc/metrics.py` are deliberately
    harder to read than the loops they replaced.
