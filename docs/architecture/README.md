# Architecture overview

How the pieces fit together, and where each responsibility lives.

---

## Services

Five containers, orchestrated by Docker Compose.

| Service      | Stack                                                      | Dev port | Prod port | Responsibility                                     |
| ------------ | ---------------------------------------------------------- | -------- | --------- | -------------------------------------------------- |
| **frontend** | React 18 + TypeScript + Vite, shadcn/ui (Radix + Tailwind) | 3000     | 4000      | The whole user interface                           |
| **backend**  | Node.js + Express + TypeScript + Prisma                    | 3001     | 4001      | REST API, auth, queue, storage, export, WebSocket  |
| **ml**       | Python + FastAPI + PyTorch                                 | 8000     | 4008      | Model inference, tracking, kymographs, measurement |
| **postgres** | PostgreSQL                                                 | 5432     | internal  | All persistent state except files                  |
| **redis**    | Redis                                                      | 6379     | internal  | Caching                                            |

Plus **nginx** in production, terminating TLS and routing to the three
application services, and an **essays** worker built from the ML image for the
[Automated Essays](../guides/automated-essays.md) batch path.

```
Browser ── nginx ──┬── frontend (static bundle)
                   └── backend ──┬── postgres
                                 ├── redis
                                 ├── filesystem (uploads, exports)
                                 ├── ml        (HTTP)
                                 └── essays    (HTTP)
```

The browser talks **only** to nginx. The ML and essays services are never
exposed publicly.

---

## Data flow: uploading and segmenting an image

1. The browser POSTs the file to the backend. Still images and videos take
   **different endpoints**, chosen by the client after sniffing multi-page
   TIFFs — see [Uploading data](../guides/uploading-data.md).
2. The backend writes the file under `uploads/projects/<projectId>/images/...`,
   creates the `Image` row (plus frame rows for a video), and generates a
   thumbnail.
3. Segmenting creates `SegmentationQueue` rows.
4. A worker in the backend pulls items, enforces model/project-type
   compatibility, and POSTs the image to the ML service.
5. The ML service loads the model (caching it), runs inference and
   post-processing, and returns polygons or polylines.
6. The backend stores them as a `Segmentation` row and emits WebSocket events.
7. The frontend invalidates its React Query cache and re-renders.

For microtubule videos there is a step 8: once **every** frame of a container
reaches a final state, the backend calls the ML tracker and patches `trackId`
into the stored polygons.

A detailed trace lives in [SSOT data flow](../SSOT_DATA_FLOW_CURRENT.md).

---

## Where responsibility sits

| Concern                                       | Owner                                                                      | Notes                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Model identity and project-type compatibility | **Three mirrored registries**                                              | Frontend, backend and Python. A parity script fails CI on drift     |
| Enforcing compatibility                       | The queue **worker**                                                       | Not the enqueue endpoint — an accepted item can still be rejected   |
| Geometry helpers                              | `src/lib/polygonGeometry.ts` (FE) and `backend/src/services/metrics/` (BE) | Do not duplicate; note the two differ on hole handling              |
| Microtubule band/ring measurement             | `backend/segmentation/models/mt_measure.py`                                | **One copy**, shared by the export and the essays batch             |
| Microtubule model code                        | `backend/segmentation/models/microtubule/`                                 | **One copy**, imported by both the ML service and the essays worker |
| Auth token storage                            | httpOnly cookies                                                           | See [Authentication](../api/authentication.md)                      |
| Real-time delivery                            | Socket.io                                                                  | Always paired with an HTTP fallback                                 |

---

## Persistence

- **PostgreSQL** holds users, projects, folders, images, segmentations, the
  queue, shares, essay jobs and segmenter datasets. Schema:
  [database-schema](../reference/database-schema.md).
- **The filesystem** holds every pixel: originals, thumbnails, per-frame
  per-channel PNGs, playback proxies, and export archives. Nothing image-shaped
  is in the database.
- **Redis** caches read-heavy responses; it is not a source of truth.

Polygons are stored as a **JSON string** on the `Segmentation` row, not as
relational rows. That is a deliberate trade: a frame can carry thousands of
shapes and is always read and written whole.

---

## Cross-cutting rules worth knowing

- **A model's output geometry is a project-type property.** Closed polygons for
  most types, open polylines for microtubules and sperm. Code that assumes
  "polygon" breaks on the latter.
- **Cross-frame identity is `trackId`, not `id`.** Ids are re-minted on every
  inference. Anything that must persist across frames keys on
  `polygonKey(p) = p.trackId ?? p.id`.
- **The video container row is never segmented.** Only frame rows are queued.
- **Adding a field to a polygon touches five validation stages** that
  enumerate fields; missing one silently drops it.

---

## Deployment

Single-stack. Blue-green was removed in May 2026. Deploying is: build the
changed service, recreate it, restart nginx if the backend was recreated,
verify. See [Deployment](../deployment/README.md).

## Read next

- [Frontend architecture](frontend.md)
- [Backend architecture](backend.md)
- [ML service architecture](ml-service.md)
- [Database schema](../reference/database-schema.md)
- [REST API](../api/README.md)
