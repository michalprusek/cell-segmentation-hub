# Segmenter P0 — Implementation Plan (module + polygon-only editor + generic classes)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** A standalone `/segmenter` module where a user creates a dataset, uploads images, defines arbitrary classes, and annotates overlapping multi-class/multi-instance **polygons** in a reused editor — no ML yet. This is the first browser-testable milestone.

**Architecture:** New backend domain (`segmenterDataset`, `segmenterClass`, `segmenterAnnotation`) behind Express/Prisma, reusing existing image-upload + storage; a new React route tree under `/segmenter` reusing the spheroseg polygon editor stripped to polygons-only with a generic project-scoped class registry.

**Tech Stack:** React+Vite+TS+shadcn, Express+Prisma+Postgres, existing multer upload + local FS storage, i18next (6 locales), Docker.

## Global Constraints (verbatim from spec)

- **Polygons only** in v1 (closed shapes). No polylines/filaments/video/channels.
- **Multi-class, multi-instance, overlap incl. same-class.**
- Class registry is **project-scoped** `{ id, name, color }`, pattern = existing MT type-label palette (`/projects/:id/mt-type-labels`, `useMtTypeLabels`, `MtTypeLabelDialog`).
- Every polygon carries a single generic `classId` (+ optional `instanceId`) — NOT `partClass`/`mtType`.
- All user-facing strings in all 6 locales (`src/translations/{en,cs,es,de,fr,zh}.ts`); validate `node scripts/check-i18n.cjs`.
- Docker-first: never run npm/node on host; use `make` targets / container shells.
- No console errors in browser (CLAUDE.md policy). Verify with Playwright MCP against dev.
- Commit per task via Husky pre-commit (no `--no-verify`); feature branch off `origin/main`.

---

## File structure

**Backend**

- `backend/prisma/schema.prisma` — add `SegmenterDataset`, `SegmenterImage`, `SegmenterClass`, `SegmenterAnnotation` models (+ enum-free).
- `backend/src/api/routes/segmenterRoutes.ts` — REST surface (Create).
- `backend/src/api/controllers/segmenterController.ts` — Create.
- `backend/src/services/segmenterService.ts` — Create (dataset/class/annotation CRUD; reuse storage service).
- `backend/src/api/routes/index.ts` — mount `/api/segmenter`.

**Frontend**

- `src/pages/segmenter/SegmenterDashboard.tsx` — dataset list + create.
- `src/pages/segmenter/SegmenterDatasetDetail.tsx` — image grid + upload + class manager + "annotate" links.
- `src/pages/segmenter/hooks/useSegmenterClasses.ts` — generic class registry (fork of `useMtTypeLabels`).
- `src/pages/segmenter/components/ClassManagerPanel.tsx` + `ClassLabelDialog.tsx` — fork of MT panel/dialog, generic.
- `src/pages/segmenter/SegmenterEditor.tsx` — thin wrapper over the reused editor, polygon-only, wired to segmenter annotations.
- `src/lib/segmenterApi.ts` — typed API client (mirror `api.ts` patterns).
- `src/App.tsx` — add `/segmenter`, `/segmenter/:datasetId`, `/segmenter/:datasetId/image/:imageId` routes.
- `src/translations/*.ts` — `segmenter.*` keys ×6.

---

### Task 1: Branch + data model + migration

**Files:** Modify `backend/prisma/schema.prisma`; migration via container.

**Interfaces — Produces:**

- `SegmenterDataset { id String @id @default(uuid()), userId String, name String, createdAt, updatedAt }`
- `SegmenterImage { id, datasetId, name, storagePath String, thumbnailPath String?, width Int?, height Int?, createdAt }`
- `SegmenterClass { id, datasetId, name String, color String, createdAt }`
- `SegmenterAnnotation { id, imageId String @unique, polygons Json, imageWidth Int, imageHeight Int, updatedAt }` (polygons = `[{ id, points:[{x,y}], classId, instanceId? }]`, JSON blob — mirrors `Segmentation.polygons`).
- FKs + `@@index` on `datasetId` / `imageId`; cascade delete dataset→images→annotation, dataset→classes.

