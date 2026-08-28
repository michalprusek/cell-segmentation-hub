# Database schema

PostgreSQL via Prisma. The schema of record is
`backend/prisma/schema.prisma` — this page explains what each model is _for_ and
flags the columns whose behaviour is not obvious from their name.

Sixteen models. Every table name is snake_case; Prisma model names are
PascalCase.

---

## Identity

### `User` → `users`

Account credentials and e-mail verification state. Owns projects, sessions,
shares, feedback, folders, essay jobs and segmenter datasets — all cascading on
delete, except feedback, which is **soft-anonymised** (`userId` set to null) so
report history survives a GDPR deletion.

### `Profile` → `profiles`

One per user. Display fields (username, avatar, bio, organisation, location,
title, `publicProfile`) plus the settings that drive the app:

| Column                                                                                | Default | Meaning                                                   |
| ------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| `preferredModel`                                                                      | `hrnet` | Pre-selected model where the project type allows a choice |
| `modelThreshold`                                                                      | `0.5`   | Default confidence threshold                              |
| `preferredLang`                                                                       | `cs`    | One of the six locales                                    |
| `preferredTheme`                                                                      | `light` |                                                           |
| `emailNotifications`                                                                  | `true`  |                                                           |
| `consentToMLTraining`, `consentToAlgorithmImprovement`, `consentToFeatureDevelopment` | `true`  | Data-use consents, with `consentUpdatedAt`                |

Avatars are files on disk; the row stores the path, MIME type and size.

### `Session` → `sessions`

One row per refresh token, so a session can be invalidated server-side. Carries
the user agent, IP, `rememberMe` and an expiry.

---

## Projects

### `Project` → `projects`

| Column                     | Notes                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`                     | `spheroid` \| `spheroid_invasive` \| `wound` \| `sperm` \| `microtubules` \| `microcapsule`. Drives model compatibility, editor mode and export format. **The inline comment in the schema lists only four types and is out of date — the six above are authoritative** (`src/types/index.ts` and both model registries) |
| `mtTypeLabels`             | The project's microtubule type-label palette: `[{ id, name, color }]`. Microtubule projects only                                                                                                                                                                                                                         |
| `verified`                 | "All annotations reviewed and passed." Settable by the owner **or** an accepted collaborator, unlike title/description/type                                                                                                                                                                                              |
| `verifiedAt`, `verifiedBy` | Stamped for auditability; not surfaced in the UI. `verifiedBy` is a bare user id with no foreign key                                                                                                                                                                                                                     |

### `ProjectFolder` → `project_folders`

A per-user folder tree, adjacency list (`parentId`, self-referential, cascading).
`NULL` parent means the root.

> Postgres treats `NULL` as distinct in unique indexes, so the
> `[userId, parentId, name]` constraint does **not** stop two root folders
> sharing a name. A second, partial unique index handles that case and is
> declared in raw SQL in the migration, because Prisma's schema language cannot
> express it. **Keep both in sync.**

### `ProjectFolderItem` → `project_folder_items`

Where one user files one project. `userId` is denormalised from the folder so
the "which folder is this project in for me" lookup is index-only. Each user
keeps each project in at most one folder — which is why two users can file the
same shared project differently.

### `ProjectShare` → `project_shares`

One row per invitation. `sharedWithId` is null for a link share until someone
accepts it; `email` is set for e-mail invitations. `shareToken` is unique, with
an optional `tokenExpiry`. `status` is `pending` | `accepted` | `revoked` (and
`expired` for a lapsed token).

---

## Images and segmentation

### `Image` → `images`

Both standalone images **and** video containers **and** video frames live here,
distinguished by three columns.

| Column                           | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `segmentationStatus`             | `no_segmentation` \| `queued` \| `processing` \| `segmented` \| `failed`                                                                                                                                                                                                                                                                                               |
| `fileSize`                       | **`BigInt`.** ND2 and TIFF stacks routinely exceed the 2 GB `Int4` ceiling; an `Int` here caused upload failures. Mapped to a JS number by the controller — 2⁵³ covers 9 PB                                                                                                                                                                                            |
| `displayOrder`                   | Manual ordering for time series; falls back to `createdAt` when null                                                                                                                                                                                                                                                                                                   |
| `isVideoContainer`               | `true` on the original upload row. **Containers are never segmented and never enqueued**                                                                                                                                                                                                                                                                               |
| `parentVideoId`                  | Set on frame rows; self-relation, cascading                                                                                                                                                                                                                                                                                                                            |
| `frameIndex`                     | 0-based position within the parent; null for standalone images                                                                                                                                                                                                                                                                                                         |
| `frameCount`                     | On the **container** row only                                                                                                                                                                                                                                                                                                                                          |
| `videoDurationMs`                | Source duration, when known                                                                                                                                                                                                                                                                                                                                            |
| `pixelSizeUm`, `frameIntervalMs` | Calibration from ND2 / OME-TIFF / ImageJ TIFF. **Container rows only** — the listing endpoint bubbles them down onto frames so the export dialog can auto-fill the pixel scale                                                                                                                                                                                         |
| `channels`                       | JSON, container rows only. One entry per channel: `name`, `displayName?`, `type` (`irm` \| `fluorescent`), `wavelengthNm?`, `displayColor?`, `isSegmentationSource`, and the post-upload fields `pngBacked?`, `frameIds?`, `staticSource?`, `staticShifts?`, `proxyRangeMax?`. **Array position is the channel's C-axis index**, so added channels are always appended |

Indexes cover the four hot queries: project + status, project + display order,
video + frame index, and video + status (the tracker's "are all frames final?"
gate).

### `Segmentation` → `segmentations`

One per image (`imageId` is unique). `polygons` is a **JSON string**, not
relational rows — a frame can carry thousands of shapes and is always read and
written whole. Also records the `model`, `threshold`, optional `confidence`,
`processingTime` and the image dimensions the result was computed in.

### `SegmentationQueue` → `segmentation_queue`

| Column                                        | Notes                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`, `threshold`, `detectHoles`           | The choices made at submission                                                                                                                                               |
| `channel`                                     | Per-item channel override for multi-channel video frames. When set, the worker rewrites the channel segment of the frame's path so the user's Segment-All choice is honoured |
| `priority`, `status`, `retryCount`, `batchId` | Scheduling                                                                                                                                                                   |
| `startedAt`, `completedAt`                    | Timing                                                                                                                                                                       |

