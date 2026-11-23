# Verification rules in full

What a change must show before it counts as done, per change category.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

### The non-negotiable rule

**"Done" is not "TypeScript compiles + ESLint clean".** Production bugs in this repo have repeatedly shipped despite green pre-commit because:

- Types prove "compiles", not "behaves correctly".
- Lint proves "follows rules", not "logic is right".
- Vitest passing on isolated mocks proves nothing about real data.
- The production-build minified bundle behaves differently than the dev server.

**A change is "done" only when the runtime path that uses it has been observed working.** For user-facing changes, that means a real browser. For API changes, a real curl. For DB changes, a real query. No exceptions.

### The test account — there is no excuse for stopping at the login page

Production has a dedicated verification account. Credentials live OUTSIDE every
repo, in `~/.claude/spheroseg-e2e-account.txt` (mode 600):

```
email: claude.e2e.test@example.com
```

Sign-up is open and e-mail verification is off, so a fresh account can be
created the same way if that one is ever removed. Use it for every browser
check; never verify against the user's own account or data.

If the flow needs data the account does not have, MAKE the data rather than
handing the check back: create a project, and synthesise an input. A multi-page
16-bit TIFF is accepted as a video and is enough to exercise the multi-channel
editor —

```python
import numpy as np, tifffile
tifffile.imwrite('stack.tif', np.stack([...]), photometric='minisblack')
```

Playwright can only upload from inside the repo root, so stage the file in
`.playwright-mcp/` first.

This section exists because the rule above it was ignored for a whole session:
a decode pipeline was rewritten, measured in Node, deployed, and handed over —
and the user opened the editor to a console full of 404s that one
`browser_console_messages` call would have shown. Server logs, unit tests and
`curl` all looked clean. None of them run the app.

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

**A field present in the DATABASE proves nothing about the API.** The ML → DB
write path does not go through `PolygonValidator`; both `parsePolygonData` call
sites are READS, and `validateSinglePolygon` builds its output from the
`OPTIONAL_POLYGON_FIELDS` whitelist. So an unregistered field survives in
postgres, is stripped on the way OUT to the editor, and the editor's next save
writes the loss back. `class` did exactly that until 2026-09-04, and
`metricsCalculator` splits microcapsule membranes from capsules on it — a
stripped `class` silently doubles every microcapsule export row.

Diagnose by curling the endpoint, not by querying the table. The tell-tale data
signature is a field present on every row EXCEPT the ones a user has edited.

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
