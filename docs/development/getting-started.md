# Getting started

Setting up a working development environment, and the two things about a fresh
clone that will stop you if nobody tells you about them.

---

## Prerequisites

| Tool                               | Notes                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| **Docker** + Compose v2            | The project is Docker-first. `docker compose` (not `docker-compose`).    |
| **Node.js 20+**                    | Only for host-side tooling: `make ci`, ESLint, Vitest.                   |
| **NVIDIA GPU + Container Toolkit** | Optional. Everything runs on CPU, one to two orders of magnitude slower. |

---

## Read this before you start

Two facts about a fresh clone that are not obvious and are not currently
handled for you:

### 1. There is no `.env.development` in the repository

It is gitignored, and nothing generates it. Without it:

- `make up` / `make dev` pass a non-existent env file to Compose;
- the frontend throws at start-up —
  `Missing required environment variable: VITE_API_BASE_URL or VITE_API_URL`
  (`src/lib/config.ts`).

**Create it from the template before anything else:**

```bash
cp .env.example .env.development
```

`.env.example` already contains working local values:

```
VITE_API_URL=http://localhost:3001/api
VITE_ML_SERVICE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:3001
```

The frontend accepts either `VITE_API_BASE_URL` or `VITE_API_URL`; production
sets `VITE_API_BASE_URL=/api` at build time because everything is behind one
nginx origin.

The dev server has a second, separate problem worth knowing about: several files
under `src/` read `process.env.NODE_ENV`, which Vite substitutes only in **build**
mode. `npm run dev` therefore throws `ReferenceError: process is not defined`
unless the config defines it. The production build is unaffected, which is why
CI has never caught this.

### 2. There is no development Compose file in the repository

Only `docker-compose.production.yml`, `docker-compose.test.yml` and
`docker-compose.monitoring.yml` are tracked. The `make` targets that take no
`-f` argument (`up`, `down`, `dev`, `logs`, `shell-*`) therefore rely on a
`docker-compose.yml` that a fresh clone does not have.

Until that is fixed, you have two working routes:

- **Run the production compose file locally.** It builds and runs the same five
  services and is what deployment uses:

  ```bash
  docker compose -f docker-compose.production.yml --env-file .env.production up -d
  ```

  You will need a `.env.production` with database credentials and secrets.

- **Run the services directly on the host.** Slower to set up, but the fastest
  edit loop for frontend work — see below.

If you add a development Compose file, please also fix this page.

---

## Ports

| Service    | Development | Production                    |
| ---------- | ----------- | ----------------------------- |
| Frontend   | 3000        | 4000 (behind nginx on 80/443) |
| Backend    | 3001        | 4001                          |
| ML service | 8000        | 4008                          |
| PostgreSQL | 5432        | internal                      |
| Redis      | 6379        | internal                      |

---

## Running pieces on the host

### Frontend

```bash
npm install
npm run dev            # Vite on :3000
```

Requires `.env.development` (above) and a backend reachable at the URL it names.

### Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev            # Express on :3001
```

Needs a `DATABASE_URL` pointing at a PostgreSQL instance, plus JWT secrets. See
`.env.example`.

### ML service

```bash
cd backend/segmentation
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
```

Model checkpoints are **not** in the repository. Stage them with the scripts in
`scripts/` and verify with `make check-weights` — see
[Model weights setup](../MODEL_WEIGHTS_SETUP.md). Without them the service
starts, but the affected models are absent from the catalogue rather than
failing at inference time.

---

## The quality gate

```bash
make ci
```

Frontend TypeScript, backend TypeScript, ESLint at **zero** warnings, i18n
completeness across six locales, documentation link integrity, and the GPU-free
Python suites. About half a minute, and it is what you should run before opening
a PR.

Individually:

```bash
npm run type-check                    # frontend TS
cd backend && npm run type-check      # backend TS
npx eslint --max-warnings=0 src/      # lint
node scripts/check-i18n.cjs           # translations
node scripts/check-doc-links.cjs      # docs links (make docs-links)
make test-py                          # Python, no GPU needed
make test-ml                          # full Python suite, needs a GPU
make ci-test                          # frontend Vitest, see below
```

**`make ci` does not run Vitest, but CI does.** The suite is green (5037
frontend / 3740 backend as of 2026-09-04) and
`.github/workflows/ci.yml` runs it with a coverage floor in both the
`frontend` and `backend` jobs, which the `main-protection` ruleset requires.
So a green `make ci` says nothing about the unit suites — run them too:

```bash
npx vitest run                                        # whole frontend suite
npx vitest run src/lib/__tests__/polygonGeometry.test.ts  # one file
```

The backend suite must run inside the container (canvas ABI). See the
[testing guide](../testing-guide.md) for the invocation and the per-suite
state.

---

## Database work

> **The migration history is tracked.** It once was not — `backend/.gitignore`
> excluded `prisma/migrations/`, so `prisma migrate deploy` had nothing to
> apply and no `migration_lock.toml` to pin the provider. That rule is gone
> (`backend/.gitignore:21` now carries a note saying it must not come back) and
> the migrations, including `0001_init`, are in the repository. After
> generating a migration, check `git status backend/prisma/migrations` — a new
> one that stays untracked is the old bug returning.

```bash
# Inside the backend container, or with DATABASE_URL set on the host
npx prisma migrate dev --name <name>   # development: creates a migration file
npx prisma migrate deploy              # production: applies existing files only
npx prisma generate
npx prisma studio                      # visual browser
```

**Never run `migrate dev` against production** — it creates new migration files
against the live database. Schema reference:
[database schema](../reference/database-schema.md).

---

## Committing

Pre-commit (Husky) enforces: no `console.log` or `debugger`, ESLint at zero
warnings, Prettier formatting, frontend and backend TypeScript, and a
Conventional Commit message. Direct commits to `main` are blocked — branch and
open a PR. **Do not bypass the hook with `--no-verify`.**

See [Contributing](contributing.md).

---

## Where to go next

| You want to…          | Read                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Understand the system | [Architecture overview](../architecture/README.md)                                                      |
| Work on the editor    | [Frontend architecture](../architecture/frontend.md) + [editor guide](../guides/segmentation-editor.md) |
| Work on the API       | [Backend architecture](../architecture/backend.md) + [REST API](../api/README.md)                       |
| Work on a model       | [ML service architecture](../architecture/ml-service.md) + [ML models](../reference/ml-models.md)       |
| Deploy                | [Deployment](../deployment/README.md)                                                                   |
| Fix something broken  | [Troubleshooting](../TROUBLESHOOTING.md)                                                                |
