# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Production Safety

**Never modify or deploy to production without explicit permission.** Production runs on `docker-compose.production.yml` with `.env.production`.

## Commands

**This is a Docker-first project. Never run npm/node directly on the host — use `make` targets or Docker shells.**

```bash
# Development
make up                          # Start all services (frontend :3000, backend :3001, ML :8000)
make down                        # Stop services
make logs-f                      # Tail all logs
make health                      # Health check

# Shells (run npm/prisma commands inside these)
make shell-fe                    # Frontend container shell
make shell-be                    # Backend container shell
make shell-ml                    # ML service container shell

# Code quality (can run on host — these are fast)
npx tsc --noEmit                 # TypeScript check (frontend)
make lint                        # ESLint
make type-check                  # Full TypeScript check (frontend + backend)

# Testing
make test                        # Unit tests (Vitest frontend, Jest backend)
make test-e2e                    # Playwright E2E tests

# Building (always use optimized builds)
make build-optimized             # Smart build with auto-cleanup
make build-service SERVICE=frontend  # Build one service
make build-clean                 # Full rebuild without cache

# Docker maintenance
make docker-usage                # Check disk usage
make optimize-storage            # Safe cleanup
```

### Database (run inside `make shell-be`)

```bash
npx prisma migrate dev --name migration_name
npx prisma generate
npx prisma studio                # Visual DB browser
```

## Tech Stack

| Layer      | Technology                                                     |
| ---------- | -------------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Vite + shadcn/ui (Radix + Tailwind)    |
| Backend    | Node.js + Express + TypeScript + Prisma                        |
| ML Service | Python + FastAPI + PyTorch (HRNet, CBAM-ResUNet, U-Net, Sperm) |
| Database   | SQLite (dev) / PostgreSQL (prod)                               |
| Real-time  | Socket.io with auto-reconnect + exponential backoff            |
| Auth       | JWT access + refresh tokens                                    |
| i18n       | 6 languages (EN, CS, ES, DE, FR, ZH) via i18next               |

## Architecture

### Frontend State Management

- **Server state**: React Query (TanStack) with optimistic updates and query invalidation
- **Client state**: React Contexts — Auth, Theme, Language, WebSocket, Upload, Export, Model
- **Real-time**: Socket.io events (`segmentationStatus`, `segmentationCompleted/Failed`, `queueStats`)

### Segmentation Editor (`/src/pages/segmentation/`)

The editor is the most complex frontend component (~51KB orchestrator). Key patterns:

- **`SegmentationEditor.tsx`** — top-level orchestrator, wires hooks into canvas components
- **`useEnhancedSegmentationEditor`** — core state: polygons, selection, undo/redo, transforms
- **`useAdvancedInteractions`** — mouse/keyboard interactions, polygon creation, vertex editing
- **EditMode enum** — state machine: `View | EditVertices | Slice | AddPoints | DeletePolygon | CreatePolygon | CreatePolyline`
- **Polygon model** — supports both closed polygons (`geometry: 'polygon'`) and open polylines (`geometry: 'polyline'`) with `partClass` and `instanceId` for sperm morphology
- **Canvas layers** — `CanvasPolygon` (per-polygon, React.memo with custom comparator), `CanvasVertex`, `CanvasTemporaryGeometryLayer`
- **Coordinate system** — image coords ↔ canvas coords via `coordinateUtils.ts`, zoom-dependent stroke widths

### Backend Architecture

```
Controllers → Services → Prisma ORM → Storage (local filesystem / S3)
```

- **API routes**: `/backend/src/api/routes/` with OpenAPI/Swagger docs at `:3001/api-docs`
- **Queue system**: `SegmentationQueue` model with priority, retry, batch ID. Controller: `queueController.ts`. Supports up to 10,000 images per batch.
- **Export formats**: COCO, YOLO, JSON in `/backend/src/services/export/`

### ML Service (`/backend/segmentation/`)

- FastAPI app with PyTorch models, GPU (CUDA) with CPU fallback
- Models: HRNet (~200ms), CBAM-ResUNet (~400ms), U-Net (~200ms), Sperm (specialized)
- Weights auto-download from Google Drive. Check: `make check-weights`
- Inference → postprocessing → polygon extraction

### Key Shared Libraries (`/src/lib/`)