- [ ] **Step 1:** `git checkout origin/main -B feat/segmenter-p0` (clean branch off main).
- [ ] **Step 2:** Add the four models to `schema.prisma` following existing model style (uuid ids, `@map`/`@@map` snake_case as the file uses, relations with `onDelete: Cascade`).
- [ ] **Step 3:** Create migration: `docker exec spheroseg-backend npx prisma migrate dev --name segmenter_p0`.
- [ ] **Step 4:** Verify schema in DB: `docker exec spheroseg-postgres psql -U spheroseg -d spheroseg_dev -c "\d segmenter_dataset"` (and the other 3 tables) — confirm columns/types/indexes.
- [ ] **Step 5:** `npx prisma generate` (in container) so the client has the new models.
- [ ] **Step 6:** Commit `feat(segmenter): add P0 data model (dataset/image/class/annotation)`.

### Task 2: Backend service + dataset & image endpoints

**Files:** Create `segmenterService.ts`, `segmenterController.ts`, `segmenterRoutes.ts`; modify routes index.

**Interfaces — Consumes:** Prisma models (Task 1), existing `storageService` + `videoUpload`/image multer, auth middleware. **Produces (REST, all auth-guarded, owner-scoped):**

- `POST /api/segmenter/datasets {name}` → dataset
- `GET  /api/segmenter/datasets` → dataset[] (with image counts)
- `GET  /api/segmenter/datasets/:id` → dataset + images + classes
- `DELETE /api/segmenter/datasets/:id`
- `POST /api/segmenter/datasets/:id/images` (multipart) → image[] (reuse image multer + storage path `projects/segmenter/<datasetId>/images/<imageId>/…`)
- `DELETE /api/segmenter/images/:id`

- [ ] **Step 1:** Write service methods with owner checks (throw 403/404 like existing services). Reuse `assertSafeStorageSegment` for path building.
- [ ] **Step 2:** Wire controller + routes; mount `/api/segmenter` in routes index after auth.
- [ ] **Step 3:** Verify with curl (get token via existing login) — create dataset, upload a test image, list, confirm storage file exists (`docker exec spheroseg-backend ls /app/uploads/... `).
- [ ] **Step 4:** Commit `feat(segmenter): dataset + image REST endpoints`.

### Task 3: Backend class registry + annotations endpoints

**Interfaces — Produces:**

- `GET/POST/PUT/DELETE /api/segmenter/datasets/:id/classes` (mirror mt-type-labels: `{ classes: SegmenterClass[] }`)
- `GET  /api/segmenter/images/:id/annotations` → `{ polygons, imageWidth, imageHeight }`
- `PUT  /api/segmenter/images/:id/annotations` `{ polygons, imageWidth, imageHeight }` (upsert on `imageId`)

- [ ] **Step 1:** Implement class CRUD + annotation upsert in service/controller/routes (owner-scoped via dataset→image join). Use `validateParams` declaring ALL route params (known gotcha).
- [ ] **Step 2:** curl-verify: create class, PUT annotations with 2 overlapping polygons (same classId), GET back — assert overlap polygons round-trip intact.
- [ ] **Step 3:** Commit `feat(segmenter): class registry + annotations endpoints`.

### Task 4: Frontend module — dashboard + dataset detail + upload + class manager

**Files:** `segmenterApi.ts`, `SegmenterDashboard.tsx`, `SegmenterDatasetDetail.tsx`, `useSegmenterClasses.ts`, `ClassManagerPanel.tsx`, `ClassLabelDialog.tsx`, `App.tsx`, translations.

