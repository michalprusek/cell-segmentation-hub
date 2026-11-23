# Production failure patterns

Numbered patterns that shipped to production; code comments cite them by number, keep the numbering.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

Each of these shipped to production at least once in 2026 despite green pre-commit. Recognize and proactively check:

1. **Field-missing-from-API-response**. Backend forgot to expose a field; FE renders empty/null. Check: `curl` the endpoint and assert field present.

2. **FE mapper strips field**. Backend exposes field, but a `useProjectData`-style mapper drops it before it reaches components. Check: `browser_evaluate` on React Query state, not just the controller.

3. **SyntheticEvent as first arg**. `onClick={handleX}` passes a React SyntheticEvent as the first argument, so `handleX(opt?: string)` treats the event as `opt`. Check: `typeof arg === 'string'` in handlers + Playwright click test.

4. **Per-inference randomness claimed stable**. Claiming an ID is preserved across frames when it's `uuid.uuid4()` per call. Check: read the model code (`backend/segmentation/ml/model_loader.py`) before claiming behavior; for cross-frame stability use `trackId` (written by tracker), not `instanceId`.

5. **Incomplete React.memo comparator**. Adding a new prop to a memoized component but forgetting to compare it; component never re-renders on prop change. Check: when touching a `React.memo` component's props, always update the comparator (`CanvasPolygon.tsx:387` style).

6. **Build succeeds but bundle breaks**. ESLint/TS clean, but `make build-service SERVICE=frontend` fails on minification or chunk split, or the minified code behaves differently. Check: run the production build locally + open the production preview.

7. **Migration runs but column is wrong type**. Prisma migration creates an Int4 where the FE will eventually push a number > 2³¹. Check: schema after migration + a real overflow value.

8. **Nginx upstream DNS cache**. Backend recreated; nginx still points at old container IP → 502s. Check: after a backend `--force-recreate`, also restart nginx.

9. **Docker compose without `--env-file`**. Env vars (e.g. `PG_PASSWORD`, `JWT_SECRET`) silently empty in the container. Check: `docker exec ... env | grep <VAR>` after recreate.

10. **Queue worker stuck on `isProcessing=true`**. ML recreate during an in-flight axios POST leaves the backend in a deadlock state. Check: tail backend logs after deploy; if no progress, restart backend.

11. **TDZ on useCallback referencing a later `const`**. New `useCallback` / `useMemo` / `useEffect` placed BEFORE a `const x = ...` it captures in its deps array (or body) throws `Cannot access '<single letter>' before initialization` at runtime — TS doesn't catch it because the component body looks like a flat scope. Production minified bundle shows the error as a single letter (`'A'`, `'b'`). Check: when reordering hooks in `SegmentationEditor.tsx`, ensure any hook that touches `video.*`, `editor.*`, `selectedImage.*` is placed AFTER the corresponding `const video = ...`, etc.

12. **Frame slider seed/reverse-sync race**. `useVideoFrames` defaults `frameIndex=0`. If reverse-sync (frameIndex→URL) fires before seed (URL→frameIndex) propagates a `setFrameIndex(N)`, the URL flips to `frames[0]` and oscillates with seed at ~7 Hz on multi-hundred-frame videos. Check: tests on a 600+-frame video; the editor must converge within 1-2 render commits. Pattern: 3-effect choreography with ref-tracked seed marker — see memory `project_frame_slider_race_pattern`.

13. **Editor doesn't refresh after resegment (same-count)**. The editor's polygon-sync effect in `useEnhancedSegmentationEditor.tsx` only pulls new data into the canvas when the polygon **count** or `imageId` changes. A resegment usually returns the **same count** with new geometry, so a reload (`setSegmentationPolygons`) updates page state but the canvas keeps the stale polygons. Fix pattern: a `reloadNonce` that increments on every reload and is part of the sync effect's `isNewData`. Also: the WebSocket completion event is NOT a dependable refresh trigger (it can silently not reach `handleSegmentationStatusUpdate`); a resegment must have a non-WS path (background poll on `getSegmentationResults().updatedAt`) to reload + show the success toast on completion. Check: delete a polygon → resegment → the new polygon must reappear AND the success toast fire WITHOUT a manual F5.

