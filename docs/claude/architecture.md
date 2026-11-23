# Architecture notes

Hard-won subsystem notes: frontend state, per-project model, editor, backend, sessions, public API, ML service, essays worker, video projects, shared libraries.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

### Frontend state

- **Server state**: React Query (TanStack) with optimistic updates + query invalidation.
- **Client state**: React Contexts — Auth, Theme, Language, WebSocket, Upload, Export, Model, ImageDisplayContext. `ModelContext` is down to `detectHoles` alone (see below).
- **Real-time**: Socket.io events (`segmentationStatus`, `segmentationCompleted/Failed`, `queueStats`).

### The segmentation model belongs to the PROJECT (since 2026-09-20, PRs #553/#554)

It used to be one per-user value in `localStorage`, chosen in Settings → Models
and shown as a badge in the header. Both of those are **gone**: there is no
models tab (`?tab=models` falls back to the profile tab), and the header shows
only a bare ML-status dot.

- **`projects.segmentationModel`**, nullable. `NULL` means "follow the type's
  default" and is **never backfilled** — a backfill would freeze today's
  default into every row. Resolve it with `resolveProjectModel()`, which also
  falls back when the stored value is stale (a type change strands it, and a
  model can leave the registry).
- **`DEFAULT_MODEL_BY_PROJECT_TYPE`** in BOTH registry SSOTs picks the most
  ACCURATE compatible model, not the fastest: `spheroid` → `segformer` on
  93 % IoU. Parity between the two copies is enforced by
  `scripts/verify-shared-types.cjs`, NOT by either side's own unit test. It
  runs as step 9 of `make ci`, in the `frontend` job of `ci.yml`, and from
  lint-staged when either `modelRegistry.ts` is staged. **Until 2026-10-06 it
  ran only from lint-staged and only for files under `types/`**, so editing
  the registry — where the map lives — triggered nothing; and
  `scripts/check-model-parity.cjs` (model-id sets across both TS registries,
  Python `AVAILABLE_MODELS` and the `ModelType` enum; ids only) was run by
  nothing at all while three documents said it guarded them. It is now step 8
  of `make ci` and a step of the same CI job. Both gates were mutation-tested
  on a scratch copy: dropping an id from any one of the four sources, or
  changing one default in either copy, exits 1.
- **Only `spheroid` (5 models), `sperm` (2: `sperm`, the default, and
  `sperm_2part` — head + tail, no midpiece; PR #566) and `neurite` (2:
  `neurite_soma`, the default, and `neurite_soma_merged`) have a real
  choice**; the other four project types have exactly one each, so their
  picker is a single disabled row.
- **The server must read the column too.** It shipped once with
  `resolveProjectModel` having zero backend call sites and a docstring claiming
  otherwise, while the queue defaulted to `'hrnet'` — a model compatible with
  exactly one of the seven types. Both enqueue paths now resolve from the
  project, and a `model` in the request body is honoured **only for the owner**.
- **Hole detection is offered on `spheroid` and `wound` only**
  (`PROJECT_TYPES_WITH_HOLE_DETECTION`). Elsewhere the request carries the
  default `true`, normalised on both sides by `resolveDetectHoles` — a
  parameter the user cannot see must not be one they are silently subject to.