---

## Feature tables

### `Feedback` → `feedbacks`

User-submitted bug reports and feature requests. `type` is `bug` | `feature`,
enforced by both a database check constraint and schema validation.
`emailSentAt` stays null until SMTP delivery succeeds — the row is the source of
truth and the e-mail is only a notification, because the institutional mail
server takes minutes.

### `EssayJob` → `essay_jobs`

One row per [Automated Essays](../guides/automated-essays.md) run.
`status` is `queued` | `running` | `completed` | `failed`; `device` records
`cuda`, `cpu`, `cpu-degraded` or `cpu-busy`. `inputKey` and `outputKey` are
storage keys; `resultZipKey` is set once the archive exists.

Note that a **partial** run is stored as `completed` **with** an `error` — which
is why the retention sweep keys on "did it finish cleanly", not on the status.

### Segmenter tables

`SegmenterDataset` → `segmenter_datasets`, `SegmenterImage` →
`segmenter_images`, `SegmenterClass` → `segmenter_classes`,
`SegmenterAnnotation` → `segmenter_annotations`.

The class palette is a **real table** here, unlike the microtubule type-label
palette which is JSON on the project row. Annotations are one polygons-JSON blob
per image, mirroring `Segmentation.polygons`; polygons may overlap, including
within a class. All cascade-delete. See [Segmenter](../guides/segmenter.md).

---

## Working with migrations

```bash
# development — creates a migration file
docker exec spheroseg-backend npx prisma migrate dev --name <name>

# production — applies existing files, never creates them
docker exec spheroseg-backend npx prisma migrate deploy

# inspect the result
docker exec spheroseg-postgres psql -U spheroseg -d spheroseg_dev -c "\d <table>"
```

Two rules learned the hard way:

- **Never run `migrate dev` against production.** It creates new migration files
  against the live database.
- **Check numeric column types after a migration.** An `Int4` where a JS number
  can exceed 2³¹ is the `fileSize` bug waiting to happen again.

## Related

- [Backend architecture](../architecture/backend.md)
- [REST API](../api/README.md)
- [Database backup](../database-backup.md)
