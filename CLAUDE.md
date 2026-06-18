# CLAUDE.md

Guidance for Claude Code in this repository. **Read this fully before any non-trivial work.**

The most important section is **[Verification Rules](#verification-rules)**. Read it twice. Failing to follow it is the #1 cause of production bugs in this project.

---

## Ask when unclear — do not assume scope

When a request is ambiguous or could be interpreted multiple ways,
**use `AskUserQuestion` BEFORE coding**. Guessing what the user meant
and shipping the wrong interpretation wastes a round-trip and erodes
trust. Concrete situations that demand a clarification question:

- **"All / everything"** statements that might have exceptions. Example
  ("all today's changes should affect only MT projects") may exclude
  changes the user actually wants kept universal (hover radius, slice
  geometry). Ask which specific changes are in scope.
- **Project-type or polyline-kind gating decisions** — features that
  could plausibly belong to one project type, all of them, or some
  subset. Don't assume; ask.
- **Destructive operations on shared data** — even on a test account,
  ask before wiping fixtures the user might still need.
- **Choice between a simple FE-only fix and a broader BE/ML
  refactor** — ask which trade-off the user wants.
- **"Rotate / reformat / re-orient"** UI requests where the existing
  orientation might already be correct (kymograph axes are a recent
  example).

When asking, surface 2–3 concrete options via `AskUserQuestion` rather
than open-ended "what do you want?" — the user can compare side-by-side
and pick. Always state the trade-offs.

If you've already coded something and only THEN realise it was
ambiguous, stop and ask before going further; don't keep building on
the guess.

---

## Production Safety

**Never modify or deploy to production without explicit permission.** Production runs on `docker-compose.production.yml` with `.env.production`. Single-stack deployment (no more blue-green); containers are named `spheroseg-*` (frontend/backend/ml/postgres/redis/nginx). Database: `spheroseg`. URL: `https://spherosegapp.utia.cas.cz`. Test account: `12bprusek@gym-nymburk.cz` / `spheroids2026`.

---

## Verification Rules

### The non-negotiable rule

**"Done" is not "TypeScript compiles + ESLint clean".** Production bugs in this repo have repeatedly shipped despite green pre-commit because:

- Types prove "compiles", not "behaves correctly".
- Lint proves "follows rules", not "logic is right".
- Vitest passing on isolated mocks proves nothing about real data.
- The production-build minified bundle behaves differently than the dev server.

**A change is "done" only when the runtime path that uses it has been observed working.** For user-facing changes, that means a real browser. For API changes, a real curl. For DB changes, a real query. No exceptions.

### Verification gates per change category

The mandatory verification depends on what changed. Apply **every** gate that matches; ignoring "minor" UI tweaks is how regressions slip in.

#### A. UI / component / layout / styling change

Always use **Playwright MCP** (`mcp__playwright__browser_*` tools). Sequence:

```
1. browser_navigate           → open the relevant route on https://spherosegapp.utia.cas.cz
2. browser_snapshot           → a11y tree confirms the element exists in DOM
3. browser_take_screenshot    → visual confirmation; review the screenshot
4. browser_console_messages   → ANY error/warning means the feature is broken
5. browser_click / _type      → trigger the user action this PR is about
6. browser_wait_for           → for the post-action state (text appears, request settles)
7. browser_snapshot again     → confirm the DOM changed as expected
```

Do not claim "the new panel renders correctly" without `browser_take_screenshot` showing it. Do not claim "the button works" without `browser_click` followed by a state verification step. **"It should work because the code looks right" is forbidden as a completion claim.**

#### B. API endpoint / backend response shape change

Three options, pick at least one:

1. **`curl` against dev or production**: `curl -s -H "Authorization: Bearer $TOKEN" $URL | jq` — verify the exact field is present with the expected type. Don't trust the controller code; trust the wire response.
2. **`browser_network_requests`** in Playwright: navigate to the page that calls the endpoint, inspect the actual request + response in the network panel.
3. **`browser_evaluate`** to read React Query cache: `window.__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__` or by accessing the QueryClient via a known component's props.

Common bug: backend exposes a field but the FE mapper strips it. Run BOTH the backend curl AND the FE state inspection to be sure.

#### C. WebSocket / async / queue / state machine change

- Trigger the action in the browser via Playwright.
- Tail the relevant service log in parallel (`docker logs -f spheroseg-backend` or `spheroseg-ml`) and grep for the event.
- Confirm the FE state actually changed (poll React state via `browser_evaluate` or visual via screenshot).
- For multi-step flows (e.g. upload → queue → segment → display), verify each transition independently — don't rely on the final state alone.

Bugs in this category include: queue worker stuck on `isProcessing=true`, WebSocket emit race with React Query invalidation, Socket.io reconnect dropping subscriptions. None are catchable by unit tests.

#### D. Database / Prisma schema change

- Run the migration in the dev container: `docker exec spheroseg-backend npx prisma migrate dev --name <name>`.
- Inspect the resulting schema: `docker exec spheroseg-postgres psql -U spheroseg -d spheroseg_dev -c "\d <table>"`.
- Verify column types, constraints, indexes match intent.
- For production: **always** `prisma migrate deploy`, never `migrate dev` (the latter creates new migration files against the live DB).
- BigInt vs Int4 has bitten this codebase before (fileSize overflow); double-check numeric column types match the JS-side number ranges.

#### E. ML pipeline / Python / model wrapper change

- Test inside the ML container: `docker exec spheroseg-ml python -c "..."` with a minimal repro.
- Verify ndarray shapes and dtypes via `print(arr.shape, arr.dtype)` at boundaries — these are runtime contracts, not type-checked.
- For changes that affect tracking embeddings or polyline output: assert the cross-frame invariant `len(centerlines[i]) == embedding_samples[i].shape[0]`. Misalignment silently corrupts Hungarian matching.
- If the change is performance-sensitive (CUDA OOM territory), monitor with `nvidia-smi -l 1` during a real inference call.

#### F. Cross-stack feature (frontend ↔ backend ↔ ML)

End-to-end Playwright walk-through of the user journey is **mandatory**. Unit tests are insufficient because they mock the layer boundaries; real bugs live in the seams. Example sequence for "segment a microtubule video":

```
1. browser_navigate → project page
2. browser_click "Segment All" → channel picker dialog should appear
3. browser_click channel option + Confirm → toast + queue stats update
4. (background) docker logs spheroseg-ml | grep -i microtubule → confirm inference
5. browser_navigate → editor of frame 0
6. browser_snapshot → confirm polylines render with per-MT colors
7. browser_navigate → editor of frame 5
8. browser_snapshot → same MTs keep same color (trackId stable)
```

#### G. Build / dependency / bundle config change

- Always run `make build-service SERVICE=frontend` (or backend / ml-service) locally before claiming done. Minified production bundles strip dead code, rename identifiers, and split chunks differently from dev.
- After a successful build, hit the **production-mode local preview** (`docker compose -f docker-compose.production.yml up -d --no-deps --force-recreate frontend`) and click through key flows in a browser. Dev-server HMR-friendly code can break under tree-shaking.

### The "no console errors" policy

**Any error in the browser console during a Playwright check is a bug.** Treat it as a blocker. Warnings are case-by-case: React `key` warnings = bug; deprecation warnings from libraries = file in tech debt log.

```
browser_console_messages → if length > 0 with severity 'error', the change is NOT done.
```

### The production-parity rule

**A feature works locally ≠ a feature works in production.** Things that differ:

- Bundled minified code (Vite tree-shake + chunk split)
- Real network latency (200 ms+ vs 0 ms local)
- Cold caches (no React Query memo, no service worker)
- Nginx upstream DNS caching (a backend recreate may need `docker restart spheroseg-nginx`)
- Real auth state (expired tokens mid-action, refresh races)
- Real user data shapes (ND2 with IRM channel, missing frames, 200-frame videos)

If the change is going to production, **build the production bundle locally and click through it** before deploying. The dev server is a development convenience, not a production proxy.

### What to do when verification finds a bug

1. Don't paper over it with `try/catch` or fallbacks unless that's the actual fix.
2. Identify the root cause; verification revealed the symptom, the real bug may be one layer up.
3. Reproduce minimally — confirm the bug exists in the smallest possible setup.
4. Fix the root cause; re-run the same verification sequence; confirm it now passes.
5. Add a regression test if and only if the test would have caught the bug. Don't pad the suite with shallow assertions.

---

## Test Suite Reality

**Treat the test suite as currently broken.** Honest numbers as of 2026-05-15:

| Suite                         | State                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest (frontend unit)        | ~31% failures (467/2543). Mostly webSocketManager, ND2 helpers, legacy editor tests. Healthy tests exist but mixed in; running the suite gives no clean signal. |
| Playwright E2E (`tests/e2e/`) | Present, not regularly run, not in merge gate. Run manually via `make test-e2e`.                                                                                |
| Backend Jest                  | Not validated regularly. Several `*.sperm.test.ts` files are untracked work-in-progress.                                                                        |
| Python pytest                 | Not installed in the ML container. Test files parse but cannot run inside Docker.                                                                               |

**Consequence**: a passing `npm test` proves nothing about the feature. Don't rely on it.

### When to write tests

- **Pure utility function with a deterministic contract** → unit test. See `instanceColors.test.ts` for the pattern.
- **Regression fix for a real production bug** → write a test that fails before the fix and passes after. The bug provided the spec; encode it.
- **Cross-frame / cross-layer invariant** → integration test with mocked layer boundaries (see `test_rdp_preserves_embedding_alignment` for the pattern).

### When NOT to write tests

- Shallow render tests that just confirm a component mounts — these are noise. They pass even when the feature is broken.
- Tests against modules with broken imports — fix the import chain first.
- Tests requiring infrastructure not gated on availability (e.g. ML model loaded) — guard with `pytest.importorskip` / `vi.skipIf`.
- Padding existing suites to hit a coverage number.

### Tests are not a substitute for verification

Even if every test passes, **you still must Playwright-verify the user-facing change**. Tests prove "this assertion held under this scenario"; verification proves "the feature works in a real browser against real services". They are complementary, not interchangeable.

---

## Production Failure Patterns (Recognize and Prevent)

Each of these shipped to production at least once in 2026 despite green pre-commit. Recognize and proactively check:

1. **Field-missing-from-API-response**. Backend forgot to expose a field; FE renders empty/null. Check: `curl` the endpoint and assert field present.

2. **FE mapper strips field**. Backend exposes field, but a `useProjectData`-style mapper drops it before it reaches components. Check: `browser_evaluate` on React Query state, not just the controller.

3. **SyntheticEvent as first arg**. `onClick={handleX}` passes a React SyntheticEvent as the first argument, so `handleX(opt?: string)` treats the event as `opt`. Check: `typeof arg === 'string'` in handlers + Playwright click test.

4. **Per-inference randomness claimed stable**. Claiming an ID is preserved across frames when it's `uuid.uuid4()` per call. Check: read the model code (`backend/segmentation/ml/model_loader.py`) before claiming behavior; for cross-frame stability use `trackId` (written by tracker), not `instanceId`.

5. **Incomplete React.memo comparator**. Adding a new prop to a memoized component but forgetting to compare it; component never re-renders on prop change. Check: when touching a `React.memo` component's props, always update the comparator (`CanvasPolygon.tsx:387` style).

6. **Build succeeds but bundle breaks**. ESLint/TS clean, but `make build-service SERVICE=frontend` fails on minification or chunk split, or the minified code behaves differently. Check: run the production build locally + open the production preview.

7. **Migration runs but column is wrong type**. Prisma migration creates an Int4 where the FE will eventually push a number > 2³¹. Check: schema after migration + a real overflow value.

8. **Nginx upstream DNS cache**. Backend recreated; nginx still points at old container IP → 502s. Check: after a backend `--force-recreate`, also restart nginx.

9. **Docker compose without `--env-file`**. Env vars (e.g. `HF_TOKEN`) silently empty in the container. Check: `docker exec ... env | grep HF_TOKEN` after recreate.

10. **Queue worker stuck on `isProcessing=true`**. ML recreate during an in-flight axios POST leaves the backend in a deadlock state. Check: tail backend logs after deploy; if no progress, restart backend.

11. **TDZ on useCallback referencing a later `const`**. New `useCallback` / `useMemo` / `useEffect` placed BEFORE a `const x = ...` it captures in its deps array (or body) throws `Cannot access '<single letter>' before initialization` at runtime — TS doesn't catch it because the component body looks like a flat scope. Production minified bundle shows the error as a single letter (`'A'`, `'b'`). Check: when reordering hooks in `SegmentationEditor.tsx`, ensure any hook that touches `video.*`, `editor.*`, `selectedImage.*` is placed AFTER the corresponding `const video = ...`, etc.

12. **Frame slider seed/reverse-sync race**. `useVideoFrames` defaults `frameIndex=0`. If reverse-sync (frameIndex→URL) fires before seed (URL→frameIndex) propagates a `setFrameIndex(N)`, the URL flips to `frames[0]` and oscillates with seed at ~7 Hz on multi-hundred-frame videos. Check: tests on a 600+-frame video; the editor must converge within 1-2 render commits. Pattern: 3-effect choreography with ref-tracked seed marker — see memory `project_frame_slider_race_pattern`.

13. **Editor doesn't refresh after resegment (same-count)**. The editor's polygon-sync effect in `useEnhancedSegmentationEditor.tsx` only pulls new data into the canvas when the polygon **count** or `imageId` changes. A resegment usually returns the **same count** with new geometry, so a reload (`setSegmentationPolygons`) updates page state but the canvas keeps the stale polygons. Fix pattern: a `reloadNonce` that increments on every reload and is part of the sync effect's `isNewData`. Also: the WebSocket completion event is NOT a dependable refresh trigger (it can silently not reach `handleSegmentationStatusUpdate`); a resegment must have a non-WS path (background poll on `getSegmentationResults().updatedAt`) to reload + show the success toast on completion. Check: delete a polygon → resegment → the new polygon must reappear AND the success toast fire WITHOUT a manual F5.

14. **Removing an npm dep breaks the prod build via `vite.config.ts`**. Dropping a package from `package.json` (or via `npm audit fix`) passes locally — it lingers in `node_modules` — AND passes CI, because the FE `npx tsc --noEmit` is **vacuous** (root `tsconfig.json` is `files: []` + project references → it type-checks nothing; Vite doesn't type-check either). But the production `vite build` fails with `Could not resolve entry module 'X'` when `X` is still named in `manualChunks` / `optimizeDeps`. Check: when removing a dep, grep the build config too (`vite.config.ts`, `tailwind.config.ts`) — not just `src/` — and run `make build-service SERVICE=frontend` before claiming done. (Caught `cmdk`/`vaul`/`input-otp` left in `manualChunks`, 2026-06-17.)

15. **Phantom (transitive-only) dependency**. A package imported directly in code but absent from `package.json`, satisfied only transitively via another dep. Removing that parent (e.g. `bull`) drops the phantom (`ioredis`, imported directly by `healthCheckService.ts`) from a fresh `npm ci` → the service crash-loops at startup (`ERR_MODULE_NOT_FOUND`). The host `node_modules` still has it, so `make ci` and a local run pass; only a fresh-install Docker build/deploy catches it. Check: before removing a package, `npm ls <suspect>` for direct importers that resolve only through it, and declare any such import as a direct dependency.

16. **Yanked or load-bearing dependency pins**. A pinned `requirements.txt` version can be **yanked** from PyPI — pip warns `Reason for being yanked` but still installs the explicit pin — so bump to a non-yanked patch in the same minor (e.g. `transformers` 4.57.0 → 4.57.6, which preserves DINOv3). Do NOT casually bump `torch`/`torchvision`/`transformers` majors: they are load-bearing (mamba-ssm + causal-conv1d CUDA kernels are source-built against torch 2.6.0+cu124; DINOv3 needs transformers ≥4.57). Full bump = recompile kernels + re-pair torchvision + re-verify all 7 models. See memory `reference_dependency_pin_constraints`.

---

## Do NOT hand back unverified fixes

**Test comprehensively yourself BEFORE telling the user to try it.** Repeatedly shipping "should work" fixes that the user has to bounce back is the worst failure mode — it wastes their time and erodes trust. For any user-facing change, reproduce the user's exact flow end-to-end and observe the fixed behavior with your own tools (Playwright MCP + service logs + DB) before handoff.

When your test harness genuinely cannot exercise a path (e.g. the injected-token Playwright session has an **unstable WebSocket** — it flaps connect/disconnect and triggers an abort storm that cancels in-flight fetches, so WS-completion-driven editor refreshes can't be observed), do NOT hand back and hope. Instead: (a) make the fix **not depend on the unverifiable path** (e.g. a background HTTP poll with a non-cancellable final fetch, independent of the WebSocket), then (b) verify THAT path, which the harness can exercise. Only escalate to the user once you have observed the fix working.

## Commands

**Docker-first project. Never run npm/node directly on the host — use `make` targets or container shells.**

### Daily development

```bash
make up                          # Start all services (FE :3000, BE :3001, ML :8000)
make down                        # Stop services
make logs-f                      # Tail all logs
make health                      # Health check
make shell-fe / shell-be / shell-ml  # Container shells
```

### Code quality (runs on host)

```bash
make ci                          # Full local CI gate: TS + ESLint(0) + i18n. ~30 s.
make ci-test                     # Vitest run (currently 31% broken — informational only)
npx tsc --noEmit                 # Frontend type check
make lint                        # ESLint in Docker
```

### Database (inside `make shell-be`)

```bash
npx prisma migrate dev --name <name>     # Dev migration (creates file)
npx prisma migrate deploy                # Production migration (applies existing file)
npx prisma generate
npx prisma studio                        # Visual DB browser
```

### Building (always optimized)

```bash
make build-optimized                     # Smart build with auto-cleanup
make build-service SERVICE=frontend      # Build single service
make build-clean                         # Full no-cache rebuild
```

### Production (single-stack, post-2026-05-15)

Blue-green is gone (see memory `project_blue_green_removal_2026_05_15`). Deploy is just a rebuild + recreate of the affected services:

```bash
# 1. Build the changed services
make build-service SERVICE=backend                     # or frontend / ml
# 2. Recreate (no need to stop the others)
docker compose -f docker-compose.production.yml \
  --env-file .env.production \
  up -d --no-deps --force-recreate backend             # repeat with frontend / ml
# 3. Flush nginx upstream DNS cache after a backend recreate
docker restart spheroseg-nginx
# 4. Verify
curl https://spherosegapp.utia.cas.cz/health           # → "production-healthy"
```

`make prod` rebuilds and recreates everything; useful for big changes but unnecessary for service-scoped updates.

There are no longer `scripts/deploy-production.sh` / `rollback-deployment.sh` / `migrate-database.sh` etc. — those orchestrated blue↔green switching that doesn't exist now.

| Service     | Production      | Dev  |
| ----------- | --------------- | ---- |
| nginx (SSL) | 80/443          | —    |
| Frontend    | 4000            | 3000 |
| Backend     | 4001            | 3001 |
| ML          | 4008            | 8000 |
| PostgreSQL  | 5432 (internal) | 5432 |
| Redis       | 6379 (internal) | 6379 |

---

## Tech Stack

| Layer      | Technology                                                                            |
| ---------- | ------------------------------------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Vite + shadcn/ui (Radix + Tailwind)                           |
| Backend    | Node.js + Express + TypeScript + Prisma                                               |
| ML Service | Python + FastAPI + PyTorch (HRNet, CBAM-ResUNet, U-Net, Sperm, Wound, Microtubule v7) |
| Database   | PostgreSQL (dev + prod via Docker compose)                                            |
| Real-time  | Socket.io with auto-reconnect + exponential backoff                                   |
| Auth       | JWT access + refresh tokens                                                           |
| i18n       | 6 languages (EN, CS, ES, DE, FR, ZH) via i18next                                      |

---

## Architecture (skim level — read `docs/architecture/` for depth)

### Frontend state

- **Server state**: React Query (TanStack) with optimistic updates + query invalidation.
- **Client state**: React Contexts — Auth, Theme, Language, WebSocket, Upload, Export, Model, ImageDisplayContext.
- **Real-time**: Socket.io events (`segmentationStatus`, `segmentationCompleted/Failed`, `queueStats`).

### Segmentation editor (`/src/pages/segmentation/`)

Most complex feature in the repo (~51 KB orchestrator). Key files:

- `SegmentationEditor.tsx` — top-level orchestrator
- `useEnhancedSegmentationEditor` — core state (polygons, selection, undo/redo, transforms)
- `useAdvancedInteractions` — mouse/keyboard, polygon creation, vertex editing
- `EditMode` enum — state machine: `View | EditVertices | Slice | AddPoints | DeletePolygon | CreatePolygon | CreatePolyline`
- `Polygon` model — closed polygons (`geometry: 'polygon'`) + open polylines (`geometry: 'polyline'`) with optional `partClass` + `instanceId` (sperm) or `trackId` + `_embedding` (microtubule cross-frame tracking). UI state (hide/select/rename) keys on `polygonKey(p) = p.trackId ?? p.id` so it survives frame scrubs — branded `PolygonKey` type for compile-time safety.
- Canvas layers: `CanvasPolygon` (per-polygon, React.memo with custom comparator), `CanvasVertex`, `CanvasTemporaryGeometryLayer`
- Toolbars: `TopToolbar` carries Undo / Redo / **Resegment** (multi-channel videos open `SegmentChannelDialog` first) / Save. `VerticalToolbar` is left rail with edit-mode buttons + zoom + reset only — no resegment there since PR #195.
- Frame slider in `EditorHeader` uses 3-effect choreography in `SegmentationEditor` (seed + observation + reverse-sync with ref-tracked `lastSeededIdx`) — required on multi-hundred-frame videos to prevent oscillation. See memory `project_frame_slider_race_pattern`.

### Backend (`/backend/`)

```
Controllers → Services → Prisma ORM → Storage (local FS / S3)
```

- API routes: `/backend/src/api/routes/`, Swagger at `:3001/api-docs`
- Queue: `SegmentationQueue` model, controller `queueController.ts`, supports 10 000 imgs/batch
- Export: COCO / YOLO / JSON in `/backend/src/services/export/`

### ML service (`/backend/segmentation/`)

- FastAPI + PyTorch, CUDA with CPU fallback
- Models: HRNet (~200 ms), CBAM-ResUNet (~400 ms), U-Net (~200 ms), Sperm, Microtubule v7 (DINOv3-L + DPT + PySOAX, ~8 s/frame)
- Weights from Google Drive; `make check-weights`. Microtubule v7: `scripts/download-microtubule-weights.sh` + `HF_TOKEN` for DINOv3 backbone.
- Cross-frame routes: `/api/v1/track` (Hungarian matching on 32-d embeddings) + `/api/v1/kymograph` (line-profile + viridis) in `api/tracker_kymograph.py`.

### Video projects

- Video container = one `Image` row with `isVideoContainer=true` + `channels` JSON. Each frame is a child `Image` row with `parentVideoId` + `frameIndex` + `displayOrder`. Containers are never enqueued.
- Formats: MP4 / AVI / MOV / MKV / WebM (ffmpeg-static), multi-page TIFF (`tifffile`), Nikon ND2 (`nd2`).
- Storage: `projects/<pid>/images/<videoId>/{original.ext, thumbnail.jpg, frames/NNNN/<channel>.png, ...}`.
- Channels: ND2 + TIFF expose per-channel PNGs. IRM auto-detected by name (IRM / BF / DIC / TL). Segmentation uses the channel marked `isSegmentationSource=true`.
- Cross-frame MT tracking: auto-triggers when all frames reach `'segmented'`. `trackerService.ts` POSTs to ML `/track`, patches `trackId` into `Segmentation.polygons`.
- Queue fairness: `getBatchItems` deprioritizes users recently processed so a 200-frame video can't monopolize.

### Key shared libraries (`/src/lib/`)

- `api.ts` — Axios client with JWT interceptors, token refresh, retry
- `polygonGeometry.ts` — area, perimeter, point-in-polygon, vertex ops (don't duplicate)
- `segmentation.ts` — `Polygon` + `Point` types
- `metricCalculations.ts` (under `pages/segmentation/utils/`) — Feret diameter, polyline length, ImageJ-convention perimeter
- `constants.ts` — timeouts, retry, WebSocket event names

---

## Code Conventions

### Pre-commit (Husky)

`.husky/pre-commit` validates every commit:

- No `console.log` / `debugger`
- ESLint **0 warnings** (strict)
- Prettier formatting
- Frontend + backend TypeScript check
- Conventional commits required (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`)
- Direct commits to `main` blocked — use feature branches + PRs

### i18n

All user-facing strings must exist in all 6 translation files (`/src/translations/{en,cs,es,de,fr,zh}.ts`). Validate: `node scripts/check-i18n.cjs`.

### React patterns in this codebase

- **React.memo with custom comparators** — used heavily in canvas (`CanvasPolygon`, `CanvasVertex`). When adding props, update the comparator. Missed comparator entries are a recurring bug.
- **`useCallback` / `useMemo` stability** — parent callbacks passed to memoized children must be stable. Arrays passed for reference-equality need stabilized refs (see `availableInstanceIds` two-stage memo pattern).
- **`editor.getPolygons()`** — use this (reads latest ref) instead of `editor.polygons` (closure snapshot) when updating polygons from event handlers.

### CI surface

GitHub Actions is intentionally minimal (4 chronically-broken workflows were removed in PR #161):

- `codeql.yml` — passive security scanning (Security tab)
- `nightly-drift.yml` — daily TS/ESLint/i18n + npm audit on `main`; opens labelled issue on failure, doesn't block PRs
- GitGuardian App — secret leak detection

The real PR gate is local: pre-commit hook + `make ci` + Playwright verification + manual review.

---

## Deploy Gotchas

- **Production migrations use `prisma migrate deploy`**, never `migrate dev` (dev creates new files; deploy applies existing ones to a live DB).
- **Bind-mounted configs need `--force-recreate`**, not just `nginx -s reload`. `sed -i` rewrites the inode; the running container holds the old one. Use `docker compose up -d --no-deps --force-recreate <service>`.
- **HF cache bind-mount** (`backend/segmentation/.hf-cache`) must exist with `chown 999:999` before the ML container starts.
- **Upload limits coupled across 3 layers** — images 20 MB (`FILE_LIMITS.MAX_FILE_SIZE_BYTES` + image multer + nginx). Videos/ND2 100 GB (`MAX_VIDEO_FILE_SIZE_BYTES` + separate `videoUpload` multer + `client_max_body_size 100G`). The smallest wins.
- **`HF_TOKEN`** required for first microtubule load (DINOv3 backbone, ~1.1 GB). Lives in `.env.production` (gitignored).
- **Always `--env-file .env.production`** when running `docker compose` against production. Without it, env vars silently empty.
- **After backend `--force-recreate`, restart nginx too** — DNS cache pins old container IP.
- **Volume names still carry `_blue_data` suffix** (postgres_blue_data, redis_blue_data). Cosmetic-only — internal Docker identifiers, never user-facing. Renaming requires manual volume copy; not worth the downtime for "spheroseg_data" prettiness.
- **Upload directory still mounted from `./backend/uploads/blue`** on host, but container sees neutral `/app/uploads`. 17 GB of production data lives there; renaming the host path would need `docker compose down` + `mv` + remount. Same trade-off as volume names.
- **DB password literal `spheroseg_blue_2024`** is a fixed credential string (NOT a DB name reference). Database itself is `spheroseg` since 2026-05-15. Rotating the password means changing the live user's `PG_PASSWORD` first.

---

## Email

UTIA mail server (`hermes.utia.cas.cz:25`, STARTTLS, no auth). 2-10 min delays are normal (background queue). Config in `.env.production`.

---

## Documentation Index

| Topic                          | File                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture overview          | [`docs/architecture/README.md`](docs/architecture/README.md)                                                                                                            |
| Frontend architecture          | [`docs/architecture/frontend.md`](docs/architecture/frontend.md)                                                                                                        |
| Backend architecture           | [`docs/architecture/backend.md`](docs/architecture/backend.md)                                                                                                          |
| ML service                     | [`docs/architecture/ml-service.md`](docs/architecture/ml-service.md)                                                                                                    |
| Database schema                | [`docs/reference/database-schema.md`](docs/reference/database-schema.md)                                                                                                |
| Testing guide                  | [`docs/testing-guide.md`](docs/testing-guide.md)                                                                                                                        |
| i18n guide                     | [`docs/i18n-guide.md`](docs/i18n-guide.md)                                                                                                                              |
| Git hooks                      | [`docs/hooks-guide.md`](docs/hooks-guide.md)                                                                                                                            |
| API documentation              | [`docs/api/README.md`](docs/api/README.md)                                                                                                                              |
| Getting started                | [`docs/development/getting-started.md`](docs/development/getting-started.md)                                                                                            |
| Polygon rendering optimization | [`docs/polygon-rendering-optimization.md`](docs/polygon-rendering-optimization.md) _(aspirational — describes files that don't exist; active render is naive `.map()`)_ |