- [ ] **Step 1:** `segmenterApi.ts` typed client (axios instance reuse from `api.ts`).
- [ ] **Step 2:** Routes in `App.tsx`: `/segmenter`, `/segmenter/:datasetId`, `/segmenter/:datasetId/image/:imageId` (lazy, inside the authed layout).
- [ ] **Step 3:** Dashboard: list datasets + "New dataset" dialog.
- [ ] **Step 4:** Dataset detail: image grid (reuse existing gallery/upload dropzone patterns), upload via existing dropzone, `ClassManagerPanel` (fork of MicrotubuleInstancePanel's label section — list/add/rename/delete classes with color).
- [ ] **Step 5:** `useSegmenterClasses` (fork `useMtTypeLabels`, generic).
- [ ] **Step 6:** i18n `segmenter.*` keys ×6; `node scripts/check-i18n.cjs` passes.
- [ ] **Step 7:** `make build-service SERVICE=frontend` succeeds; Playwright: navigate `/segmenter`, create dataset, upload image, add class — screenshot + zero console errors.
- [ ] **Step 8:** Commit `feat(segmenter): FE dashboard + dataset detail + class manager`.

### Task 5: Frontend polygon-only editor + wiring

**Files:** `SegmenterEditor.tsx` + adapted editor pieces.

**Approach:** Reuse `useEnhancedSegmentationEditor` + `useAdvancedInteractions` + `CanvasPolygon`/`CanvasVertex` + persistence, per the reuse map in the spec §8. Strip `CreatePolyline`/video/MT/sperm; add generic `classId` stamping on `CreatePolygon` from an active-class selector; palette color via a generic resolver; generic instance panel.

- [ ] **Step 1:** Create `SegmenterEditor.tsx` mounting the reused editor against `useSegmenter*` loaders (fork of `useSegmentationLoader`/`onSave` hitting the Task-3 annotation endpoints).
- [ ] **Step 2:** Add `classId` to the `Polygon` create path + a palette-driven color resolver (generalize `resolveMtColor`); update `CanvasPolygon` memo comparator to include `classId` + resolved color.
- [ ] **Step 3:** Active-class + active-instance selector (fork SpermInstancePanel's active controls, generic); stamp on new polygons.
- [ ] **Step 4:** Confirm overlapping polygons render (two overlapping polygons both visible, per-class color).
- [ ] **Step 5:** Playwright E2E: open image editor, draw 2 overlapping polygons of a class, save, reload, confirm both persist with class colors, zero console errors.
- [ ] **Step 6:** Commit `feat(segmenter): polygon-only editor wired to datasets`.

### Task 6: End-to-end verification + polish

- [ ] **Step 1:** Full E2E walk (Playwright): create dataset → upload → add 2 classes → annotate image with overlapping multi-class polygons → save → revisit → export-less round-trip holds.
- [ ] **Step 2:** `make ci` (TS + ESLint 0 + i18n) green.
- [ ] **Step 3:** Verify prod-mode FE build serves the route (`make build-service SERVICE=frontend`).
- [ ] **Step 4:** Commit + open PR `feat(segmenter): P0 polygon annotation module`.

---

## Self-review

- **Spec coverage:** module (T2/T4), polygon-only editor (T5), generic multi-class/multi-instance registry (T3/T4/T5), overlap (T3/T5), data model (T1), reuse map (T5). ML/AL = out of P0 scope (own plan). ✓
- **Type consistency:** `classId` used consistently FE/BE; annotation JSON shape matches `Segmentation.polygons`. ✓
- **Placeholders:** larger tasks (T5 editor fork) reference the spec §8 reuse map rather than inlining the whole fork — acceptable given the map exists; each step ends testable. ✓

## Next plans (after P0 verified)

- **P1 spike** (de-risk before bite-sized plan): frozen DINOv3-L correspondence + memory bank → polygon pre-label on ONE dataset; then P1 plan.
- P2 (EPIG acquisition + stopping), P3 (native-res patch AL + tiling + export).
