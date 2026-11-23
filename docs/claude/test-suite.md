# Test suite reality

Which suites are green, flaky, red or unwired, how to run them, mutation testing and timing assertions.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

Measured 2026-09-04 after a 15-PR audit that rewrote most of this section; the
counts in the table were re-measured 2026-10-06. The
headline number is not the interesting part — **the interesting part is that a
suite can be green, red, or wired to nothing, and this repo has all three.**

### 1. Green and actually run

| Suite                   | State                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Vitest (frontend)       | **5424 pass**, 295 files, **~117 s** (re-measured 2026-10-06). `npx vitest run`.                                                    |
| Vitest (backend)        | **4443 pass / 6 skipped**, 222 files, ~35 s. Not Jest. Must run in the container — see **Backend tests** below.                     |
| Python (`make test-py`) | **731 pass / 3 skipped**. Step 7 of `make ci`; pytest is NOT in the ml image, `make ci` pip-installs it into a throwaway container. |

The old "400 pass / 401" figure was wrong, not stale: `make test-py` ran three
of the four paths CI runs and silently omitted the 112 `focus_qc` tests.

### 2. Flaky under load — and the blame MOVES

Until 2026-09-04 the frontend suite was clean on roughly **2 runs in 5** on a
busy machine, and the file it blamed changed every time (`ThemeContext`,
`ProtectedRoute`, `CanvasImage`, `SegmentationEditor.orchestration`). That is
the signature to recognise: **a leaked timer poisons whichever file the
scheduler runs next, so the victim is random and the cause is not.**

Root cause was a 500 ms `setTimeout` in a `SegmentationEditor.tsx` `useEffect`
that returned **no cleanup at all**, firing after unmount. The existing abort
signal could not have covered it — the timer is scheduled _after an await_, so
a fast unmount tears the effect down before the handle exists. Fixed, with two
more of identical shape (`ProjectDetail.tsx`, `useEnhancedSegmentationEditor.tsx`);
5/5 clean runs after. **If flakiness returns, look for an uncleaned timer
before you look at the test that failed.** Unfixed leaks of this shape are
listed in PR #484 — `ShareAccept.tsx:103` is the live one.

### 3. Red, or wired to nothing — the category nobody was tracking

This is where the real risk was, and none of it showed up as a failure:

- **`make test-e2e` does not run at all** (no `docker-compose.yml`), and 55 of
  its 71 testids no longer exist in `src/`. Last touched 2026-05-12.
- **`backend/src/test/integration/**`** — 3 798 lines, excluded from vitest,
  and its jest runner collects **zero** tests.
- **`make test-ml` was RED on `main`** and nothing ran it. Same for
  `backend/segmentation/models/microtubule/tests` — the instancer's real
  identity proofs, collected by **nothing**. Both now wired up; `make test-ml`
  is 670 pass / 1 skip / 11 errors (the 11 are documented async-fixture errors).
  **2026-11-05:** 759 pass / 2 skip. It had gone red again unnoticed (two
  assertions older than the code they checked) and hung after its summary:
  `test_inference_timeout` left an executor worker blocked, and
  `concurrent.futures` joins every worker at interpreter exit.
- **GitHub CI cannot run the ML suite at all**: the runner has no GPU, so
  `import api.main` dies in `mamba_ssm` -> Triton -> "0 active drivers". See the
  comment above the "Python files parse" step in `ci.yml`.
- The backend coverage gate is **global**, with ~2 points of branch headroom —
  an entirely untested new module can hide behind it.