- **`api.ts`** — Axios client with JWT interceptors, token refresh, retry logic
- **`polygonGeometry.ts`** — polygon area, perimeter, point-in-polygon, vertex operations (shared — don't duplicate these)
- **`segmentation.ts`** — `Polygon` and `Point` type definitions, polygon creation
- **`metricCalculations.ts`** (`/src/pages/segmentation/utils/`) — Feret diameter (rotating calipers), polyline length, perimeter (includes holes, ImageJ convention)
- **`constants.ts`** — timeouts, retry config, WebSocket event names

## Code Conventions

### Pre-commit Hooks (Husky)

Commits are validated by `.husky/pre-commit`:

- No `console.log` / `debugger` in production code
- ESLint (0 warnings), Prettier formatting, TypeScript checking
- **Conventional commits required**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`
- **Direct commits to `main` are blocked** — use feature branches + PRs

### Internationalization

All user-facing strings must exist in all 6 translation files (`/src/translations/{en,cs,es,de,fr,zh}.ts`). Validate with `npm run i18n:validate`.

### React Patterns in This Codebase

- **React.memo with custom comparators** — used extensively in canvas components (`CanvasPolygon`, `CanvasVertex`). When adding props, update the comparator.
- **`useCallback`/`useMemo` stability** — parent callbacks passed to memoized children must be stable. Arrays passed for reference-equality comparison need stabilized refs (see `availableInstanceIds` two-stage memo pattern).
- **`editor.getPolygons()`** — use this (reads latest ref) instead of `editor.polygons` (closure snapshot) when updating polygons from event handlers.

## Key Directories

```
src/pages/segmentation/      # Editor — the most complex feature
src/components/ui/            # shadcn/ui primitives
src/contexts/                 # React context providers
src/hooks/                    # Shared custom hooks
src/lib/                      # Utilities, API client, types
src/translations/             # i18n files (6 languages)
backend/src/api/              # Express routes + controllers
backend/src/services/         # Business logic
backend/prisma/               # Schema, migrations, seed
backend/segmentation/         # Python ML service
docker/                       # Dockerfiles (use *.optimized.Dockerfile)
scripts/                      # Build, deploy, environment switching
docs/                         # Detailed documentation (see below)
```

## Deployment

```bash
# Build and deploy
make build-optimized                                    # Build all images
docker compose -f docker-compose.production.yml up -d   # Deploy
curl https://spherosegapp.utia.cas.cz/health            # Verify

# Or use the make target
make prod                                               # Build + deploy
```

| Service     | Production      | Dev  |
| ----------- | --------------- | ---- |
| nginx (SSL) | 80/443          | -    |
| Frontend    | 4000            | 3000 |
| Backend     | 4001            | 3001 |
| ML          | 4008            | 8000 |
| PostgreSQL  | 5432 (internal) | 5432 |
| Redis       | 6379 (internal) | 6379 |

Database: `spheroseg_blue` on PostgreSQL (container: `spheroseg-postgres`).

## Email

UTIA mail server (`hermes.utia.cas.cz:25`, STARTTLS, no auth). Delays of 2-10 minutes are normal — emails are queued for background processing. Config in `.env.production`.

## Documentation Index

| Topic                          | File                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture overview          | [`docs/architecture/README.md`](docs/architecture/README.md)                                                                         |
| Frontend architecture          | [`docs/architecture/frontend.md`](docs/architecture/frontend.md)                                                                     |
| Backend architecture           | [`docs/architecture/backend.md`](docs/architecture/backend.md)                                                                       |
| ML service                     | [`docs/architecture/ml-service.md`](docs/architecture/ml-service.md)                                                                 |
| Database schema                | [`docs/reference/database-schema.md`](docs/reference/database-schema.md)                                                             |
| Testing guide                  | [`docs/testing-guide.md`](docs/testing-guide.md)                                                                                     |
| i18n guide                     | [`docs/i18n-guide.md`](docs/i18n-guide.md)                                                                                           |
| Git hooks                      | [`docs/hooks-guide.md`](docs/hooks-guide.md)                                                                                         |
| Deployment                     | [`docs/superpowers/specs/2026-03-28-simplify-deployment-design.md`](docs/superpowers/specs/2026-03-28-simplify-deployment-design.md) |
| Polygon rendering optimization | [`docs/polygon-rendering-optimization.md`](docs/polygon-rendering-optimization.md)                                                   |
| API documentation              | [`docs/api/README.md`](docs/api/README.md)                                                                                           |
| Getting started                | [`docs/development/getting-started.md`](docs/development/getting-started.md)                                                         |
