# Testing guide

What each suite covers, what state it is actually in, and when writing a test is
worth it.

> **Treat the test suite as partially broken.** A green run proves less here
> than you would like. This page states the honest position rather than the
> aspirational one.

---

## The suites

| Suite                        | Command                   | State                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vitest** (frontend unit)   | `make ci-test`            | Substantial pre-existing failures from earlier refactors — WebSocket manager, ND2 helpers, legacy editor tests. Healthy tests exist but are mixed in, so a whole-suite run gives no clean signal. **Deliberately excluded from `make ci`.** |
| **Playwright E2E**           | `make test-e2e`           | Present in `tests/e2e/`, run manually, not a merge gate.                                                                                                                                                                                    |
| **Backend Jest**             | via the backend workspace | Not validated on every change.                                                                                                                                                                                                              |
| **Python (GPU-free subset)** | `make test-py`            | **Runs in `make ci`.** This is a real gate.                                                                                                                                                                                                 |
| **Python (full ML suite)**   | `make test-ml`            | Needs a GPU. Runs in a one-off container.                                                                                                                                                                                                   |

`make ci` runs: frontend TypeScript, backend TypeScript, ESLint at zero
warnings, i18n completeness across six locales, documentation link integrity,
and `make test-py`. It takes
about half a minute and is the check to run before opening a PR.

```bash
make ci                # the gate
make ci-test           # Vitest — informational only
make test-e2e          # Playwright
make test-ml           # full Python suite, needs a GPU
make test-coverage     # coverage report
make docs-links        # documentation link integrity
```

---

## Tests are not a substitute for verification

Even with every suite green, a user-facing change is **not done** until the
runtime path has been observed working — in a real browser for UI, with a real
`curl` for an API, with a real query for a schema change. Tests prove "this
assertion held under this scenario"; verification proves "the feature works
against real services". They are complementary.

The per-change-type verification table is in
[Contributing](development/contributing.md#verification-the-part-that-actually-matters).

---

## When to write a test

- **A pure function with a deterministic contract.** Geometry helpers, colour
  derivation, name resolution, parsers. These are cheap and they stay true.
- **A regression for a real bug.** Write the test that **fails before the fix
  and passes after**. The bug handed you the specification; encode it.
- **A cross-layer invariant.** The kind of thing no single unit can check —
  "these two arrays stay the same length across the pipeline", "the export and
  the batch produce the same number".

## When not to

- **Shallow render tests** that only confirm a component mounts. They pass while
  the feature is broken.
- **Tests against modules with broken imports.** Fix the import chain first.
- **Tests needing infrastructure that may be absent** (a loaded model, a GPU)
  without a skip guard.
- **Padding to reach a coverage number.** The coverage threshold is global, so
  an untested new class fails somebody _else's_ later PR — check your own file's
  coverage, not the total.

---

## Mutate every coverage claim

Before you believe a test protects something, **revert the fix and confirm the
test goes red**. A test that passes with the fix removed is testing nothing —
and this has happened here more than once, usually because the test exercised a
helper while the bug lived in the wiring.

## Validate on real data

A fully green synthetic fixture once hid a 3.14× production regression. Where
the behaviour depends on the shape of real data, pull real rows or real frames
rather than generating tidy ones.

---

## Running things directly

```bash
# One Vitest file
npx vitest run src/lib/__tests__/polygonGeometry.test.ts

# Backend tests inside the container
make shell-be
npm test

# A minimal ML repro
docker exec spheroseg-ml python -c "..."
```

For Python work, print array shapes and dtypes at every boundary — they are
runtime contracts that nothing type-checks.

## Related

- [Contributing](development/contributing.md)
- [Git hooks](hooks-guide.md)
- [Architecture](architecture/README.md)
