# Contributing

How work gets from an idea into `main`.

---

## Setup

See [Getting started](getting-started.md). In short: this is a Docker-first
project, so use the `make` targets rather than running `npm` on the host.

---

## Branching and commits

- **Direct commits to `main` are blocked.** Work on a branch and open a pull
  request.
- **Conventional Commits are required**: `feat:`, `fix:`, `chore:`,
  `refactor:`, `test:`, `docs:`, `perf:`.
- Branch off an up-to-date `main`. If you branch off a branch that later gets
  squashed, your PR will show as conflicting; the fix is
  `git reset --soft origin/main`, one fresh commit, force-push.

---

## The gate

CI on GitHub is intentionally minimal — CodeQL scanning, a nightly drift check
and secret detection. **The real gate is local.**

### Pre-commit (Husky)

Every commit is checked for:

- no `console.log` / `debugger`;
- ESLint at **zero warnings**;
- Prettier formatting;
- frontend and backend TypeScript;
- a Conventional Commit message.

**Never bypass it with `--no-verify`.**

### `make ci`

```bash
make ci
```

TypeScript (frontend and backend), ESLint at zero warnings, i18n completeness
across all six locales, documentation link integrity, and the GPU-free Python
suites. Takes about half a minute.

### Documentation links

Already part of `make ci`; run it on its own while editing docs:

```bash
make docs-links      # or: node scripts/check-doc-links.cjs
```

Every relative link in `docs/**`, `README.md` and `CLAUDE.md` must resolve —
both the file and, for a link into a Markdown file, the `#anchor`. Run it after
renaming or deleting any page, or after renaming a heading.

---

## Verification: the part that actually matters

**"It compiles and lints" is not "it works."** Type checks prove compilation,
lint proves style, and unit tests on mocks prove nothing about real data. Every
production bug this project has shipped passed all three.

A change is done when **the runtime path that uses it has been observed
working**:

| Change                             | Minimum verification                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| UI / layout / component            | Open it in a real browser. Screenshot it. **Check the console** — any error is a blocker                                           |
| API endpoint or response shape     | A real `curl` (or the network panel) showing the field on the wire, **and** confirmation that the frontend mapper did not strip it |
| WebSocket / queue / async          | Trigger it in the browser while tailing the service log; verify each transition, not just the final state                          |
| Database / Prisma                  | Run the migration and inspect the resulting schema. Check numeric column types against the values that will actually be stored     |
| ML / Python                        | A minimal repro inside the ML container; print array shapes and dtypes at the boundaries                                           |
| Cross-stack feature                | An end-to-end walk-through. Bugs live in the seams, and unit tests mock exactly those                                              |
| Build / dependency / bundle config | `make build-service SERVICE=frontend` and click through the production preview                                                     |

Two recurring traps worth naming:

- **Removing a dependency** can break only the production build, because the
  package lingers in `node_modules` locally and the frontend type-check is
  vacuous. Grep the build config (`vite.config.ts`, `tailwind.config.ts`), not
  just `src/`, and run a real build.
- **A phantom dependency** — imported directly but only satisfied transitively —
  disappears when its parent is removed, and only a fresh-install Docker build
  catches it. `npm ls <package>` before removing anything.

---

## Tests

The suites are in mixed health; see the [testing guide](../testing-guide.md) for
honest numbers. A passing `npm test` is not evidence a feature works.

**Write a test when:**

- the code is a pure function with a deterministic contract;
- you are fixing a real bug — write the test that fails before the fix and
  passes after. The bug is the specification;
- you are protecting a cross-layer invariant.

**Do not write:**

- shallow render tests that only confirm a component mounts;
- tests against modules whose imports are already broken;
- padding to move a coverage number.

And **mutate every coverage claim**: revert the fix and confirm the test goes
red. A test that passes without the fix tests nothing.

---

## Internationalisation

Every user-facing string must exist in **all six** locale files
(`src/translations/{en,cs,es,de,fr,zh}.ts`). Validate with
`node scripts/check-i18n.cjs`, which `make ci` runs. Do not leave English
strings in the non-English files. See the [i18n guide](../i18n-guide.md).

---

## Documentation

If your change alters behaviour a user can see, update the page that describes
it in the same PR. If a page and the code disagree, the page is a bug.

Two surfaces:

- `docs/` — this tree, read as Markdown.
- `src/pages/Documentation.tsx` plus the `docs.*` i18n block — the in-app user
  manual, which is searchable and translated. Content there lives in the locale
  files, not in the component.

---

## Adding a model

Adding a segmentation model touches roughly nine files: the three mirrored
registries (frontend, backend, Python), the Python wrapper and its loader entry,
the weights download script, and the model's name and description in all six
locales. `scripts/check-model-parity.cjs` and `scripts/check-i18n.cjs` will tell
you what you missed.

## Related

- [Getting started](getting-started.md)
- [Testing guide](../testing-guide.md)
- [Git hooks](../hooks-guide.md)
- [Architecture](../architecture/README.md)
