# Backend architecture

Node.js + Express + TypeScript, with Prisma over PostgreSQL. It owns
authentication, the segmentation queue, all file storage, export, sharing and
the WebSocket.

```
Routes → Controllers → Services → Prisma → PostgreSQL
                            └────→ Filesystem (uploads, exports)
                            └────→ ML service (HTTP)
```

---

## Layout of `backend/src/`

| Path                 | Contains                                                  |
| -------------------- | --------------------------------------------------------- |
| `api/routes/`        | One router per resource; `index.ts` mounts them           |
| `api/controllers/`   | HTTP shape: validate, call a service, format the response |
| `services/`          | The actual behaviour                                      |
| `services/export/`   | Format converters, ImageJ/CVAT encoders, archiving        |
| `services/metrics/`  | Shape metrics and the disintegration path                 |
| `services/video/`    | Extraction, channels, registration, playback proxy        |
| `services/tracking/` | The microtubule cross-frame tracker client                |
| `middleware/`        | Auth, uploads, rate limiting, validation, caching         |
| `constants/`         | The backend model registry                                |
| `utils/`             | Config, auth cookies, geometry, storage-path guards       |

Routers are mounted at `/api/health`, `/api/auth`, `/api/users`,
`/api/projects`, `/api/images`, `/api/segmentation`, `/api/queue`, `/api/ml`,
`/api/feedback`, `/api/folders`, `/api/segmenter`, plus export, sharing and
essays routers mounted at `/api` because their paths are project-scoped. Full
list: [REST API](../api/README.md).

---

## Authentication

JWT access and refresh tokens carried in **httpOnly cookies**
(`access_token`, `refresh_token`) with `sameSite: strict`, plus a
non-secret, JS-readable `authenticated` flag so the client can tell whether a
session _might_ exist without being able to read the tokens. XSS therefore
cannot exfiltrate a token.

Sessions are rows in the database, so refresh tokens can be invalidated
server-side. Details: [Authentication](../api/authentication.md).

---

## The segmentation queue

`SegmentationQueue` rows carry the image, the project, the user, the chosen
model and threshold, hole detection, an optional channel override, a priority
and a status.

The worker:

1. selects a batch, **deprioritising users who were recently served** so one
   200-frame video cannot monopolise the GPU;
2. **enforces model/project-type compatibility here**, not at enqueue — so a
   `202` is not a promise that the item will run;
3. rewrites the frame's path when a channel override is set;
4. POSTs to the ML service and stores the result;
5. emits WebSocket events.

Two behaviours worth knowing:

- **A static (single-image) channel is segmented once and projected** across
  every covered frame, rather than being segmented per frame. One production
  container of 299 frames otherwise produced 30 498 polylines resolving to 102
  tracks — the same detections counted 299 times.
- **Microtubule tracking is fire-and-forget.** It runs once every frame of a
  container is in a final state; a timeout is logged and yields no assignments,
  and a partial write-back leaves the container half-tracked.

---

## Storage

Everything image-shaped is on disk, never in the database:

```
uploads/projects/<projectId>/images/<containerId>/
    original.<ext>
    thumbnail.jpg
    frames/<NNNN>/<channel>.png
    frames/<NNNN>/<channel>.p<range>.webp
    registration.json
```

Every user-derived path segment goes through a safety assertion before it
becomes part of a path, and channel names are restricted to
`[A-Za-z0-9_-]{1,64}`. That cap is load-bearing: in August 2026 a
Fiji/Bio-Formats export embedded a ~140-character source filename in every slice
label, the read gate enforced 64, and nine containers became permanently
unreadable. Uploads now fail loudly instead of persisting such a container.

---

## Video handling

`services/video/` shells out to Python helpers for extraction: `nd2` for ND2,
`tifffile` for TIFF stacks, `ffmpeg-static` for ordinary video. Progress is
streamed back on stdout; a SIGKILL is diagnosed as an out-of-memory kill rather
than reported as a generic failure.

Bit depth is preserved — 8- and 16-bit data pass through unchanged into
per-frame PNGs. The only narrowing is the playback proxy, which never feeds a
measurement.

A multi-position ND2 fans out into one container per position, each with its own
self-contained single-position OME-TIFF; the uploaded `.nd2` is then deleted.

---

## Export

Asynchronous jobs with progress over both WebSocket and HTTP polling. **One
active export per user.** The job builds a directory tree, runs each stage, and
archives it.

Design points that came from production incidents:

- The stage count is a **pure function**, because four exporters were once
  pushed but never counted and froze the bar at 95 % for twenty minutes.
- ML calls are **serialised behind one semaphore** — the ML service has a single
  worker, and one export once produced 893 concurrency-limit warnings and a
  seven-minute head-of-line block.
- ML timeouts are **workload-scaled**, not fixed; a hard-coded five minutes
  silently degraded real exports to geometry-only sheets.
- Non-fatal stages degrade to **warnings**, and a degraded microtubule metrics
  run is additionally recorded in `metrics/metrics_status.json` and as a banner
  in the metrics guide — a toast is missable on a multi-hour job.

See [Export](../guides/export.md).

---

## Real-time

Socket.io with a `user:<id>` room joined on connect and `project:<id>` rooms
joined on request. Segmentation updates go to the user room only, to avoid
double delivery. Full event list: [WebSocket events](../api/websocket.md).

---

## Operational notes

- **Migrations**: `prisma migrate dev` in development (creates files),
  `prisma migrate deploy` in production (applies existing ones). Never the
  former against a live database.
- **Column types matter.** `Image.fileSize` is `BigInt` because ND2 and TIFF
  stacks routinely exceed the 2 GB `Int4` ceiling.
- **Heap**: the backend runs with an explicitly raised V8 heap. The 2 GB default
  — not the container's memory limit — was the real cause of a "stuck" export.
- **After recreating the backend container, restart nginx**: its upstream DNS
  cache pins the old container IP and you get 502s otherwise.

## Related

- [REST API](../api/README.md)
- [Database schema](../reference/database-schema.md)
- [Deployment](../deployment/README.md)
