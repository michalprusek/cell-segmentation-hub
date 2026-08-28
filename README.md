# SpheroSeg - Cell Segmentation Hub

Microscopy segmentation and measurement platform powered by deep learning. Full-stack system with a React frontend, a Node.js backend and a Python ML microservice, running eleven AI models across seven project types with real-time processing.

> **Resources**: [Dataset, Paper & Supplementary Materials](https://staff.utia.cas.cz/novozada/spheroseg/)

## Quick Start

### Prerequisites

- **Docker** (20.10+) and **Docker Compose** v2
- **Git**
- **8GB+ RAM** recommended
- **(Optional) NVIDIA GPU** with CUDA for ML acceleration

### Start Development

```bash
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub
make up
```

All services start automatically:

| Service     | URL                            | Purpose           |
| ----------- | ------------------------------ | ----------------- |
| Frontend    | http://localhost:3000          | React application |
| Backend API | http://localhost:3001          | REST API          |
| API Docs    | http://localhost:3001/api-docs | Swagger/OpenAPI   |
| ML Service  | http://localhost:8000          | AI inference      |

> **Model Weights**: The ML service requires model weights (~1.8 GB). On first start, they are auto-downloaded from Google Drive. Run `make check-weights` to verify.

## Key Features

- **11 AI Models** across **7 project types**: spheroids (5 models), disintegrating spheroids, wound healing, sperm morphology, microtubules, microcapsules, neurites & somas
- **Interactive Polygon Editor** with undo/redo, vertex editing, polygon slicing, hole detection
- **Sperm Morphology Analysis** with skeleton extraction for head/midpiece/tail measurement
- **Batch Processing** up to 10,000 images per project
- **Real-time Updates** via WebSocket (segmentation progress, queue status)
- **Multiple Export Formats**: COCO JSON, YOLO, Excel (with metrics), CSV
- **6 Languages**: English, Czech, Spanish, German, French, Chinese
- **Project Sharing** via email or link with role-based access

## Architecture

```
                    ┌──────────────────┐
                    │     Nginx        │ (Production SSL/reverse proxy)
                    └────────┬─────────┘
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  React Frontend  │ │  Node.js Backend │ │  Python ML       │
│  :3000           │ │  :3001           │ │  :8000           │
│  Vite + React 18 │ │  Express + Prisma│ │  FastAPI + PyTorch│
│  shadcn/ui       │ │  Socket.io       │ │  CUDA / CPU      │
│  TanStack Query  │ │  JWT Auth        │ │  11 Models       │
└──────────────────┘ └────────┬─────────┘ └──────────────────┘
                              │
                    ┌─────────┼─────────┐
                    ▼                   ▼
          ┌──────────────────┐ ┌──────────────────┐
          │  PostgreSQL      │ │  Redis           │
          │  (prod) / SQLite │ │  Sessions, Queue │
          │  (dev)           │ │  Cache           │
          └──────────────────┘ └──────────────────┘
```

## Tech Stack

| Layer      | Technology                                                               |
| ---------- | ------------------------------------------------------------------------ |
| Frontend   | React 18 + TypeScript + Vite + shadcn/ui (Radix + Tailwind)              |
| Backend    | Node.js + Express + TypeScript + Prisma ORM                              |
| ML Service | Python + FastAPI + PyTorch (11 models — see docs/reference/ml-models.md) |
| Database   | SQLite (dev) / PostgreSQL (prod)                                         |
| Real-time  | Socket.io with auto-reconnect + exponential backoff                      |
| Auth       | JWT access + refresh tokens                                              |
| i18n       | 6 languages via i18next (EN, CS, ES, DE, FR, ZH)                         |
| Deployment | Docker + Docker Compose + Nginx                                          |

## AI Models

Eleven models, each locked to the project types it was trained for. Only
standard spheroid projects offer a choice; every other type has exactly one.

| Model                   | Project type      | Inference | Throughput |
| ----------------------- | ----------------- | --------- | ---------- |
| HRNet (Balanced)        | spheroid          | ~0.20 s   | 4.9 img/s  |
| CBAM-ResUNet (Precise)  | spheroid          | ~0.38 s   | 2.7 img/s  |
| UNet (Fastest)          | spheroid          | ~0.18 s   | 5.5 img/s  |
| SegFormer               | spheroid          | ~0.20 s   | 5.0 img/s  |
| Mamba-UNet              | spheroid          | ~0.24 s   | 4.2 img/s  |
| Spheroid Disintegration | spheroid_invasive | ~0.70 s   | 1.5 img/s  |
| Wound Healing           | wound             | ~0.03 s   | 35 img/s   |
| Sperm Morphology        | sperm             | ~0.30 s   | 3.3 img/s  |
| Microtubule (v5H)       | microtubules      | ~4.5 s    | 0.22 img/s |
| Microcapsule            | microcapsule      | ~0.30 s   | 3.0 img/s  |
| Neurite / Soma          | neurite           | ~12 s     | 0.08 img/s |

Full detail — architecture, training data, thresholds and known limits — in
[docs/reference/ml-models.md](docs/reference/ml-models.md).

Performance measured on NVIDIA GPU. CPU fallback is supported.

## Development

### Commands

```bash
# Start/Stop
make up                    # Start all services
make down                  # Stop services
make logs-f                # Tail all logs
make health                # Health check all services

# Container Shells (run npm/prisma inside these)
make shell-fe              # Frontend container
make shell-be              # Backend container
make shell-ml              # ML service container

# Code Quality
npx tsc --noEmit           # TypeScript check (frontend)
make lint                  # ESLint
make type-check            # Full TypeScript check

# Testing
make test                  # Unit tests (Vitest frontend, Jest backend)
make test-e2e              # Playwright E2E tests

# Building
make build-optimized       # Smart build with auto-cleanup
make build-clean           # Full rebuild without cache
```

### Database (inside `make shell-be`)

```bash
npx prisma migrate dev --name migration_name
npx prisma generate
npx prisma studio          # Visual DB browser
```

### Git Conventions

- **Conventional commits required**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`
- **Direct commits to `main` blocked** -- use feature branches + PRs
- Pre-commit hooks validate: no `console.log`/`debugger`, ESLint (0 warnings), Prettier, TypeScript

### Internationalization

All user-facing strings must exist in all 6 translation files (`src/translations/{en,cs,es,de,fr,zh}.ts`).

## Testing

The project has comprehensive test coverage across all layers:

| Layer      | Framework                      | Files | Tests  | Coverage Target |
| ---------- | ------------------------------ | ----- | ------ | --------------- |
| Frontend   | Vitest + React Testing Library | 142   | ~2500  | 80%             |
| Backend    | Jest + Supertest               | 63    | ~980   | 75%             |
| ML Service | pytest                         | 14    | ~170   | 80%             |
| E2E        | Playwright                     | 14    | varies | critical flows  |

```bash
# Run tests
make test                  # All unit tests
make test-e2e              # Playwright E2E

# Coverage
npx vitest run --coverage  # Frontend coverage
cd backend && npx jest --coverage  # Backend coverage
```

## Production Deployment

```bash
make build-optimized
make prod                  # Build + deploy with docker-compose.production.yml
curl https://spherosegapp.utia.cas.cz/health
```

| Service     | Production | Dev  |
| ----------- | ---------- | ---- |
| Nginx (SSL) | 80/443     | --   |
| Frontend    | 4000       | 3000 |
| Backend     | 4001       | 3001 |
| ML          | 4008       | 8000 |

## Documentation

**[Full documentation index →](docs/README.md)** · the in-app user manual is at
[`/documentation`](https://spherosegapp.utia.cas.cz/documentation) and has a
search box.

### For users

| Topic                       | Link                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| User guide                  | [docs/guides/user-guide.md](docs/guides/user-guide.md)                   |
| Project types (all seven)   | [docs/guides/project-types.md](docs/guides/project-types.md)             |
| Uploading data              | [docs/guides/uploading-data.md](docs/guides/uploading-data.md)           |
| Videos, frames and channels | [docs/guides/videos-and-channels.md](docs/guides/videos-and-channels.md) |
| Segmentation editor         | [docs/guides/segmentation-editor.md](docs/guides/segmentation-editor.md) |
| Export and metrics          | [docs/guides/export.md](docs/guides/export.md)                           |
| Automated Essays            | [docs/guides/automated-essays.md](docs/guides/automated-essays.md)       |

### For developers

| Topic                  | Link                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| Architecture Overview  | [docs/architecture/README.md](docs/architecture/README.md)                 |
| Frontend Architecture  | [docs/architecture/frontend.md](docs/architecture/frontend.md)             |
| Backend Architecture   | [docs/architecture/backend.md](docs/architecture/backend.md)               |
| ML Service             | [docs/architecture/ml-service.md](docs/architecture/ml-service.md)         |
| ML Models (all eleven) | [docs/reference/ml-models.md](docs/reference/ml-models.md)                 |
| Metrics reference      | [docs/reference/metrics.md](docs/reference/metrics.md)                     |
| Database Schema        | [docs/reference/database-schema.md](docs/reference/database-schema.md)     |
| API Reference          | [docs/api/README.md](docs/api/README.md)                                   |
| Contributing           | [docs/development/contributing.md](docs/development/contributing.md)       |
| Testing Guide          | [docs/testing-guide.md](docs/testing-guide.md)                             |
| i18n Guide             | [docs/i18n-guide.md](docs/i18n-guide.md)                                   |
| Getting Started        | [docs/development/getting-started.md](docs/development/getting-started.md) |
| Deployment             | [docs/deployment/README.md](docs/deployment/README.md)                     |

## About

Developed at **UTIA AV CR** (Institute of Information Theory and Automation, Czech Academy of Sciences).

- **Contact**: prusek@utia.cas.cz
- **Project Page**: [Dataset, Papers & Code](https://staff.utia.cas.cz/novozada/spheroseg/)