- **`projects.pixelSizeUm` is read at segmentation by `spheroid_disintegration`
  only** (2026-11-08). `requestSegmentation` sends `pixel_size_um` from the
  frame's container, else the image row, else the project
  (`services/segmentationPixelSize.ts`); the ML `/segment` resamples the frame
  to 1.28 µm/px when it is more than 2 % off and within 0.5–2×, scores it there
  and maps the mask back (`api/disintegration_scale.py`), and answers **400**
  to the field for any other model. Without a pixel size, or within 2 %,
  nothing is resized. The header shows the box for `spheroid_invasive` only:
  an ungated one was removed on 2026-09-13 because nothing read it. Changing
  the value re-runs nothing; it applies to new segmentations. **Values typed
  into that ungated box (2026-09-07 to 09-13, #501 → #541) may still be
  stored, and are now read at segmentation**: query `projects` and `images`
  of `spheroid_invasive` projects for non-null `pixelSizeUm` before deploying.
  The export's polygon fallback (an edited image) resamples ONLY with the
  pixel size its stale read-out was resampled from
  (`readStoredImageMetrics().staleResample`), else scores the uploaded grid —
  never with the image row's or the export's scale, which would put one
  edited row on a grid its unedited siblings never used. The box is
  `type="text"`: as `type="number"` a typo read as `''` and cleared the
  stored value on blur.
- **Rename / type / model are owner-only**; `verified` is not. `getProjectById`
  reports `isOwned`, and `mapProjectFields` must list it — the enumerative
  mapper stripped it on the first attempt, as it does every new field.

### Segmentation editor (`/src/pages/segmentation/`)

Most complex feature in the repo (~51 KB orchestrator). Key files:

- `SegmentationEditor.tsx` — top-level orchestrator
- `useEnhancedSegmentationEditor` — core state (polygons, selection, undo/redo, transforms)
- `useAdvancedInteractions` — mouse/keyboard, polygon creation, vertex editing
- `EditMode` enum — state machine: `View | EditVertices | Slice | AddPoints | DeletePolygon | CreatePolygon | CreatePolyline`
- `Polygon` model — closed polygons (`geometry: 'polygon'`) + open polylines (`geometry: 'polyline'`) with optional `partClass` + `instanceId` (sperm) or `trackId` + `_embedding` (microtubule cross-frame tracking). UI state (hide/select/rename) keys on `polygonKey(p) = p.trackId ?? p.id` so it survives frame scrubs — branded `PolygonKey` type for compile-time safety.
- Canvas layers: `CanvasPolygon` (per-polygon, React.memo with custom comparator), `CanvasVertex`, `CanvasTemporaryGeometryLayer`
- **Delete mode (`D`) is a scribble eraser** (2026-11-16): a press starts a stroke, every shape it touches fades (`isPendingDelete`, 20 %), the release deletes them in ONE `updatePolygons` (one undo step), Esc / right-click cancel only the stroke. Hit test: `utils/scribbleErase.ts` (Excalidraw's eraser — SEGMENT tests, because moves are rAF-coalesced; 6 screen px; a hole is hit, its parent is not). Session: `hooks/useScribbleErase.ts`, a REF, because one release reaches both the canvas `onMouseUp` and the window listener. Candidates are `visiblePolygons` — hidden shapes are never deleted. Tracked MTs go to `useDeleteTrackScope.requestDeleteMany`: one scope question for all. `CanvasPolygon` ignores clicks in this mode; the press already acted.
- Toolbars: `TopToolbar` carries Undo / Redo / **Resegment** (multi-channel videos open `SegmentChannelDialog` first) / Save. `VerticalToolbar` is left rail with edit-mode buttons + zoom + reset only — no resegment there since PR #195.
- Frame slider in `EditorHeader` uses 3-effect choreography in `SegmentationEditor` (seed + observation + reverse-sync with ref-tracked `lastSeededIdx`) — required on multi-hundred-frame videos to prevent oscillation. See memory `project_frame_slider_race_pattern`.
- **Zoom rendering (2026-10-08) — five measured facts, each of which looks like something to "optimise" back.** Measured on production data in Chrome 152 on the A5000 at DPR 1 and 2, plus Firefox 144 and WebKit 26.0 for the CSS.
  - **`CanvasContent` is one plain 2D `translate() scale()`, with NO `will-change`, `perspective`, `backfaceVisibility` or `translate3d`.** `will-change: transform` makes a zoom gesture ~10x cheaper (41 ms against 437 ms over 72 frames of 2000 polylines) by pinning the layer's raster to the scale it had when promoted — which IS the blur: applied before zooming 2 → 10, the stroke edge measured 5.05 px instead of 0.6 px. Without it Chrome re-rasters per scale change and every presented frame is sharp. `perspective` drew nothing (no child has a 3D transform) but, together with a CSS `filter` on the bitmap, bled one screen pixel across every image-pixel boundary (adjacent pixels differing 0.70–0.80 of the time at zoom 2.35–2.5 where nearest neighbour gives 0.40–0.43).
  - **The rendered translate is snapped to whole DEVICE pixels** (`utils/devicePixelSnap.ts`): `round(translate * devicePixelRatio) / devicePixelRatio`. A fractional offset makes Chrome resample the whole overlay — stroke 10–90 % edge 1.14–1.55 device px before, 0.76–0.93 after, at device scale 1, 1.25, 1.5 and 2 (0.78 is the box-filter limit of a 45° edge). **Only the translate — NOT "container centre + translate".** That was the first version and the obvious one, since the content's origin is the container's centre and that is a half pixel when the container is odd-sized; but Chrome rounds a transformed box's position by itself, so compensating put every stroke exactly between two pixels: 1.50 on a 1229×827 container, worse than not snapping. It was caught only because the measurement was repeated in a window one pixel wider. **Render only; the stored transform stays unsnapped** — pan deltas are sub-pixel and hit-testing (`src/lib/coordinateUtils.ts`) reads the state, so drawn and logical positions differ by at most half a device pixel (measured 0.40). **A fractional DPR set by DevTools/Playwright emulation is not a real 150 % display**: under emulation Chrome rounds the box to a CSS pixel, so the same build measures 0.77 in a 1600×1000 viewport and 1.56 in 1602×1002. Verify fractional scaling with `--force-device-scale-factor=1.5`, never with `deviceScaleFactor: 1.5`.
  - **The bitmap gets a CSS `filter` only when brightness or contrast differ from 100** (`utils/displayStyle.ts`). An identity `brightness(1) contrast(1)` still promotes a compositor surface: that is the other half of the bleed above, and it halved the pan frame rate on a software GPU (33 → 17 ms).
  - **"Smooth image" is `image-rendering: auto` (on, the default — CVAT's) or `pixelated` (off); never `crisp-edges`**, which Chrome accepts only from 148 and silently computes to `auto` before that, so the "sharp" mode was smooth there. It is a style on all three bitmap paths (`<img>`, the 16-bit `<canvas>`, the WebGL `<canvas>`) and must never become a `key`: on the WebGL path CSS alone gives both looks (0.26 / 0.82 adjacent-pixel difference at zoom 2.5) even though its textures are `NEAREST`, because they are sampled 1:1 into a frame-sized backing store and the magnification is the browser's. State lives in `ImageDisplayContext`, persisted per BROWSER (`spheroseg.editor.smoothImage`), untouched by Reset and by a container switch. The switch is the FIRST row of the Display card (`sidebar/DisplaySection.tsx`), on stills and videos.
  - **Overlay sizes are CSS, not props.** `SegmentationEditorLayout` writes `--overlay-px` (1/zoom) and `--overlay-stroke` on the overlay `<svg>` (`utils/overlayScale.ts`); stroke widths, the polyline hit band, vertex radii (`.overlay-dot { r: … }`) and the selection glow read them through `calc()`. So `CanvasPolygon`, `PolygonVertices` and `CanvasVertex` take **no `zoom` prop** and a zoom step re-renders none of them — do not add one back; the old `isZooming` comparator guard it needed left every size stale for the whole wheel gesture. Constant on screen from zoom 0.7 up: polygon 2 px, polyline 3 px (5 hovered), hit band 24 px (it was 60 px at zoom 10, in user units), vertex 5 px radius. The two exceptions take `zoom` as a prop of `CanvasSvgFilters`, because `stdDeviation` cannot read `var()`: `#blue-glow` (hover) and `#soma-highlight`. **Do not convert `#blue-glow` to a CSS `drop-shadow()` class** — WebKit paints no CSS filter function on an SVG child at all (0 of 255 where Chromium and Firefox paint 31), so the class would remove the hover glow in Safari; for the same reason the SELECTION glow, which is such a class, has never painted in Safari. **A circle has no `r` attribute, so its radius exists only as class `OVERLAY_DOT_CLASS` + the `.overlay-dot` rule in `src/index.css`**, and jsdom applies no stylesheet: deleting that one declaration left the whole `src/pages/segmentation` suite green with every handle at radius 0. `overlayScale.test.ts` reads the CSS as text and pins the rule to the exported names; a new circle must use the constant, not a literal. The stripes of a shared neurite (colour by soma) follow the same rule, dash included: 10 screen px per colour (`SOMA_STRIPE_DASH_PX`), where the attribute `10` was user units — 100 px at zoom 10.
  - Found on the way, by watching the DOM during a real zoom: `CanvasImage` had `onLoad` in its probe effect's deps, and `VideoFrameImage` hands it a fresh arrow per render — so **every pan or zoom step re-fetched and re-decoded a 16-bit still and showed the bare `<img>` (no window/level) for the 40–80 ms that took**: 18 wheel steps, 18 canvas → `<img>` → canvas swaps. It is a ref now. If a still flickers while zooming, look for an unstable prop in an effect's deps before looking at the compositor. The re-probe had one accidental use: it re-reported the image's size after `useSegmentationLoader` cleared it, which the load effect did on EVERY run — a status change on Resegment, a language switch — not only for a new image. With the size now reported once per `src`, a still whose row stores no width/height was drawn at the container's size until segmentation data arrived; the loader therefore clears dimensions only when `imageId` changes.

### Backend (`/backend/`)

```
Controllers → Services → Prisma ORM → Storage (local FS / S3)
```

- API routes: `/backend/src/api/routes/`, Swagger at `:3001/api-docs`
- Queue: `SegmentationQueue` model, controller `queueController.ts`, supports 10 000 imgs/batch
- Export: COCO / YOLO / JSON in `/backend/src/services/export/`
- **Admin + impersonation** (2026-09-04): `users.isAdmin`, an append-only `impersonation_logs` table, `requireAdmin` middleware, and `GET /api/admin/users` + `POST /api/admin/impersonate/:userId` + `/impersonate/stop`. Three things about it are load-bearing and non-obvious:
  - **The impersonation lives on the Redis refresh record beside `family`, NOT in the JWT.** `authService.refreshToken()` rebuilds the payload from the DB row, and the frontend refreshes every 13 minutes — so a token-only claim is silently dropped and the admin is ejected mid-session.
  - **"Stop" mints a fresh admin session** rather than restoring the old tokens: the refresh cookie is path-scoped to `/api/auth`, so the server never receives it, and stashing a copy would undo the 2026-08 work that stopped keeping raw tokens in Redis.
  - **The migration grants the flag to NOBODY**, deliberately — sign-up is open, so pinning an e-mail would hand admin to whoever registers it first. Granting is an explicit operator action: `docker exec -e ADMIN_EMAIL=... spheroseg-backend npx tsx src/db/grantAdmin.ts`.
  - `accessLogger` writes `admin@x(as:user@y)`; during impersonation `req.user` IS the target, so without this the security log attributes admin actions to the wrong person.

### Sessions, and ending them (2026-10-07)

- **A session is a Redis refresh record, keyed by SHA-256 of the token.** They
  cannot be listed per user. The `sessions` TABLE is gone (dropped by
  `20261007_drop_legacy_sessions`): nothing read it, password change used to
  set `isValid = false` on its rows — which revoked nothing — and it held
  registration refresh tokens in the clear.
- **"Sign out everywhere" is `users.sessionsValidAfter`** (`auth/sessionCutoff.ts`).
  It is checked in FOUR places and a new way of authenticating a user needs a
  fifth: `authenticate`, `optionalAuthenticate`, the WebSocket handshake (all
  by the access token's `iatMs`) and `authService.refreshToken` (by the
  PRESENTED refresh record's `createdAt`, judged AFTER the rotation against
  the user row read after it — a check made before the rotation can be stale
  by the time the successor is written). An impersonated session is exempt
  everywhere. Open sockets are closed too (`services/liveConnections.ts`); the
  frontend already reconnects on `io server disconnect`.
- **The cut-off is exact to the millisecond**, which is why access tokens
  carry `iatMs` beside the standard whole-second `iat`: a password change and
  the replacement session it issues share a second. A token without `iatMs`
  falls back to the START of its second — revoked too eagerly, never kept too
  long.
- **Refresh rotation is idempotent, not exclusive** (`sessionService.rotateRefreshToken`).
  The successor is `HMAC(JWT_REFRESH_SECRET, 'rotate:' + oldToken)`, so any
  number of concurrent rotations of one token agree on one successor and the
  session cannot fork — and the grace-period replay (30 s, Okta's default)
  can hand the same token out again without it ever being stored. A replay
  AFTER the grace period is reuse and revokes the whole session by setting a
  `refresh-revoked:<family>` FLAG that every verify and rotate checks — not a
  pointer to "the family's current token", which was the first design and
  races (a delayed A→B rotation can write its pointer after B→C has, so the
  revocation deletes a key that is already gone and C lives on). The used
  marker lives as long as the session can (7 / 30 days), not 24 h: a copy
  replayed on day two must still be recognised. Do not "improve" this with a `SET NX` claim: it
  was tried, mutation testing showed it changed no outcome, and after a crash
  between claim and store it reads the owner's retry as theft.
- **A login refresh token carries a random `jti`.** Without it the JWT is a
  function of (user, second, lifetime): two logins in one second got the
  identical string and shared a session, and the session re-issued by a
  password change could be the very token of one it was ending. Found only
  over real HTTP — a fake clock in a unit test either always or never
  collides.
- **`rememberMe` lives on the refresh record** and is carried across rotation
  like `family`. The refresh controller used to pass `true`, which made every
  session a 30-day one 13 minutes after login.
- **Account deletion removes files by PROJECT, never by folder**
  (`services/accountFiles.ts`). An upload is stored under
  `<uploaderId>/<projectId>/`, and projects are shared, so `rm -r <userId>/`
  would destroy other people's images. Deleting a single PROJECT goes through
  the same module (`collectProjectFiles`) — until 2026-10-07 it removed the
  rows and left every still image on disk. The file list is written to
  `<UPLOAD_DIR>/.pending-cleanup/` BEFORE the rows are deleted and removed
  only when every file went; `sweepPendingCleanups` (start-up and every 10
  min) finishes what a restart interrupted. **The sweeper acts on a list only
  when its owner ROW is gone** — a list can exist for a live project if the
  process died between writing it and deleting the rows, and acting on the
  list alone would delete that project's images.
- **`AuthContext.deleteAccount` must not touch the global `loading` flag.**
  `ProtectedRoute` renders a spinner in place of the page while it is set, which
  unmounted Settings and took the dialog and its error message with it. Found
  in a browser on the first run after the route existed; no unit test saw it
  until one recorded every rendered value of `loading` rather than the last.
- `DELETE /api/auth/profile` and `POST /api/auth/change-password` are refused
  to an impersonated session, like minting API keys.

### Public API (`/api/v1`) and API keys (2026-10-06)

`backend/src/api/v1/` is a second, self-contained surface for scripts. It
shares nothing with the app's routes except the database:

- **Auth is `authenticateApiKey`, never `authenticate`.** `Authorization:
Bearer sseg_…` only. A key in the query string is refused with 400 rather
  than ignored, because `accessLogger` writes full URLs; the session cookie is
  not consulted, because cookie auth here has no CSRF token. Conversely
  `/api/api-keys` (create / list / revoke, used by Settings → API) takes the
  cookie and must **not** accept a key — a leaked key could then mint its own
  replacements. Minting and revoking are also refused to an impersonated
  session, or support could leave behind a credential that outlives it.
- **Errors are RFC 9457 `application/problem+json`, via `sendProblem`.** Never
  `ResponseHelper` — its defaults are Czech and its envelope is the app's. And
  never `res.json` for a problem: `server.ts` wraps `res.json` to force
  `application/json`, which silently replaces the media type. The router ends
  in its own 404 and error handler so nothing falls through to the global ones.
- **The key is never stored.** `api_keys.keyHash` is an unsalted SHA-256 (the
  key is 256 random bits; same reasoning as the refresh-token key). The CRC-32
  suffix only lets a mistyped key be refused without a database read — it is
  not a security control. Revoking deletes the row.
- **A key-authenticated `req.user` has `isAdmin: false` whatever the account
  is**, and `req.apiKey` set. `accessLogger` writes `user@x(key:sseg_AbCd)`.
- **`POST /api/v1/segment` is stateless** — one image in, one result out, no
  `Image` row, no project. It therefore cannot use
  `SegmentationService.requestSegmentation` (welded to an `Image` row) and has
  its own `mlClient.ts`: ONE inference at a time process-wide with a bounded
  queue, because the ML service serialises everything anyway and more
  parallelism here would only let the API jump the app's own queue.
- **A parameter a model does not read is REFUSED (422), never dropped.**
  `v1/models.ts` records, per model, what
  `segmentation/api/routes.py::_dispatch_inference` does with `threshold` and
  `detect_holes` (six models ignore the first, eight read the second). Those
  flags are facts about the dispatch; change them only together with it.
  `openapi.test.ts` pins both lists.
- **Objects own their holes.** The ML service returns a flat list where a
  hole — and an island inside that hole — are siblings typed `internal`.
  `v1/objects.ts` rebuilds the tree: even depth is an object, odd depth a
  hole. Every output format is rendered from that one model.
- **The label rasteriser's reference is OpenCV**, because the polygons are
  `cv2.findContours` output: a region is its interior AND its outline, a hole
  only its strict interior. `raster.test.ts` requires the round trip
  mask → OpenCV contours → rasterise to return the mask pixel for pixel, on
  fixtures regenerated by the script beside them. A textbook half-open fill
  erodes every object by half a pixel.
- **Mask outputs are written by hand-rolled 16-bit PNG/TIFF encoders**, not
  `sharp` — the same 16-bit hazard `imageService` documents. Always 16-bit,
  so the pixel type never depends on the object count.
- **The OpenAPI document is generated from the code's constants**
  (`v1/openapi.ts`) and `docs/api/public-v1.md` is checked against them by
  `docs.test.ts`, which is SKIPPED when only `backend/` is mounted — it needs
  the repo root.
- **Jobs (`/api/v1/jobs`, table `api_jobs`, files under
  `<UPLOAD_DIR>/api-jobs/<id>/`) are a separate mechanism from
  `SegmentationQueue`**, which has hard foreign keys to `Image` and `Project`
  and cannot hold a stateless job. `jobs/worker.ts` runs in the backend
  process, ONE image per tick, through the same single-slot `mlClient` as
  `/segment` — so jobs add no parallelism. Fairness is `ORDER BY updatedAt`:
  processing an image touches its job, so waiting jobs take turns.
- **A job stores the model's result, not a rendering.** `output_format` is
  chosen at `GET /jobs/:id/results/:index`; it is not a field of `POST /jobs`.
- **The worker is the only writer of `items`.** A request never rewrites it:
  cancel sets `cancelRequested` (its own column) and the next tick acts on
  it; DELETE removes the row and the worker notices its save found nothing.
- **Idempotency is decided by the unique index** `(userId, idempotencyKey)`,
  in the `P2002` handler — there is no look-up-first step, so a retry and two
  racing requests take the same path. "Same request" includes a SHA-256 of
  every uploaded file.
- **`spheroid_disintegration` keeps the synchronous pixel ceiling in a job**
  (`jobMaxPixels`): it runs at native resolution with no tiling, so a larger
  frame costs GPU memory, not just time. Every other model may take 8192².
- Admission to `POST /jobs` (active-job limit, storage budget) runs BEFORE the
  upload is read, like the slot reservation on `/segment`.
- Results expire 24 h after a job finishes (`sweep`, every 10 min); the row
  stays as `expired` for 7 days. Inputs are deleted as each image is used.
- **The ML service's routes are also called `/api/v1/*`** on its own port.
  Unrelated. Never add an nginx `location /api/v1/` pointing at `ml_service`,
  which has no authentication at all.
- **Refusing a key in the URL is not the same as not logging it.** The first
  version answered `?api_key=…` with 400 and then wrote the key to access.log
  and stdout anyway, because both loggers record every URL — found by grepping
  the logs after a real request, which no unit test did. `utils/redactUrl.ts`
  is the one list of credential-bearing query parameters; `accessLogger` and
  `createRequestLogger` redact through it and `authenticateApiKey` refuses by
  it. nginx's own access log is out of its reach.
- **`/api/v1` is exempt from the global limiter in `server.ts`** and has two
  of its own: per IP before auth (no `RateLimit` headers), per key after.
  With all three, every response carried two `RateLimit-Policy` headers in two
  different syntaxes. Also only visible on a real response.
- Swagger UI at `/api-docs` is mounted unconditionally and is **public in
  production**; this file and `docs/api/README.md` used to say development only.

### ML service (`/backend/segmentation/`)

- FastAPI + PyTorch, CUDA with CPU fallback
- Models: SegFormer (~200 ms — **the spheroid default** since 2026-09-20), HRNet (~200 ms), CBAM-ResUNet (~400 ms), U-Net (~200 ms), Mamba-UNet (~240 ms), Spheroid Disintegration, Sperm, Sperm 2-part (`sperm_2part`: head + tail, same Mask2Former pipeline, `weights/sperm_2part.pth`), Wound, Microcapsule, Neurite/Soma, Neurite/Soma classical (`neurite_soma_classical`: Meijering ridge filter + shape rules on a merge of user-ticked channels; CPU, no weights), Microtubule SPARSE35 ep040 (nnU-Net ResEnc-M + curvature-bounded instancer, NATIVE-scale inference since 2026-09-19, ~0.6 s per 1024x1024 frame on the A5000; `backend/segmentation/models/microtubule/MODEL_CARD.md` is the reference for the model, its numbers and its rollback)
- Weights from Google Drive; `make check-weights`. Microtubule: `scripts/download-microtubule-weights.sh [name]` stages `weights/microtubule_v16_deb_s4_ep040.pth` (interactive and essays) or `weights/microtubule_sparse35_ep040.pth` (no service loads it; reference tests, older runs) and refuses any file whose sha256 is not the pinned one (a wrong checkpoint of the right shape loads without an error). `microtubule_v5h.pth` + `params_v5h.json` stay on disk/in git as the rollback. **No `HF_TOKEN`** — the checkpoint is a complete `state_dict` with no frozen backbone, so MT segmentation needs no network at run time. (As of 2026-09-20 **no model fetches on its shipped path** — see the HF note below.)
- **High-bit-depth input is stretched, not clipped (2026-10-06).** Ten of the
  thirteen models go through PIL `convert('RGB'/'L')`, which CLIPS a 16-bit /
  32-bit / float image at 255. Measured on every such still in production (3
  of 3 475): the model saw 1, 1 and 5 grey levels and found nothing. They now
  get a 0.1–99.9 percentile stretch first (`api/input_depth.py`), reported as
  `input_conversion`. **Not min-max**: one hot pixel (51 586 vs a p99.9 of
  16 851) squeezed a real frame into 125 dark levels and changed the result
  from a core with a fragmented corona to one blob. `microtubule`,
  `neurite_soma` and `neurite_soma_classical` keep the native depth. 8-bit input is returned as the same
  object — 62 real results across all twelve models of that date were identical
  before and after. It is three frames with no ground truth; re-measure before moving
  either percentile.
- **`neurite_soma_merged` replaced the classical model in the picker
  (2026-11-03).** The network of `neurite_soma`, 4 folds, retrained on 15
  hand-corrected frames merged by `neurite_classical.merge_channels`; held-out
  Dice 0.843 / 0.879, ~2.6 s per 1024² frame, weights in
  `weights/neurite_soma_merged/`. It is NOT a replacement for `neurite_soma`, which
  stays the default: on Leica confocal tubulin the merged model scores 0.465 / 0.825
  against 0.851 / 0.924, and on merged frames `neurite_soma` scores 0.622 / 0.834.
  Known limit: dim staining, where it finds part of the neurites and no somas.
  `neurite_soma_classical` has `compatibleProjectTypes: []`, so the picker omits it
  and a stored value resolves to the default; migration
  `20261103_retire_classical_neurite` moved its projects. It stays a known id:
  stored results name it and the public API serves it. It left the picker on the
  owner's decision, knowing it found more on dim frames.
- **`neurite_soma_classical` is a classical model that segments a MERGE of
  channels (2026-10-08).** `models/neurite_classical.py`: no network, no
  weights, CPU only; ~1.3 s per 1024² frame (1.13–1.46 s on four production
  frames); parameters are `PARAMS` in that file; `threshold` does not apply;
  images over 64 Mpx are refused. The channels are merged **in Python at
  native depth, never in Node** — each normalised to its own noise
  (median / MAD), then pixel-wise maximum — and reach `/segment` as `file`
  plus the multipart field `extra_channels`, which only this model accepts.
  The registry flag `mergesChannels` (both `modelRegistry.ts`) is what turns
  `SegmentChannelDialog` into checkboxes (`multiple`): nothing ticked by
  default, Confirm disabled until one is. The request field `channels[]` (1–8
  names, on `POST /api/queue/batch` and `POST /api/segmentation/batch`,
  refused for a model that does not merge) and the column
  `segmentation_queue.mergeChannels` are **separate from the single
  `channel`**. Holes are emitted as `type:'internal'` polygons with a
  `parent_id` and **NO class** — by BOTH neurite models (the learned one via
  `PostprocessingService.mask_to_polygons(emit_holes=True)` +
  `holes_to_internal`; without the flag that shared polygoniser keeps a
  region's outer ring only, which is what every other caller wants). On the
  read side `splitNeuritePolygons` folds two things into the parent's `holes`:
  those internal polygons, and any polygon with NO class that lies wholly
  inside a soma or a neurite (the way to cut a hole by hand; it goes to the
  smallest region around it). A nested polygon that HAS a class is never a
  hole. So a loop closed by crossing neurites is not measured — or
  skeletonised — with the background inside it. Known limit: faint, diffuse somas are found only some of the time
  (2 of 3, 1 and 0 on three dim production frames), so the user is expected to
  add them — and a polygon drawn by hand has NO class and is ignored by every
  neurite table until it is given one, which is what the context menu's
  **Set as soma / Set as neurite** (closed polygons, neurite projects only) is
  for. The neurite export (BOTH
  neurite models) gains an **Intensity** table in `neurite_metrics/` — one row
  per frame × channel × class, on the union of the stored polygons, on EVERY
  channel of the file at native depth whichever were ticked, via
  `POST /api/v1/neurite-intensity` (`models/neurite_intensity.py`,
  `neuriteIntensityExporter.ts`); it needs no pixel size.
- **`/segment` takes `page` and `max_pixels`**, answers 400 for an unknown
  model or bytes that are not an image (both used to be 500, and an unknown
  model could evict a loaded one first), and does NOT decode at open: the
  route is `async def`, so `image.load()` there would stall `/health` on a
  498 Mpx frame and let four requests each hold a decoded frame.
- **The microtubule model is IRM-only, and its threshold is NOT a user setting.** The `/segment` route deliberately passes no threshold for `microtubule`; the model applies `prob_thr` from `params_v16.json` (0.995, chosen on the validation blocks by a declared rule; SPARSE35 used 0.98, v5H 0.97). Do not "fix" a low detection count by lowering it. **Verify a model swap with `docker exec spheroseg-ml python scripts/verify_microtubule_model.py`**: it runs the committed fixture through the container's own forward pass and compares the map and the polylines with what the research harness measured (identity on the harness's own torch 2.5.1 + A5000; a different torch or GPU may move a few probabilities by thousandths, which `reference_check.CUDA_TOL` absorbs). The evidence below was measured on v5H at 0.97 and is kept as the record of WHY the cut is not a setting; re-measure before moving it. Measured 2026-08-17 by sampling background-flattened image contrast along every detected centerline against the same curve translated elsewhere (a real MT in IRM is darker than its surround): on a pure IRM frame, 0.97 gives 128 MTs at **−1.73 SD** separation, and dropping to 0.35 gives 155 at only −1.44 SD — more detections, worse evidence. On a **TIRF** frame separation is ~**−0.02 SD at every threshold**, i.e. the output does not track image content at all, so lowering the threshold there manufactures hundreds of false positives. Symptom of feeding it TIRF: plenty of confident-looking polylines with no contrast under them. Check the project's `channels` JSON. IRM detection now requires POSITIVE evidence — a label-free name (IRM/BF/DIC/TL) or an explicitly **zero** emission wavelength; the old "unknown wavelength ⇒ irm" fallback was removed because multi-page TIFFs carry no wavelength at all and so had every channel typed `irm` (the 3-frame `DNA_origami` fixture is exactly that). The failure mode is now a QUIETER version of the same one, not the opposite one — this sentence used to say such a stack "gets **no** segmentation source, and must be set by hand", and neither half was true. What the code does (traced 2026-10-06): no channel is MARKED (`buildChannelMeta`, `pythonExtractor.ts:206-237`), but `resolveSegmentationSource` (`backend/src/services/video/types.ts:75-79`) is `find(isSegmentationSource) ?? channels[0]`, and every frame's `originalPath` is written from it at upload (`videoUploadService.ts:417-442`), so a segmentation request that names no channel reads **channel 0** (`resolveChannelPath`, `segmentationService.ts:842`). **Known hazard, stated plainly: the IRM-only model can run on an unidentified first channel — TIRF on seven production containers, per the comment at `pythonExtractor.ts:441-444` — and nothing warns.** In the UI a multi-channel container always passes through `SegmentChannelDialog`, and since 2026-10-07 both pickers (project page and the editor's Resegment) preselect ONLY a channel the container marks as its segmentation source and otherwise NOTHING, leaving Confirm disabled (`src/lib/segmentationChannelDefault.ts`) — until then the project page preselected the alphabetically first channel name and ignored the mark, so `488_nm` was offered ahead of a correctly identified `IRM`, and both fell back to the first channel. With NO dialog at all: a single-channel container, and any direct call to `POST /api/queue/batch`, `/api/segmentation/batch` or `/api/queue/images/:id` (the last has no `channel` field) that omits the channel. Also taken from channel 0 without anyone choosing: stage-drift correction at upload (`videoUploadService.ts:321`), the thumbnail, the static-share projection and the kymograph export's fallback. And it cannot be "set by hand" in the app: no component writes `isSegmentationSource` — `ChannelOverlayList` only renders the "● src" badge and renames — so the mark changes only via `PATCH /api/images/:id/channels` or by adding an IRM-named channel to a container with no source (`addChannelService.ts:737-780`); the dialog's choice is per batch and is not stored on the container.
- **Temporal vote before the tracker** (2026-11-04): `services/tracking/temporalVote.ts` re-decodes each interior frame of a queue-segmented microtubule video through `POST /api/v1/microtubule/temporal-vote` (`instance/instancer_lh_vote.py`) with its neighbours' stored per-frame curves, inside the tracker's in-flight slot and before the tracker reads polygons (its write-back rewrites what it read). Unlike the tracker it REPLACES geometry, so it is fenced: only frames the queue noted in this pass (in memory; consumed once, so never re-voted), never a row whose `updatedAt` moved, never a frame whose recomputed per-frame curves differ from the stored ones (the route refuses), never the end frames, and only when both neighbours were noted in the same pass and are untouched (their curves must be per-frame; voted neighbours were never measured). Curves travel as multipart FILE parts (Starlette's 1 MB cap on fields); three failed calls in a row end the pass. The editor's synchronous re-segment notes nothing. `MT_TEMPORAL_VOTE=off` disables it. Deploy ml before the backend. Numbers: `MODEL_CARD.md` §0.
- Cross-frame routes: `/api/v1/track` (Hungarian matching on **geometry** — symmetric curve distance + overlap gate, with common-mode stage drift removed via normal-flow least squares; see `api/mt_geometry_cost.py`) + `/api/v1/kymograph` (line-profile + viridis) in `api/tracker_kymograph.py`. `/api/v1/kymograph/batch` takes N of those bodies in one call and decodes each frame ONCE for all of them — the MT export builds one kymograph per (microtubule x channel) over the same frames, and the sampled-row cache never hits for it because every job has a different polyline. Same bodies, byte-identical per-item results; **deploy ml before the backend that calls it**, the route 404s on an older container.
- **Kymograph column counts from before 2026-09-01 are not comparable with later ones.** The **column cap is gone**: a kymograph is now one column per pixel of the seed polyline's arc length, unclamped, where it used to be capped at 200 (`target_width`). Measured over all 146 216 production MT polylines the median arc is 118 px (unaffected) but **33 % exceed 200** — p95 625, p99 985, max 2076 — so a third of real kymographs change width, the p95 by 3.1x. It is not cosmetic: on a real 299-frame kymograph of a 1250 px MT, 200 columns yielded 5 trajectories and 1251 yielded 13, because 6.3 image pixels per column merges neighbouring tracks. `px_per_column` is therefore 1.0 to within rounding now; it stays on the wire and Node still multiplies by it. `target_width` is **accepted-and-ignored** on the ML model (same pattern as `/track`'s `embedding` — `extra="forbid"` would 422 an un-recreated Node) and no longer sent. Because the response is now O(frames x columns) and no longer O(items), the batch endpoint is bounded by `_BATCH_MAX_OUTPUT_PIXELS` (3 840 000 = the old 64 x 300 x 200 envelope) as well as by item count, and `buildKymographBatch` splits a batch that would exceed it — 2 of the 60 production MT containers do.
- **Every kymograph pixel moved on 2026-09-01: sampling is BILINEAR now, not nearest-neighbour.** `_sample_line_profile` in `api/tracker_kymograph.py` passes `order=1` to `map_coordinates`. The old `order=0` was justified by a comment claiming it matched "ImageJ's `getInterpolatedValue` zero-fill" — only the zero-fill half was true; `getInterpolatedValue` (`ij/process/ImageProcessor.java` L2005-2013) is bilinear, and so is every ImageJ polyline path (`ProfilePlot`, `Straightener`) and KymoResliceWide. Nearest was the outlier, used only by KymographBuilder. Measured on a real 299 x 1251 kymograph (container `4972cad8`, `polyline_39`, 488 nm): **99.7 % of cells change**, by a mean of 0.99 % of the frame's range, p95 2.7 %, **max 39 %** — the max lands on punctate spots, exactly where a kymograph is read, because nearest snaps to whichever pixel centre is closest and makes a particle's intensity flicker with sub-pixel position. Frame-to-frame noise drops from 24.7 to 20.7 counts. Also corrected in the same change: `_arc_length_resample_polyline`'s docstring cited `Roi.getInterpolatedPolygon` (a chord walk that DROPS an open polyline's endpoint); the code has always implemented `PolygonRoi.getEquidistantPoints` (`round(L)+1` points, endpoint forced). The **code was right and the citation was wrong** — do not "fix" the code to match the old comment.
- **`line_width` samples a BAND across the polyline** (`KymographRequest.line_width`, 1..51, default **1** = today's single-pixel line profile, so an omitted field renders the identical kymograph; `line_reduce` is `mean` (default, ImageJ's convention) or `max` (KymoResliceWide's default)). Transcribed from `UU-cellbiology/KymoResliceWide` @ `506760c4` (`getIrregularProfileWide` L679-824 + `processWideLine` L843-914): backward-difference tangent, normal by `(dx,dy) -> (-dy,dx)`, samples at 1.0 px spacing. It deviates in ONE place, deliberately: offsets are `-(w-1)/2 … +(w-1)/2` for **both** parities (ImageJ `Straightener.java` L181-182) instead of KymoResliceWide's asymmetric `w/2`, which is 0.5 px off-centre for even widths — so "width 5" spans 4 px between the outermost samples. **Do NOT copy ImageJ's `Straightener`**: `straightenLine` unconditionally calls `fitSplineForStraightening()` (L149) and `ProfilePlot` routes every width>1 polyline through it (L74-79), silently replacing the drawn polyline with a natural cubic spline — measured deviation 5.77 px / +3.0 % arc on a right angle, 4.99 px / +2.3 % on an MT-like wiggle, i.e. a path error larger than the band being added. **Do NOT copy Multi Kymograph**: its `Linewidth` adds the offset to x and y _identically_ (`MultipleKymograph_.java` L150-151, L299-302) — a fixed 45° shift with no normal anywhere — and mutates the caller's ROI so offsets accumulate. Every band test in `test_tracker_kymograph.py` uses a **diagonal** feature for exactly that reason; a horizontal/vertical fixture passes with that bug present. Two things no reference implementation handles are matched rather than invented: a sharp vertex is **not mitred** (unsampled wedge outside the corner, double count inside) and out-of-image samples are **zero-filled and counted in the mean**, so a band overhanging the border is biased toward zero. Useful widths are modality-dependent and small — measured over all 60 MTs of `4972cad8`, the fraction of single-pixel contrast a band still carries is 100/80/50/26/10/0 % at widths 1/3/5/7/9/11 on **IRM** (the dark core sits inside a bright interference halo peaking at ±4-5 px, so past width 11 the sign _inverts_) but 100/96/93/88/83/79 % on **488 nm**. 51 is a guard rail, not a setting. Cost is negligible: sampling the whole 299 x 1251 kymograph takes 0.018 s at width 1, 0.100 s at width 5, 0.572 s at width 51, against ~2.7 s of PNG decode either way. `line_width`/`line_reduce` are in the sampled-**row** cache key and travel on the `_RowJob`, so a batch may mix widths of one frame. Node omits both at the defaults (byte-identical body to before) and clamps out-of-range input; **deploy ml before the backend**, as always — the ML model is `extra="forbid"`.
- **Kymograph trajectory intensities from before 2026-09-01 are not comparable with later ones either**, for two independent reasons that landed the same day. (1) `intensity_width` **default 3 → 5**, which widens the signal band and the background ring together; three places must agree — the ML `KymographRequest`, `kymographService.ts`, `KymographModal.tsx`. (2) `intensity_signal` / `intensity_background` / `intensity_minus_background` in `velocity_metrics.xlsx` changed for EVERY trajectory when the metric moved onto the shared per-microtubule code (`models/mt_measure.py`, the same file the export and the essays batch use). The old 1-D estimator read a `width`-column band out of each row plus two `width`-column background blocks offset `bg_gap = 2` columns either side, pooled over the trajectory's entire temporal extent, and took `numpy.median`. It is now the microtubule's own region and statistics: an ImageJ `Roi.convertLineToArea` band measured PERPENDICULAR to the trajectory, a background ring `dilate(band, intensity_width * intensity_bg_margin)` **minus the union of every trajectory's band**, and ImageJ's histogram tie-rule median. A neighbouring streak can therefore no longer be counted as background — measured on real production kymographs, 17 of 47 trajectories of container `4972cad8` (300 frames, 640 nm, `intensity_width` 5) had a contaminated background, up to 18.5 % of its pixels, and 17 of 41 on a denser container, up to 42.7 %. Across those two sets `intensity_background` moved by a median of +0.3 % / +1.7 % (max 45.6 %) and `intensity_minus_bg` by −10.1 % / −4.1 % (max 46.3 %). At the new defaults (`intensity_width` 5, `intensity_bg_margin` 2.0) a trajectory and a microtubule are measured by the identical geometry in the identical numbers — those are `mt_measure`'s own `thickness_px` / `margin_multiplier`. **The two changes of that day do not multiply.** Cost is flat in the column axis — re-measured on `4972cad8`/488 nm, `tracks_intensity` costs the same per trajectory at 200, 1251 (the microtubule's true width) and 2077 columns alike, because `rasterize_band` costs one fill per FRAME the trajectory lives on and `vicinity_mask` dilates only the band's bounding box. That per-trajectory cost was 12.7 ms until both were vectorised on 2026-09-01 (see below) and is 1.3 ms now, so the worst case production can ask for — 47 trajectories on a 299 × 2077 kymograph — went from 0.57 s to 0.060 s. And the wider axis makes the ring matter MORE, not less: on that container the old background was neighbour-contaminated for 3 of the 5 trajectories the capped 200 columns revealed and for 8 of the 13 the true 1251 columns reveal. The ring is **isotropic on axes that are not the same quantity** — rows are frames, columns are arc-length pixels, so `dilate(band, r)` means ±r frames AND ±r columns. That is deliberate (it is the microtubule region, and an anisotropic variant would need an acquisition-dependent frames-per-pixel scale) and it is still strictly MORE local in time than the estimator it replaced, which pooled the whole trajectory. `intensity_bg_margin` (`KymographRequest`, default 2.0, mirroring `MTMetricsRequest.margin_multiplier`) is the knob; nothing on the Node side sets it yet. Do not try to restore the old numbers.
- **The trajectory intensity floor (`min_intensity_minus_bg`) is an ABSOLUTE number, and that is only sound because of where it is applied.** Frames are decoded at native bit depth (`_sample_frame_rows` never converts a 16-bit frame to 8-bit) and `tracks_intensity` measures on that raw matrix, so `intensity_minus_bg` is in camera counts; the min/max normalisation later in the endpoint exists only to paint the PNG. A floor on the DETECTOR could not be absolute — KymoButler consumes `preprocess_array`'s row-normalised copy, whose units are arbitrary — so this can only drop trajectories the detector already found. It runs AFTER `tracks_intensity` (the background ring is the union of every trajectory's band, so filtering first would measure each survivor as if its dropped neighbours were empty field) and BEFORE `render_overlay` and `flag_bright_outliers`, exactly like the velocity cut-off, so overlay = table = exported CSV. It takes **no polarity argument, and adding one is a bug** — it shipped with one and deleted every trajectory on a dark-on-bright movie. `tracks_intensity` already signs `intensity_minus_bg` (`polarity * (signal - background)`), so the field always means "contrast above the local background" and is positive on either polarity; multiplying again inverts it. `flag_bright_outliers` genuinely does need a polarity factor, because it reads the UNSIGNED `intensity_signal` — copying that pattern here is what broke it. A `None` intensity is KEPT — a failed measurement is not evidence of a dim trajectory. **It is NOT comparable between channels**: measured on two production containers, `intensity_minus_bg` runs 9-51 counts on 488 nm and 93-228 on 640 nm of the SAME container, because subtracting the background removes the offset and not the scale (dye, exposure, gain). `snr` is the dimensionless alternative and is already per track. Default 0 = off, and the field is omitted from the ML body at 0, so an un-recreated ml container cannot 422 — **deploy ml before the backend**, as always. It is part of the kymograph cache key; without that, nudging it would be served the previous threshold's tracks and the control would look inert.

- **Competition between two fluorescent proteins** (2026-09-05, PR #495) is `models/mt_competition.py` — pure NumPy, beside `mt_measure` and outside the `microtubule` package for the same reason (comparing profiles needs no torch). Per (frame, MT, fluorescent channel PAIR): each channel's intensity profile along the filament is normalised to **unit area**, and `competition = 1 - Σ min(f, g)` — the total variation distance, i.e. one minus the overlap, in `[0, 1]`. `anticorrelation` (Pearson on the same profiles) ships beside it and is **not redundant**: a distance cannot separate "B displaces A" from "B binds elsewhere" — with A uniform and B a spot, competition reads ~1 either way — whereas `r = -1` means A falls exactly where B rises. Five things are load-bearing: **unit AREA not unit peak** (`max()` is an extreme-value statistic, so one hot pixel would set a whole profile's scale); **per-channel normalisation is required**, since `intensity_minus_bg` runs 9-51 counts on 488 nm against 93-228 on 640 nm of the SAME container; **negatives are clamped to 0 before normalising**, because the unit-area divisor is `Σ I` and negatives can drive it to zero or flip its sign; **a null is not a zero** (0.0 would assert the proteins are co-distributed, which is the opposite of an absent measurement); and the profile comes from the KYMOGRAPH's `_sample_line_profiles`, never a second sampler. `fluorescent_channels` is optional on both the ML and Node sides so an un-recreated ml container cannot 422 — **deploy ml before the backend**. Which channels count as fluorescent is decided on the NODE side, where the "IRM needs POSITIVE evidence" rule already lives. Noise biases the metric UPWARD, so a dim MT scores as more competitive than a bright one carrying the same biology; read it with `snr`.

### Automated Essays worker (`/backend/essays/`)

Batch microtubule assay of ND2 wells. `essays_api.py` is a thin FastAPI job runner that shells out to `module/evaluate.py`; the `essays` image is built `FROM` the ml image so it inherits the exact validated stack (torch 2.6.0+cu124, transformers 5.5.4 — see the pin warning in [Deploy Gotchas](../../CLAUDE.md#deploy-gotchas)).

- **A well is one ND2 file OR one file per channel** (since 2026-10-07).
  `mt_pipeline.nd2_io.group_wells` pairs files by the `Well<id>` in their
  names: a well id on ONE file is that file and is not even opened (every
  older folder takes its old path — proven byte-identical on a real well),
  several files none of which is complete are assembled, and two files for
  one role are a FAILED well, never a guess. The first per-channel folder
  (330 files) had produced 330 failures and an empty table: each file was read
  as a whole well lacking "the other" channels. Three things about it are easy
  to get wrong:
  - **The TIRF file may be a time series** (5 frames per position there).
    Each position is segmented ONCE, on IRM, and measured on EVERY TIRF frame:
    `results.csv` is then one row per microtubule PER FRAME (`tirf_frame`).
    The run's `[ok] … N MT` lines and the `[done]` total count MICROTUBULES,
    not rows — `essays_api.py` sums them into `mtCount`.
  - **Per-channel files are separate passes over the positions**, so the stage
    leaves each field and returns between the IRM and the TIRF frame. Do not
    assume that registers: MEASURE it by sliding the IRM centerlines over the
    TIRF frame and finding where the signal peaks. On the first folder
    (55 positions sampled across 110 wells) the 17 positions WITH fluorescence
    on their filaments peaked at a median 1.0 px (max 2.2) and zero shift kept
    a median 99.9 % of the contrast, so nothing is shifted — but that is one
    microscope. **Classify by contrast before reading a shift**: 36 of the 55
    had no TIRF signal on the filaments at all, and there the "offset" is a
    noise peak of 14 px that changes from frame to frame.
  - **Files of one well are refused unless they show the same fields**: same
    position count, same frame size, stage XY within 5 µm.
- **The module is vendored at `backend/essays/module`** (it was a separate private repo cloned at image build until 2026-08-11 — no more git clone, build secret, or network at build time).
- **The model code has ONE copy**, in `backend/segmentation/models/microtubule` (`wrapper.py`, `net.py`, `instance/`, `vendor/dynamic_network_architectures/`, `params_sparse35.json`, `params_v16.json`). The checkpoint's file name selects the pipeline. **Essays runs the model interactive runs (owner's standing rule, 2026-11-03): when the interactive model changes, essays moves in the same change**, and `backend/essays/tests/test_batch_follows_interactive.py` fails if they differ. The essays module imports it via `_mt_package.ensure_on_path()` (`MT_PACKAGE_DIR=/app/models` in the image, populated by a `COPY` from the repo — _not_ inherited from the ml base image, so a stale ml image can never make the worker run older model code). Before this, the two copies drifted in opposite directions for months and neither side got the other's fix. **Do not re-introduce a second copy**; a change to `wrapper.py` or anything under `instance/` reaches both callers, so re-verify BOTH the essays batch run and interactive MT segmentation when touching them.
- **The metrics have ONE copy too**, in `backend/segmentation/models/mt_measure.py` — band rasterisation (ImageJ `Roi.convertLineToArea`), the per-MT background ring, and the ImageJ statistics (histogram-tie median, `ddof=1`). `api/mt_metrics.py` (project export), `module/mt_pipeline/measure.py` (essays batch) and `api/kymograph_velocity.py` (kymograph trajectory intensities, since 2026-09-01) all import that one file; the essays adapter only swaps `(row,col)`→`(x,y)` and names CSV columns, and the kymograph one only swaps `(frame,x)`→`(x,y)`. Before 2026-08-13 they were separate implementations and had drifted: the export was aligned to ImageJ in 2026-07 (PRs #301, #304) while the essays module was still a private repo, so on one real frame with identical centerlines the two disagreed on band area by −7.8 %…+26.5 %, on ring area by 2.2×, and on the **net signal by a median of +9.9 % (max +33.2 %)** — only length agreed. **Do not re-introduce a local band/ring/statistic**; `test_metrics_match_export.py` asserts the adapter defines nothing but `measure_frame`, and `test_mt_metrics_band.py` asserts the export's helpers _are_ the shared objects. Note `mt_measure.py` sits BESIDE the `microtubule` package, not inside it: importing that package loads the model wrapper and therefore torch, which measuring pixels does not need (and which would make the export's tests skip on a driverless box). **`rasterize_band` and `vicinity_mask` were vectorised on 2026-09-01 and the result is deliberately harder to read than the loops it replaced — do not "simplify" either back.** `rasterize_band` builds every offset quadrilateral and joint triangle for the whole polyline at once and fills them in one flattened pixel pass (`_fill_convex_polygons`), because a fill's cost was ~80 µs of numpy CALL overhead regardless of whether it covered 30 pixels or 3 000; `vicinity_mask` finds the band's bounding box with two `any` reductions instead of `np.nonzero`, which on a 2048² frame was **1.190 s of that function's 1.220 s** for 162 MTs. Together: `frame_geometry` 1.977 s → 0.220 s per essays position and 0.676 s → 0.072 s per export frame, `tracks_intensity` 12.7 → 1.3 ms per trajectory. It is **bit-identical, not close**: 8 820 randomised + real-production `rasterize_band` cases and 10 965 `vicinity_mask` combinations compare equal under `np.array_equal`, and a real `/mt-metrics` export (7 200 rows) and a real essays well (162 MTs) byte-diff clean. The arithmetic is kept in the scalar form's exact groupings for that reason — the `_EPS` 1e-9 tie-breaker has only ~10× of headroom over the rounding noise of an algebraically-equal rewrite at 2048² coordinates, so an "obvious" hoist in `cross` is not safe. The docstrings carry the numbers.
- **The out-of-focus check is a DIAGNOSTIC and must stay one.** `focus_qc/` is vendored inside `backend/essays/module` (pure NumPy/SciPy — no weights, no GPU, no network) and `mt_pipeline/nd2_io.judge_focus` calls it in-process on the **raw 16-bit** frames `iter_positions` holds, because the descriptor thresholds at 5σ of the frame's own noise and the 8-bit display PNGs destroy exactly that. It appends four columns to `results.csv` (`focus_irm_score`, `focus_tirf_score`, `focus_flagged`, `focus_reason`) and writes `focus_qc.csv`, one row per position **read** — including zero-MT positions and positions whose segmentation failed, neither of which reaches `results.csv`, and a defocused field is exactly the kind that yields no microtubules. **Never wire any of it to an exit code**: `essays_api.py` treats a non-zero exit as a failed job and would withhold the whole zip, and the descriptor conflates focus with field density and fails PERMISSIVE (one validation field dropped only 15.0× → 11.6× under a 0.5 µm defocus where the calibration fields drop 88 %). `out_of_calibration` is advisory and **fires on healthy real data** — 3/3 positions of a 2048² well, TIRF σ 27.8–33.1 against a fitted 5.79–5.89; the remedy is `python -m focus_qc.cli calibrate` plus `ESSAYS_FOCUS_CALIBRATION`, not a code change. The 488 in-solution channel is never scored (uniform dye; it measures ~0 and would flag every row). The published 0.959 balanced accuracy is leave-one-**stack**-out inside one acquisition session and does not support a cross-session transfer claim. `focus_qc/metrics.py` was rewritten for speed on 2026-08-31 **bit-identically** (proven on real wells at 1400² and 2048²); the IRM separation margin is only 1.97× and `test_in_focus_and_out_of_focus_scores_stay_separated` fails below 1.8×, so never buy speed there with a "close enough" approximation.
- **Essays numbers from before 2026-11-03 are not comparable with later ones**: the model changed (SPARSE35 + `instance_a` → V16 + L+H, cut 0.995). `results.csv` now names the checkpoint and decoder on every row (`segmentation_model`, `decoder`); `decoder` reads `instance_a_fallback` on a position past the L+H arc limit, so grep for it before comparing dense wells.
- **Essays numbers from before 2026-08-13 are not comparable with later ones.** The geometry changed with the unification: `--bg-gap`/`--bg-width` (a 6 px ring with a 1 px guard) became `--bg-margin` (a multiple of `--mt-width`, default 2 → 10 px, excluding exactly the bands), matching the export's `margin_multiplier`. `results.csv` gained `mt_median_intensity` and `signal_minus_background` (mean − **median** background, the export's readout); `net_mean_intensity` still means mean − **mean** background.
- **Nothing is downloaded at run time.** The checkpoint carries every weight, so neither the batch nor the interactive path needs `HF_TOKEN`, a HuggingFace account, or network access. The `MT_BACKBONE_CONFIG` offline-backbone escape hatch and its bundled `config/dinov3_vitl16` directory were deleted with the v7 model — there is no gated download left to work around.
- Checkpoint: staged once by `scripts/download-microtubule-weights.sh` into `backend/segmentation/weights/`, bind-mounted read-only at `/app/mt_weights`. Interactive loads `microtubule_v16_deb_s4_ep040.pth`, essays `microtubule_sparse35_ep040.pth`.
- **A capped run does not bit-match an uncapped one.** `sitecustomize.py` applies `set_per_process_memory_fraction` (`ESSAYS_APPLY_GPU_CAP=1`) to the `evaluate.py` subprocess, which shrinks cuDNN's workspace and changes convolution algorithm selection. The numbers stay valid and MT counts hold, but a filament endpoint can move ~1 px — and because a background ring excludes _neighbouring_ MTs, that shifts an adjacent MT's `bg_*` columns while its centerline is unchanged. So when diffing a local run against production, hold the cap constant or you will chase a phantom regression. (Measured 2026-08-11: identical output for capped-vs-capped and uncapped-vs-uncapped; 2 of 73 rows differ across the cap boundary. The cap's **value** matters the same way — 2026-08-13, 0.6 → 0.75 moved 2 of the same 73 rows.)
- **V16 (2026-11-03): working set 1.22 GiB reserved / 0.93 allocated in the essays container (direct probe of `predict()` with no cap, not a job), flat from 1024² to 2048²; the cap stays 0.12.**
- **The GPU cap was re-measured for v5H on 2026-08-17 and lowered.** `ESSAYS_GPU_MEM_FRACTION` **0.75 → 0.12** (17.67 → 2.83 GiB) and `ESSAYS_GPU_MIN_FREE_GB` **17 → 4**. Measured on a real `evaluate.py` run over 3 positions of a 2048² IRM well (162 MTs): the working set is **1.41 GiB reserved** / 1.05 GiB allocated, and FLAT across caps of 17.99 / 4.80 / 2.88 / 1.92 GiB. Runtime was flat too (43.0 / 43.6 / 44.0 / 43.9 s) and `results.csv` came out **byte-identical at all four caps** — unlike v7, where the cap sized cuDNN's workspace and 0.6 → 0.75 moved a centerline by 1.10 px. The equivalence holds only because 1.41 GiB sits far below every cap tested, so the workspace is never constrained; re-check it if either number moves. This returned ~15 GiB of reservation and dropped the start gate from 17 GB to 4 GB — the gate mattered more in practice, because it made a batch _wait_ for memory it was never going to use.
- **The rule that produced the old numbers still stands: set the cap ABOVE the model's working set, never below.** v7's was 16.36 GiB on a 2048² well; the cap was once 0.6 (14.13 GiB), i.e. _under_ it, so torch hit the ceiling on every position, released ~3.7 GiB of cached blocks back to the driver and had to re-win them from a card shared with `ml` and Maptimize. Losing that race is an `OutOfMemoryError`, which is why one folder lost 255 wells in one run and 68 in the next. Demand does not grow into the ceiling, so raising the cap past ~2× the working set buys nothing and only takes room interactive segmentation needs. A cap below the working set protects nobody: it hands other tenants memory the batch immediately tries to take back. `backend/essays/tests/test_gpu_budget.py` asserts both directions (cap ≥ 1.5× working set, cap ≤ working set + 2 GiB, start gate ≥ cap + CUDA context) and that the compose defaults match the module defaults.

### Grid previews and storage GC (2026-10-24)

- **A preview is addressed by its inputs, not invalidated by its writers.**
  `previewUrl = /api/images/:id/preview?v=<version>`, the version a hash of
  `originalPath` + the segmentation row's `id`/`updatedAt` + `PREVIEW_RENDERER_VERSION`
  (`services/previews/previewVersion.ts`). The old scheme re-rendered a file
  from 3 of the ~15 paths that change a segmentation; deleting one, every
  cross-frame track op, static projection, neurite soma assignment and
  type-label clean-up left the old picture, and nothing told the browser. Any
  write that moves `updatedAt` now moves the URL — a new write path needs
  nothing to stay correct. **Bump `PREVIEW_RENDERER_VERSION` whenever
  `previewRenderer.ts` changes what it draws**, or every cached preview stays.
- **Rendered on first request, 512 px, aspect kept, in preview space**:
  1 851 → 30 ms for a 4080×3072 JPEG and 700 → 75 ms for a 16-bit frame with
  311 polylines, measured on production files. A 16-bit source is stretched
  over its own min..max (the editor's opening window), scaled to 0..65535 —
  sharp's `grey16 → b-w` divides by 256, so a 0..255 stretch came out black.
  Colours come from `resolvePolygonColor`, shared with the export
  visualization (whose output was proven byte-identical across the refactor).
- `previewService.notifyChanged` / `notifyContainerChanged` emit
  `imagePreviewsUpdated` to the PROJECT room (collaborators too) and pre-render
  at low priority. They are a liveness path, not a correctness one.
- **The FE has ONE gallery mapper (`mapGalleryImage`) and ONE re-list
  (`reloadImages`, replace-not-merge).** Five hand-written copies used to
  "preserve the existing thumbnail if the API sent none", which is exactly how a
  deleted segmentation kept its overlay, and four of them dropped the video
  fields. After an upload the page also fetched the full polygons of EVERY
  segmented image, unbounded — data the grid never reads.
- `images.segmentationThumbnailPath` is **unused and kept only as the rollback
  target**; drop it (and the old `segmentation_thumbnails/` dirs, which the GC
  keeps while a row references them) in a follow-up once the new previews have
  run in production.
- **Storage GC** (`services/maintenance/storageGc.ts`, every 6 h,
  `STORAGE_GC_MODE=off|dry-run|delete`, JSONL report per run in
  `<LOG_DIR>/storage-gc/`). The first production dry-run (2026-10-24) planned
  74 000 files / 40.2 GB of 306 GB — 27.6 GB from projects deleted before #580,
  11.5 GB of video dirs the batch delete left behind, 38 190 superseded
  thumbnails, 4 353 v1 proxies — and matched an independent file-by-file audit
  exactly, every difference being the grace period. Safety rules that look
  like over-engineering and are not: **inside a live container nothing is
  judged by reference** (non-source channel PNGs are referenced by no row, and
  removeChannel can repoint a frame at one); **grace is the NEWEST file mtime
  in the subtree**, never a directory's (the GC's own deletes move that);
  `(parentVideoId, frameIndex)` is **not unique**, so a frame dir goes only when
  no row has its index; `projects/segmenter/` is a namespace of its own. Each
  of these is a mutation-tested case in `storageGc.test.ts`.
- The delete paths now remove a row's files AFTER the row commits (the batch
  path used to delete files inside the transaction, before the row), and a
  cascaded container takes its whole directory, display cache and previews.

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
- `constants.ts` — timeouts, retry, file limits, storage TTLs, HTTP status codes

---