**So a green suite is a real gate for the code it covers, and says nothing
whatsoever about the code it does not.** It is still not a substitute for
[Verification](../../CLAUDE.md#verification-rules), and 2026-09-04 gave four fresh
demonstrations:

- A localisation fix shipped with green tests, a green `make ci` and green CI —
  and one of six upload phases still rendered English, found only by a real
  300-frame upload in a browser with the locale set.
- A membrane tracer was diagnosed against the _mean_ radial profile, which
  peaked at the right radius while the per-ray maximum — the thing the code
  actually uses — pointed 10 px elsewhere.
- Two mutations survived a fully green new test file, and they were the two the
  whole change rested on. See [Mutation testing](#mutation-testing) below.
- A test named _"should handle points with Infinity coordinates"_ passed for
  months while `CanvasPolygon` emitted `d="MInfinity,10 ..."`, silently erasing
  the polygon — because `isNaN(Infinity)` is `false`. Use `Number.isFinite`.

### Backend tests need the container

Canvas ABI: host Node 22 vs container 20.

```bash
docker run --rm --user root --entrypoint /bin/sh \
  -v $PWD/backend:/app -v /app/node_modules -w /app \
  cell-segmentation-hub-backend -c "npx vitest run <path>"
```

`--user root` is needed to read `.env`; `-v /app/node_modules` keeps the image's
modules instead of the host's. Bind-mounting the whole `backend` dir is what
makes it test the WORKING TREE rather than the image's baked copy — the image
bakes `src`, so without the mount you are testing whatever was last built.

### Mutation testing

**Revert the fix, confirm the test goes red, restore.** A test that passes with
the fix removed is not evidence. This is not optional and it repeatedly earns
its keep: on 2026-09-04 it caught, in one session, a test asserting only on
state while the whole change was about rendered output, a test whose fixture
could not distinguish the two branches, and an "invariant" test that passed
against a deliberately quadratic implementation.

Two rules learned the hard way:

- **Verify the mutation actually applied.** Assert the anchor string is present
  AND unique before replacing; a short anchor can match a different site (a
  10-space indent is a substring of a 12-space one) and the result reads
  exactly like a surviving mutant.
- **A survived mutation means the test is too weak, not that the mutation is
  equivalent.** Strengthen it until it fails, or delete the claim.

### When to write tests

- **Pure utility function with a deterministic contract** → unit test. See `instanceColors.test.ts` for the pattern.
- **Regression fix for a real production bug** → write a test that fails before the fix and passes after. The bug provided the spec; encode it.
- **Cross-frame / cross-layer invariant** → integration test with mocked layer boundaries (see `test_rdp_preserves_embedding_alignment` for the pattern).

### Timing assertions: check the clock before you trust the number

**`performance.now()` resolves to a whole MILLISECOND under vitest/jsdom.**
Measured 2026-09-04: over 2000 consecutive samples the only distinct delta is
exactly `1`. Bare node in the same shell resolves microseconds, so this is the
environment, not the machine.

So any assertion built on a duration under ~10 ms is measuring the tick
boundary. A ratio of two such durations is built from small integers — 1 ms vs
4 ms is _exactly_ 0.5 — which is how `cancel-performance.test.ts` produced
`expected 0.5 to be greater than 0.5` at roughly 1 run in 6 under load.

**Repeating the work for a time budget fixes the resolution, and often reveals
that the test could never have worked.** On that same file, with each volume
repeated to 25 ms, a genuinely `O(n²)` implementation still passed: per-op cost
is dominated by fixed per-pass overhead and _falls_ as volume rises. An
absolute ceiling failed too — under a 10-core load clean runs span 3.5–62.5
µs/op and a 2000×-work regression spans 6.1–320 µs/op, so the distributions
**overlap** and no threshold exists.

Before defending any timing threshold, **measure both distributions — clean and
deliberately regressed — under realistic load.** If they overlap, tuning the
number is self-deception; drop the timing claim and assert the deterministic
behaviour instead (every operation actually cancelled, nothing left behind, the
thing terminates). Loosening a flaky threshold only moves the coin flip.

Also: a "performance" test driving a `vi.fn()` mock from the test helpers is not
measuring production code, so its speed was never going to inform anything.

### When NOT to write tests

- Shallow render tests that just confirm a component mounts — these are noise. They pass even when the feature is broken.
- Tests against modules with broken imports — fix the import chain first.
- Tests requiring infrastructure not gated on availability (e.g. ML model loaded) — guard with `pytest.importorskip` / `vi.skipIf`.
- Padding existing suites to hit a coverage number.

### Tests are not a substitute for verification

Even if every test passes, **you still must Playwright-verify the user-facing change**. Tests prove "this assertion held under this scenario"; verification proves "the feature works in a real browser against real services". They are complementary, not interchangeable.

---
