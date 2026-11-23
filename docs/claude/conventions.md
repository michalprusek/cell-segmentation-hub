# Code conventions

Pre-commit gates, i18n traps, React patterns and the CI surface.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

### Pre-commit (Husky)

`.husky/pre-commit` validates every commit:

- No `console.log` / `debugger`
- ESLint **0 warnings** (strict) on **staged** frontend files, via lint-staged. The hook's separate whole-tree `npx eslint .` (step 7) is **advisory only** — it swallows the output and increments a warning counter, so an unstaged frontend lint error does not block the commit. `make ci` and the CI `frontend` job do gate it.
- ESLint baseline gate on `backend/src` (step 7b) — **blocks** on any problem not in `eslint-baseline.json`, and blocks when the gate itself cannot run
- Prettier formatting
- Frontend + backend TypeScript check
- Conventional commits required (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`)
- Direct commits to `main` blocked — use feature branches + PRs

### i18n

All user-facing strings must exist in all 6 translation files (`/src/translations/{en,cs,es,de,fr,zh}.ts`). Validate: `node scripts/check-i18n.cjs`.

**`t()` is not reachable everywhere.** `UploadProvider` is mounted OUTSIDE `LanguageProvider` in `App.tsx`, so nothing in the upload state machine can translate — for a long time every line of the upload card's status text was English in all six locales, and the validator could not see it because there was no key to check. Code in such a position must carry a translation KEY and let the render site resolve it (`UploadOperation` in `src/lib/uploadUtils.ts`, resolved in `FloatingUploadProgress`). **The server has the same problem** and for the same reason: it cannot know the browser's locale, so a progress event carries `messageKey`/`messageParams`, never a composed sentence. `videoUploadService.test.ts` scans the source and fails on any `reportProgress` without a key — four NESTED ones were missed on the first pass and shipped English onto a Czech UI.

The i18n validator only checks that keys exist in every file. It cannot tell you a string was never keyed in the first place, so **grep for user-visible string literals in any code path you touch**.

### React patterns in this codebase

- **React.memo with custom comparators** — used heavily in canvas (`CanvasPolygon`, `CanvasVertex`). When adding props, update the comparator. Missed comparator entries are a recurring bug.
- **`useCallback` / `useMemo` stability** — parent callbacks passed to memoized children must be stable. Arrays passed for reference-equality need stabilized refs (see `availableInstanceIds` two-stage memo pattern).
- **`editor.getPolygons()`** — use this (reads latest ref) instead of `editor.polygons` (closure snapshot) when updating polygons from event handlers.

### CI surface

GitHub Actions is intentionally minimal (4 chronically-broken workflows were removed in PR #161):

- `ci.yml` — the merge gate: jobs `frontend`, `backend`, `pins`, `python-tests`. The `frontend` job also runs the two parity scripts (`check-model-parity.cjs`, `verify-shared-types.cjs`) since 2026-10-06 — they read every source as text, Python included, so they need Node only
- `codeql.yml` — passive security scanning (Security tab)
- `nightly-drift.yml` — daily TS/ESLint/i18n + npm audit on `main`; opens labelled issue on failure, doesn't block PRs
- GitGuardian App — secret leak detection

`frontend` and `backend` are REQUIRED checks (ruleset `main-protection`, strict), so a red run blocks the merge. They are a gate for what they cover and nothing more: the pre-commit hook, `make ci`, a real browser and a real request are still what catch the rest — see every "found only on the wire" note in this file.

## Scope: proceed on stated defaults, in full

The maintainer is decisive and has twice rejected multi-question
`AskUserQuestion` prompts: over-asking frustrates more than a stated
assumption does. Default: take the most reasonable reading, say the
assumption in one line, do the work and show the evidence.

Ask ONE short question first only where a wrong guess is costly to undo:

- **Destructive operations on shared data** — even on a test account,
  ask before wiping fixtures the user might still need.
- **"All / everything"** statements that might have exceptions. Example
  ("all today's changes should affect only MT projects") may exclude
  changes the user actually wants kept universal (hover radius, slice
  geometry).
- **Project-type or polyline-kind gating decisions** — features that
  could plausibly belong to one project type, all of them, or some
  subset.
- **Choice between a simple FE-only fix and a broader BE/ML
  refactor** when both are plausible.
- **"Rotate / reformat / re-orient"** UI requests where the existing
  orientation might already be correct (kymograph axes are a recent
  example).

When you do ask, name the concrete options and their trade-offs in the
question itself rather than an open-ended "what do you want?".

If you've already coded something and only THEN realise the reading was
wrong, stop and say so before going further; don't keep building on
the guess.

## Backend lint note

**`npx eslint src/` is the FRONTEND only.** The root `eslint.config.js` ignores
`backend/**`, so for a long time nothing linted `backend/src` — not `make ci`,
not CI, not lint-staged (its `*.{ts,tsx}` entry hands backend files to the root
config, which ignores them). A hard ESLint error shipped through a green
`make ci` that way. `scripts/eslint-baseline.mjs` now gates that tree against a
committed `eslint-baseline.json`, the same design as
`scripts/type-check-baseline.mjs`: pre-existing problems are recorded and
tolerated, anything new fails. Backend **test** files are still unlinted —
`backend/eslint.config.js` ignores `**/*.test.ts` and `**/__tests__/**`.

## Tech stack table

| Layer      | Technology                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend   | React 18 + TypeScript + Vite + shadcn/ui (Radix + Tailwind)                                                                                                                                                                                                                                                                                            |
| Backend    | Node.js + Express + TypeScript + Prisma                                                                                                                                                                                                                                                                                                                |
| ML Service | Python + FastAPI + PyTorch (SegFormer, HRNet, CBAM-ResUNet, U-Net, Mamba-UNet, Spheroid Disintegration, Sperm, Sperm 2-part (head + tail), Wound, Microcapsule, Neurite/Soma, Neurite/Soma classical (`neurite_soma_classical`: Meijering ridge filter + shape rules on a merge of user-ticked channels; CPU, no weights), Microtubule SPARSE35 ep040) |
| Database   | PostgreSQL (dev + prod via Docker compose)                                                                                                                                                                                                                                                                                                             |
| Real-time  | Socket.io with auto-reconnect + exponential backoff                                                                                                                                                                                                                                                                                                    |
| Auth       | JWT access + refresh tokens                                                                                                                                                                                                                                                                                                                            |
| i18n       | 6 languages (EN, CS, ES, DE, FR, ZH) via a hand-rolled `LanguageContext` — **not i18next**                                                                                                                                                                                                                                                             |