14. **Removing an npm dep breaks the prod build via `vite.config.ts`**. Dropping a package from `package.json` (or via `npm audit fix`) passes locally — it lingers in `node_modules` — AND passes CI, because the FE `npx tsc --noEmit` is **vacuous** (root `tsconfig.json` is `files: []` + project references → it type-checks nothing; Vite doesn't type-check either). But the production `vite build` fails with `Could not resolve entry module 'X'` when `X` is still named in `manualChunks` / `optimizeDeps`. Check: when removing a dep, grep the build config too (`vite.config.ts`, `tailwind.config.ts`) — not just `src/` — and run `make build-service SERVICE=frontend` before claiming done. (Caught `cmdk`/`vaul`/`input-otp` left in `manualChunks`, 2026-06-17.)

15. **Phantom (transitive-only) dependency**. A package imported directly in code but absent from `package.json`, satisfied only transitively via another dep. Removing that parent (e.g. `bull`) drops the phantom (`ioredis`, imported directly by `healthCheckService.ts`) from a fresh `npm ci` → the service crash-loops at startup (`ERR_MODULE_NOT_FOUND`). The host `node_modules` still has it, so `make ci` and a local run pass; only a fresh-install Docker build/deploy catches it. Check: before removing a package, `npm ls <suspect>` for direct importers that resolve only through it, and declare any such import as a direct dependency.

16. **Yanked or load-bearing dependency pins**. A pinned `requirements.txt` version can be **yanked** from PyPI — pip warns `Reason for being yanked` but still installs the explicit pin. `torch==2.6.0` / `torchvision==0.21.0` / `numpy==1.26.4` are load-bearing: mamba-ssm + causal-conv1d ship CUDA kernels source-built against torch 2.6.0+cu124, and numpy is what that torch was built against. **`transformers` is pinned at 5.5.4 and the ceiling was re-measured 2026-09-04 — it is 5.9.0, not the 5.16.1 the old comment claimed.** 5.6.2 / 5.7.0 / 5.8.1 are clean and bit-identical; **5.9.0** renames the SegFormer state-dict layout (`segformer.encoder.block.N.M` → `stages.N.blocks.M`, `attention.self.{query,key,value}` → `{q,k,v}_proj`, …) so the checkpoint stops loading; **5.10.x will not even import** on torch 2.6.0 (it evaluates `torch.float8_e8m0fnu` at module scope, and pip cannot warn because transformers declares `torch>=2.5` only under `extra == "torch"`). The HIGH advisory GHSA-xrqw-3rrv-vx5w fixes in 5.10.0 and therefore **cannot be taken** — it is also unreachable here: `grep -rn save_pretrained backend/` has no Python call site. **`opencv-python-headless` and `ml_dtypes` are `ResolutionImpossible` against numpy 1.26.4** (opencv's wall is 4.12, a wheel BUILD property, so there is no intermediate release) and both are Dependabot-ignored. Guarded by `backend/essays/tests/test_transformers_pin.py`. See memory `reference_dependency_pin_constraints`.

17. **Cross-frame MT identity is geometric since v5H (2026-08-17).** The model no longer emits 32-d embeddings; `/api/v1/track` matches on symmetric curve distance plus an overlap gate, with common-mode stage drift removed by normal-flow least squares. A `trackId` regression therefore shows up as a _geometry_ problem — gate too tight, drift misestimated on a field of parallel filaments — not a decode problem. Check `api/mt_geometry_cost.py` first. **There is no hard gate any more.** `GATE_MAX_SHIFT` was removed in the same series that added the geometry (it fragmented tracks 3.14x) and is now `CURVE_SCALE_PX` — a saturation _scale_, not a rejection threshold: a pair beyond it is expensive, never `inf`. The only surviving `inf` is geometry too degenerate to compare (a centerline with fewer than two points), where a distance of 0 would otherwise read as a perfect match. `GATE_MIN_OVERLAP`, `OVERLAP_TOL` and `overlap_fraction` still exist in that file and are still tested, but the tracker **does not import them** — as a hard gate overlap caused the fragmentation, and folded in as a cost term it measured no better while doubling wall-clock, because it rebuilds cKDTrees `curve_distance` has already built. They are kept as a geometry primitive for a possible future use (splitting a merged detection), so treat them as a library, not as something in the matching path: tuning them changes nothing. The request's `embedding` and `emb_template_alpha` fields are accepted-and-ignored, and `corrupt_count` / `degraded` are pinned to `0` / `false`; rows written by v7 still carry an `_embedding` and `extra="forbid"` would 400 them otherwise.

18. **`process.env` in a browser bundle blanks the page.** There is no `process` global in the browser, and Vite only substitutes the literal text `process.env.NODE_ENV` — so a `process.env.VITE_*` read survives into the served module and throws `ReferenceError: process is not defined` while the enclosing object literal is evaluated. That takes the whole module down, and with it everything importing it; the dev server rendered a blank page. Production escaped only because rollup tree-shook the offending object out of the bundle entirely, so one new import of it would have shipped the crash. Use `import.meta.env` in `src/` — `import.meta.env.MODE` is the exact equivalent of a NODE_ENV compare ('development' under `vite dev`, 'production' under `vite build`, 'test' under vitest). Live readers today are `services/webSocketManager.ts` and `components/DashboardHeader.tsx`. (This note used to live in `src/lib/constants.ts`, which no longer reads env at all.)

19. **A test that defines its own subject.** `webSocketService.cancel.test.ts` declared `class WebSocketService` at line 172 **of the test file**, with `emitOperationCancelled` / `emitExportCancelled` / `emitCancelError` — none of which exist in the real service — and imported nothing from this repo. `queueCancel.test.ts` was headed _"Mock Express App for Testing (TDD - to be implemented)"_ and defined its endpoint in-file, for a route that has never existed. Six such shadow suites were found (2026-09-04), 195 tests, ~4 000 lines, green forever, measuring nothing; deleting them **raised** coverage. The proof they were worthless: breaking the real cancel button turned its real test red twice while a 23-test shadow — including one named _"should call onCancel when clicked"_ — stayed fully green. Check: **does the test file import the thing it claims to test?**

20. **`async def` on a single-worker uvicorn blocks everything.** `/mt-metrics` and `/mt-background-rois` were `async def` doing CPU work on a `--workers 1` server, so a 24-minute export blocked `/segment`, `/track`, `/kymograph` **and the compose healthcheck's `/health`** for its whole duration (measured: `/health` 9.84 s → 0.02 s after the fix). The obvious fix is worse: plain `def` hands the route to Starlette's 40-slot threadpool, and each slot calls a 3.4 GB `_load_volume` — that is an OOM, not a fix. Use a **one-slot executor**, the pattern `/kymograph` already uses.

21. **A generated baseline file hides the error it is regenerated over.** `typecheck-baseline.json` and `eslint-baseline.json` record tolerated problems; re-running `npm run type-check:update` after a conflict silently accepts anything new. When you must regenerate, **diff the result against both parents** and account for every entry that appears in neither. On 2026-09-04 all five such entries turned out to be pre-existing errors whose message text changed because `AuthContextType` gained `isAdmin` — but the total was FALLING (1649 → 1608), so a genuinely new error would have been invisible.

22. **A stale Prisma client makes the host TS check lie.** After any `schema.prisma` change, `npx tsc` on the host reports `Property 'x' does not exist` until the client is regenerated — and `npx prisma generate` **fails on the host** (`EACCES: permission denied, unlink .prisma/client/index.d.ts`) because `backend/node_modules` is root-owned, written by the containers. Regenerate through the container:

    ```bash
    docker run --rm --user root --entrypoint /bin/sh \
      -v $PWD/backend:/app -w /app cell-segmentation-hub-backend -c "npx prisma generate"
    ```

    Same root cause makes `cp -al node_modules` fail silently for a non-root user (`fs.protected_hardlinks=1`): it creates the directory tree and **zero files**.

23. **Start-up code that needs something a migration creates.** Anything on
    the server's start-up path that reads a table — a worker re-queuing its
    interrupted work, a cache warm-up — turns "the migration has not run yet"
    from a failing endpoint into a server that cannot start. Two rules, both
    learned from the 2026-10-06 outage described under
    [Production](../../CLAUDE.md#production-single-stack-post-2026-05-15): migrate before
    recreating, and keep optional subsystems out of the critical start-up
    `try` (the job worker's `startJobWorker` now touches no database at all;
    its recovery runs in the first tick, where a failure is logged and
    retried).
