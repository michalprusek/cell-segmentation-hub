# Testing guide

What each suite covers, what state it is actually in, and when writing a test is
worth it.

> **The suites are green and they gate merges** — but a green run still
> proves less than you would like. This page states the honest position
> rather than the aspirational one. Counts measured 2026-09-04; re-measure
> before repeating them.

---

## The suites

| Suite                        | Command                     | State                                                                                                                               |
| ---------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Vitest** (frontend unit)   | `make ci-test`              | **5037 pass / 5037**, 275 files, ~2 min. Not in `make ci`, but the `frontend` CI job runs it with coverage and is a required check. |
| **Vitest** (backend unit)    | in the container, see below | **3740 pass / 3744** (4 skipped), 179 files, ~27 s. Not Jest. The `backend` CI job runs it with coverage and is a required check.   |
| **Playwright E2E**           | `make test-e2e`             | Present in `tests/e2e/`, run manually, not a merge gate.                                                                            |
| **Python (GPU-free subset)** | `make test-py`              | **400 pass / 401** (1 skipped), ~26 s. Runs in `make ci` and in the `python-tests` CI job.                                          |
| **Python (full ML suite)**   | `make test-ml`              | Needs a GPU. Runs in a one-off container.                                                                                           |

**`make ci` is not the whole gate.** It runs frontend TypeScript, backend
TypeScript, ESLint at zero warnings, i18n completeness across six locales,
documentation link integrity, and `make test-py` — about half a minute, and
the check to run before opening a PR. It does **not** run vitest; that happens
in CI, where `.github/workflows/ci.yml` runs `npx vitest run --coverage` in
both the `frontend` and `backend` jobs, each enforcing its `vitest.config.ts`
coverage floor. The `main-protection` ruleset requires both contexts, so a
red vitest run blocks the merge even though a green `make ci` said nothing
about it.

```bash
make ci                # the local pre-PR gate (no vitest)
make ci-test           # frontend Vitest, the same run CI gates on
make test-py           # the Python suite `make ci` step 7 runs
make docs-links        # documentation link integrity
```

`make test`, `make test-e2e`, `make test-coverage` and `make test-ml` all shell
into a running container via `docker compose` with no `-f` argument, so on a
fresh clone they fail before they test anything — the repository tracks no
`docker-compose.yml`. Run those suites directly instead:

```bash
npx vitest run --coverage   # frontend, with the coverage floor CI enforces
npx playwright test         # E2E
```

### Backend tests need the container

Canvas ABI: the host's Node 22 against the image's Node 20.

```bash
docker run --rm --user root --entrypoint /bin/sh \
  -v $PWD/backend:/app -v /app/node_modules -w /app \
  cell-segmentation-hub-backend -c "npx vitest run <path>"
```

`--user root` is needed to read `.env`; `-v /app/node_modules` keeps the
image's modules instead of the host's. Bind-mounting the whole `backend`
directory is what makes it test the working tree — the image bakes `src`, so
without the mount you are testing whatever was last built.

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
