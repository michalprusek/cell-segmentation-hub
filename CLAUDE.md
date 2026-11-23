# CLAUDE.md

Guidance for Claude Code in this repository. **Read this fully before any non-trivial work.**

The most important section is **[Verification Rules](#verification-rules)**. Read it twice. Failing to follow it is the #1 cause of production bugs in this project.

Detail lives in `docs/claude/` (moved verbatim on 2026-11-02, brought up to `github/main` #644 on 2026-11-23): [verification](docs/claude/verification.md), [test suite](docs/claude/test-suite.md), [failure patterns](docs/claude/failure-patterns.md), [documentation rule](docs/claude/documentation-rule.md), [architecture notes](docs/claude/architecture.md), [conventions](docs/claude/conventions.md), [deploy gotchas](docs/claude/deploy-gotchas.md), [best practices](docs/claude/best-practices.md). Read the page for the area you touch before changing it. A code comment saying "see CLAUDE.md" or "CLAUDE.md records" may mean one of those pages.

## Scope: proceed on stated defaults, ask only for real choices

Take the most reasonable reading, say the assumption in one line, and do the work; a stated assumption costs less here than a round of questions. Stop and ask one short question first only when a wrong guess is costly: **destructive operations on shared data** (even on a test account), or a genuine scope fork such as **"all / everything"** statements with likely exceptions, **project-type or polyline-kind gating**, an **FE-only fix vs a broader BE/ML refactor**, or **"rotate / re-orient"** where the current orientation may already be right. If you realise mid-way that the reading was wrong, stop and say so; don't keep building on the guess.

## Production Safety

Production runs on `docker-compose.production.yml` with `.env.production`. Single-stack deployment (no more blue-green); containers are named `spheroseg-*` (frontend/backend/ml/postgres/redis/nginx). Database: `spheroseg`. URL: `https://spherosegapp.utia.cas.cz`. Verification accounts and their passwords live OUTSIDE this repo, in `~/.claude/spheroseg-e2e-account.txt` (mode 600) — this repository is public, so no credential belongs in it.

Deploys are autonomous — build the changed service, recreate it, restart nginx after a backend recreate, and verify (see [Production](#production-single-stack-post-2026-05-15)). Still exercise judgment: verify in a real browser after deploying, and never run destructive DB operations without care.

## Verification Rules

**"Done" is not "TypeScript compiles + ESLint clean".** Types prove "compiles", lint proves "follows rules", Vitest on mocks proves nothing about real data, and the minified bundle behaves differently than the dev server. **A change is "done" only when the runtime path that uses it has been observed working.** User-facing: a real browser. API: a real curl. DB: a real query. No exceptions. "It should work because the code looks right" is forbidden as a completion claim.

**Test account:** `claude.e2e.test@example.com`, credentials in `~/.claude/spheroseg-e2e-account.txt`. Use it for every browser check; **never verify against the user's own account or data.** If the flow needs data the account lacks, MAKE the data rather than handing the check back. There is no excuse for stopping at the login page.

Apply **every** gate that matches (full sequences in [verification](docs/claude/verification.md)):

- **A. UI:** Playwright MCP: navigate, snapshot, screenshot, console messages, click/type, wait, snapshot again.
- **B. API / response shape:** curl the wire response AND inspect FE state. A field present in the DATABASE proves nothing about the API.
- **C. WebSocket / async / queue:** trigger in the browser, tail the service log, verify each transition independently.
- **D. DB / Prisma:** inspect the resulting schema and column types. Production: **always `prisma migrate deploy`, never `migrate dev`.**
- **E. ML / Python:** test inside the ML container, print shapes and dtypes at boundaries, assert `len(centerlines[i]) == embedding_samples[i].shape[0]` where it applies.
- **F. Cross-stack:** an end-to-end Playwright walk-through is mandatory.
- **G. Build / deps:** `make build-service SERVICE=<x>`, then click through the production-mode preview.

**No console errors:** any error in the browser console during a Playwright check is a bug and a blocker. **Production parity:** a feature working locally is not working in production (minified bundle, latency, cold caches, nginx DNS, real auth state, real data shapes). **When verification finds a bug:** don't paper over it with `try/catch`; find the root cause, reproduce minimally, fix, re-run the same sequence, add a regression test only if it would have caught the bug.

## Do NOT hand back unverified fixes

**Test comprehensively yourself BEFORE telling the user to try it.** Reproduce the user's exact flow end-to-end with your own tools (Playwright MCP + service logs + DB). When the harness cannot exercise a path (the injected-token Playwright session has an unstable WebSocket), make the fix not depend on the unverifiable path, verify that path, and escalate only once you have observed it working.

## Test Suite Reality

A suite can be green, red, or wired to nothing, and this repo has all three: see [test suite](docs/claude/test-suite.md) before trusting one. Backend tests are Vitest, not Jest, and must run in the container. Pytest is not in the ml image. **Does the test file import the thing it tests?** **Mutate the claim:** revert the fix, confirm RED, restore. **Never assert on wall-clock**; assert renders counted, queries issued, calls made.

## Production Failure Patterns (Recognize and Prevent)

Each shipped to production at least once in 2026. Code comments cite these numbers. Checks and measurements: [failure patterns](docs/claude/failure-patterns.md).

1. Field missing from API response: `curl` the endpoint.
2. FE mapper strips a field (enumerative mappers): check React Query state, not just the controller.
3. SyntheticEvent as first arg of `onClick={handleX}`.
4. Per-inference randomness claimed stable: use `trackId`, not `instanceId`, across frames.
5. Incomplete `React.memo` comparator: update it whenever props change.
6. Build succeeds but bundle breaks: run the production build and preview.
7. Migration creates the wrong column type (Int4 vs BigInt).
8. Nginx upstream DNS cache: restart nginx after a backend `--force-recreate`.
9. Docker compose without `--env-file`: env vars silently empty.
10. Queue worker stuck on `isProcessing=true` after an ML recreate mid-POST: tail logs, restart backend.
11. TDZ: a hook placed BEFORE the `const` it captures throws a single-letter error in the minified bundle.
12. Frame slider seed/reverse-sync race on long videos.
13. Editor doesn't refresh after a same-count resegment: needs `reloadNonce` and a non-WS path.
14. Removing an npm dep breaks the prod build via `vite.config.ts`: grep the build config; the FE `tsc --noEmit` is vacuous.
15. Phantom transitive dependency: `npm ls` before removing a parent.
16. Yanked or load-bearing pins: `torch==2.6.0`, `numpy==1.26.4`, `transformers==5.5.4` (ceiling 5.9.0 breaks, 5.10 won't import). Read the full note before any bump.
17. Cross-frame MT identity is geometric since v5H: check `api/mt_geometry_cost.py`; there is no hard gate any more.
18. `process.env` in a browser bundle blanks the page: use `import.meta.env` in `src/`.
19. A test that defines its own subject measures nothing.
20. `async def` on single-worker uvicorn blocks `/health` and everything else; plain `def` is an OOM. Use a one-slot executor.
21. A regenerated baseline file hides new errors: diff against both parents.
22. Stale Prisma client makes the host TS check lie; regenerate through the container.
23. Start-up code that needs a migration: migrate before recreating, keep optional subsystems out of the critical start-up `try`.

## Documentation is part of the change, not a follow-up

**Every application change updates the documentation that describes it, in the same PR, verified like code.** It lives in four places that drift apart: `docs/**.md`; the in-app Documentation page (the `docs:` block in SIX `src/translations/*.ts` files; there are TWO `modelSelection` blocks); `docs/claude/<area>.md` for every "X lives at Y" claim (`CLAUDE.md` itself holds only rules and pointers, keep it under ~20 KB because it loads into every session); code comments with measured numbers. `grep` the docs for everything you deleted or renamed, open the in-app page for user-visible changes, re-measure any number instead of copying it, and state in the PR which docs you checked. When docs and code disagree, confirm the CODE is right first. Full: [documentation rule](docs/claude/documentation-rule.md).

## Commands

**Docker-first project. Never run npm/node directly on the host — use `make` targets or container shells.**

```bash
make up / down / logs-f / health         # Start (FE :3000, BE :3001, ML :8000), stop, tail, health check
make shell-fe / shell-be / shell-ml      # Container shells
make ci                                  # Full local CI gate, 9 steps, ~80 s: TS + ESLint (FE+BE) + i18n + doc links + Python + model-id parity + shared constants
make ci-test                             # Frontend Vitest, the same suite the required CI job runs
npx tsc --noEmit                         # Frontend type check
make lint                                # ESLint in Docker
npm run lint:backend                     # backend/src ESLint baseline gate; lint:backend:update accepts new debt, lint:backend:self-test proves the gate fails
make build-optimized                     # Smart build with auto-cleanup
make build-service SERVICE=frontend      # Build single service; make build-clean = full no-cache rebuild
npx prisma migrate dev --name <name>     # Dev migration, inside make shell-be (also: migrate deploy, generate, studio)
```

**`npx eslint src/` is the FRONTEND only**; the root config ignores `backend/**`. Backend test files are still unlinted.

### Production (single-stack, post-2026-05-15)

Blue-green is gone. Deploy is a rebuild + recreate of the affected services:

```bash
# 1. Build the changed services
make build-service SERVICE=backend                     # or frontend / ml
# 1b. If the change has a migration, apply it FROM THE NEW IMAGE, BEFORE the swap
docker compose -f docker-compose.production.yml \
  --env-file .env.production \
  run --rm --no-deps -T backend npx prisma migrate deploy
# 2. Recreate (no need to stop the others)
docker compose -f docker-compose.production.yml \
  --env-file .env.production \
  up -d --no-deps --force-recreate backend             # repeat with frontend / ml
# 3. Flush nginx upstream DNS cache after a backend recreate
docker restart spheroseg-nginx
# 4. Verify
curl https://spherosegapp.utia.cas.cz/health           # → "production-healthy"
```

**Migrate before you recreate, not after:** on 2026-10-06 the other order caused twelve restarts and about four minutes with the whole app down. `make prod` rebuilds and recreates everything. Ports production/dev: nginx 80/443, FE 4000/3000, BE 4001/3001, ML 4008/8000, PostgreSQL 5432, Redis 6379 (internal).

## Deploy Gotchas

Full text and measurements: [deploy gotchas](docs/claude/deploy-gotchas.md).

- **Images BAKE their source; a merged PR does not reach production until that service is rebuilt.** Before diagnosing anything, pin the container to a commit: `docker exec spheroseg-ml md5sum /app/models/<file>.py` against `git show <commit>:backend/segmentation/models/<file>.py | md5sum`.
- **`prisma migrate deploy`, never `migrate dev`, in production.** **Always `--env-file .env.production`.** **After backend `--force-recreate`, restart nginx.**
- Bind-mounted configs need `--force-recreate`, not `nginx -s reload`.
- Upload limits are coupled across 3 layers; the smallest wins. A `.tif` over 20 MB is routed to `/videos` by size unless `colourStillTiff.ts` classifies it as a photograph.
- No model fetches from HuggingFace at load time since PR #556/#559. Before adding `HF_TOKEN` or a cache back, run the `--network none` load check and assert the model count from the loader's own source.
- **GPU access is granted by `device_cgroup_rules`; do NOT "fix" it by switching to `devices:`** (crash-loop on boot). Symptom of a stripped GPU is silent CPU with a healthy `/health`.
- `_blue_data` volume names, `./backend/uploads/blue` and the `blue`-suffixed DB password are cosmetic leftovers; renaming needs downtime. Never paste the password anywhere; it lives only in `.env.production`.

## Tech Stack

React 18 + TS + Vite + shadcn/ui · Node + Express + TS + Prisma · Python + FastAPI + PyTorch · PostgreSQL · Socket.io · JWT access + refresh · i18n in 6 languages (EN, CS, ES, DE, FR, ZH) via a hand-rolled `LanguageContext`, **not i18next**. Models: `docs/reference/ml-models.md`.

## Architecture invariants

Skim-level subsystem notes: [architecture notes](docs/claude/architecture.md); depth in `docs/architecture/`.

### The segmentation model belongs to the PROJECT (since 2026-09-20, PRs #553/#554)

`projects.segmentationModel`, nullable, `NULL` = the type's default, **never backfilled**; resolve with `resolveProjectModel()` on both sides. Rename / type / model are owner-only. Full section in the architecture notes.

- **Mappers are enumerative:** `mapProjectFields` and `validateSinglePolygon` strip every field not listed. A new field must be added there.
- **Public API `/api/v1`:** auth is `authenticateApiKey`, never `authenticate`; errors go through `sendProblem`, never `res.json`; the key is never stored; a parameter a model does not read is REFUSED (422), never dropped; the worker is the only writer of `items`; never add an nginx `location /api/v1/` pointing at `ml_service`.
- **Sessions:** do not "improve" refresh replay with a `SET NX` claim. Account deletion removes files by PROJECT, never by folder. `AuthContext.deleteAccount` must not touch the global `loading` flag.
- **Microtubules:** the model is IRM-only and its threshold is NOT a user setting. Model code and metrics each have ONE copy (`models/microtubule`, `models/mt_measure.py`). The out-of-focus check is a DIAGNOSTIC and must stay one. Set GPU caps ABOVE the model's working set, never below. Kymograph intensities from before 2026-09-01 and Essays numbers from before 2026-11-03 (SPARSE35 → V16 DEB_S4 ep040) are not comparable with later ones.
- **`projects.pixelSizeUm` is read at segmentation by `spheroid_disintegration` only** (2026-11-08): the ML resamples to 1.28 µm/px and answers 400 to the field for any other model.
- Video containers are never enqueued. `polygonGeometry.ts` holds geometry, don't duplicate it. `editor.getPolygons()`, not `editor.polygons`, in event handlers.

## Code Conventions

Details: [conventions](docs/claude/conventions.md). Pre-commit (Husky): no `console.log` / `debugger`, ESLint 0 warnings on staged files, backend baseline gate, Prettier, TS check, conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`). **Direct commits to `main` are blocked: feature branches + PRs.** All user-facing strings exist in all 6 translation files (`node scripts/check-i18n.cjs`); `t()` is not reachable in `UploadProvider` or on the server, carry a key instead. CI: `ci.yml` `frontend` and `backend` are required; they gate what they cover and nothing more.

## Email

UTIA mail server (`hermes.utia.cas.cz:25`, STARTTLS, no auth). 2-10 min delays are normal (background queue). Config in `.env.production`.

## Best Practices

From the 2026-09-04 audit, in full in [best practices](docs/claude/best-practices.md). Re-measure a number before repeating it. Rehearse a runbook before relying on it. A green build proves the build, not the behaviour. `npm ls <pkg>` before removing anything. **Don't weaken a guard for your own convenience** (`allow_auto_merge` is off on purpose). **Don't route around a soft-denied command:** finish everything else and hand over the exact steps. **Don't "simplify" code whose docstring carries measured numbers** (`rasterize_band`, `vicinity_mask`, `focus_qc/metrics.py`).

## Documentation Index

[Architecture](docs/architecture/README.md) · [Frontend](docs/architecture/frontend.md) · [Backend](docs/architecture/backend.md) · [ML service](docs/architecture/ml-service.md) · [Database schema](docs/reference/database-schema.md) · [Testing guide](docs/testing-guide.md) · [i18n guide](docs/i18n-guide.md) · [Git hooks](docs/hooks-guide.md) · [API](docs/api/README.md) · [Getting started](docs/development/getting-started.md) · [Polygon rendering](docs/polygon-rendering-optimization.md), accurate as of 2026-06-22.
