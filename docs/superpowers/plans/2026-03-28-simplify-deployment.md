# Simplify Deployment: Remove Blue-Green

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blue-green deployment with a single production compose, eliminating ~50 unused files.

**Architecture:** One `docker-compose.production.yml` with services: frontend, backend, ml, postgres, redis, nginx. One `.env.production` (merged from .env.common + .env.blue.production). One static `nginx.production.conf` (merges nginx-main + nginx-blue, keeps Maptimize config). nginx listens on 80/443 directly.

**Tech Stack:** Docker Compose, nginx, PostgreSQL, Redis

---

## Task 1: Create docker-compose.production.yml

**Files:**
- Create: `docker-compose.production.yml` (from `docker-compose.blue.yml`)

- [ ] **Step 1: Copy blue compose as production base**
  ```bash
  cp docker-compose.blue.yml docker-compose.production.yml
  ```

- [ ] **Step 2: Edit docker-compose.production.yml**
  Rename all services, containers, network, volumes:
  - `blue-frontend` → `frontend` (container: `spheroseg-frontend`)
  - `blue-backend` → `backend` (container: `spheroseg-backend`)
  - `blue-ml` → `ml` (container: `spheroseg-ml`)
  - `postgres-blue` → `postgres` (container: `spheroseg-postgres`)
  - `redis-blue` → `redis` (container: `spheroseg-redis`)
  - `nginx-blue` → `nginx` (container: `spheroseg-nginx`)
  - Network: `blue-network` → `spheroseg-network`, name: `spheroseg`
  - env_file: `.env.blue.production` → `.env.production`
  - Volumes: keep existing named volumes (`spheroseg_postgres_blue`, `spheroseg_redis_blue`) for data continuity
  - Backend volume: `./backend/uploads/blue:/app/uploads` → `./backend/uploads:/app/uploads`
  - Backend data: `./backend/data/blue:/app/data` → `./backend/data:/app/data`
  - Backend logs: `./logs/blue/backend:/app/logs` → `./logs/backend:/app/logs`
  - ML volume: `./backend/uploads/blue/blue:/app/uploads` → `./backend/uploads:/app/uploads` (fix double-blue bug)
  - All `depends_on` references: `postgres-blue` → `postgres`, `redis-blue` → `redis`
  - ML env: `DATABASE_URL=...@postgres-blue:5432/...` → `...@postgres:5432/...`
  - ML env: `REDIS_URL=redis://redis-blue:6379` → `redis://redis:6379`
  - nginx: mount `nginx.production.conf` instead of `nginx.blue.conf`
  - nginx: ports `80:80` and `443:443` (replaces 4080:4080, 4443:4443)
  - nginx logs: `./logs/blue/nginx:/var/log/nginx` → `./logs/nginx:/var/log/nginx`
  - nginx: add external network for Maptimize containers
  - Remove `version: '3.8'` (obsolete)

- [ ] **Step 3: Commit**

## Task 2: Create .env.production

**Files:**
- Create: `.env.production` (from `.env.blue.production`)

- [ ] **Step 1: Copy and clean**
  ```bash
  cp .env.blue.production .env.production
  ```

- [ ] **Step 2: Edit .env.production**
  Remove blue-green specific vars:
  - `DEPLOYMENT_COLOR=blue` → remove
  - `ENVIRONMENT_NAME=production-blue` → `ENVIRONMENT_NAME=production`
  - `SERVICE_PREFIX=blue` → remove
  - `FRONTEND_SERVICE=blue-frontend` → `FRONTEND_SERVICE=frontend`
  - `BACKEND_SERVICE=blue-backend` → `BACKEND_SERVICE=backend`
  - `ML_SERVICE=blue-ml` → `ML_SERVICE=ml`
  - `REDIS_SERVICE=redis-blue` → `REDIS_SERVICE=redis`
  - `POSTGRES_SERVICE=postgres-blue` → `POSTGRES_SERVICE=postgres`
  - `NGINX_SERVICE=nginx-blue` → `NGINX_SERVICE=nginx`
  - `NETWORK_NAME=blue-network` → `NETWORK_NAME=spheroseg-network`
  - `DB_HOST=postgres-blue` → `DB_HOST=postgres`
  - `DATABASE_URL=...@postgres-blue:5432/...` → `...@postgres:5432/...`
  - `REDIS_HOST=redis-blue` → `REDIS_HOST=redis`
  - `REDIS_URL=redis://redis-blue:6379` → `redis://redis:6379`
  - `SEGMENTATION_SERVICE_URL=http://blue-ml:8000` → `http://ml:8000`
  - `UPLOAD_DIR=/app/uploads/blue` → `UPLOAD_DIR=/app/uploads`
  - `HEALTH_CHECK_MESSAGE=blue-production-healthy` → `production-healthy`
  - Port vars: keep existing values (4000, 4001, 4008) but add note they're internal
  - Remove volume name vars with "blue" in them

- [ ] **Step 3: Commit**

## Task 3: Create nginx.production.conf

**Files:**
- Create: `docker/nginx/nginx.production.conf` (from `nginx.blue.conf`)

- [ ] **Step 1: Copy blue nginx config**
  ```bash
  cp docker/nginx/nginx.blue.conf docker/nginx/nginx.production.conf
  ```

- [ ] **Step 2: Edit nginx.production.conf**
  - Upstream: `server blue-backend:3001` → `server backend:3001`
  - Upstream: `server blue-ml:8000` → `server ml:8000`
  - Upstream: `server blue-frontend:80` → `server frontend:80`
  - HTTP server: `listen 4080` → `listen 80`
  - HTTPS server: `listen 4443 ssl` → `listen 443 ssl`
  - All `X-Environment "production-blue"` → `X-Environment "production"`
  - Health: `return 200 "blue-production-healthy\n"` → `return 200 "production-healthy\n"`
  - Uploads alias: `alias /app/uploads/blue` → `alias /app/uploads`
  - Keep Maptimize config blocks unchanged (lines 303-425)
  - Update Maptimize listen ports: `4080` → `80`, `4443` → `443`

- [ ] **Step 3: Commit**

## Task 4: Update Makefile

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update Makefile targets**
  - Change `DOCKER_COMPOSE` default to use `-f docker-compose.production.yml` for prod
  - Update `prod` target to use `docker-compose.production.yml`
  - Update `build-optimized` to not require `--env` parameter
  - Keep `dev` target using `docker-compose.yml` or equivalent

- [ ] **Step 2: Commit**

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove all blue-green references**
  - Remove port mapping table (blue/green/dev columns → just production/dev)
  - Remove environment switching section
  - Remove `.active-environment` references
  - Simplify deployment section to just `docker compose -f docker-compose.production.yml up -d`

- [ ] **Step 2: Commit**

## Task 6: Delete dead files

- [ ] **Step 1: Delete green/switch/template files**
  ```
  docker-compose.green.yml
  docker-compose.green.gpu.yml
  docker-compose.active.yml
  .env.blue (superseded by .env.production)
  .env.green
  .env.common (merged into .env.production)
  .env.blue.production (renamed to .env.production)
  .active-environment
  docker/nginx/nginx.template.conf
  docker/nginx/nginx.green.conf
  docker/nginx/nginx.active.conf
  docker/nginx/nginx.blue.local.conf
  docker/nginx/nginx.main-router.conf
  docker/nginx/nginx.ssl.conf
  docker/nginx/spheroseg.conf
  scripts/switch-environment.sh
  scripts/switch-blue-green.sh
  scripts/switch-nginx-upstream.sh
  scripts/deploy-blue-green.sh
  scripts/init-green-db.sh
  scripts/fix-green-uploads.sh
  scripts/fix-green-uploads-immediate.sh
  docs/BLUE-GREEN-DEPLOYMENT.md
  ```

- [ ] **Step 2: Keep these files** (still needed)
  ```
  docker-compose.blue.yml (keep temporarily for rollback reference, delete later)
  docker/nginx/nginx.blue.conf (keep temporarily for rollback)
  docker/nginx/nginx-main.conf (keep for reference)
  docker/nginx/snippets/ssl-params.conf (actively used)
  ```

- [ ] **Step 3: Commit**

## Task 7: Production migration

- [ ] **Step 1: Stop nginx-main**
  ```bash
  docker stop nginx-main && docker rm nginx-main
  ```

- [ ] **Step 2: Stop blue services**
  ```bash
  docker compose -f docker-compose.blue.yml down
  ```

- [ ] **Step 3: Move uploads**
  ```bash
  # Move blue uploads to root uploads dir
  cp -a backend/uploads/blue/* backend/uploads/ 2>/dev/null
  # Keep blue dir until verified
  ```

- [ ] **Step 4: Move logs and data**
  ```bash
  mkdir -p logs/backend logs/nginx
  cp -a logs/blue/backend/* logs/backend/ 2>/dev/null
  cp -a logs/blue/nginx/* logs/nginx/ 2>/dev/null
  mkdir -p backend/data
  cp -a backend/data/blue/* backend/data/ 2>/dev/null
  ```

- [ ] **Step 5: Start production**
  ```bash
  docker compose -f docker-compose.production.yml up -d
  ```

- [ ] **Step 6: Verify**
  ```bash
  curl -k https://localhost/health
  # Expected: "production-healthy"
  curl https://spherosegapp.utia.cas.cz/health
  # Expected: "production-healthy"
  ```

- [ ] **Step 7: Verify Maptimize**
  ```bash
  curl -k https://localhost/health -H "Host: maptimize.utia.cas.cz"
  # Expected: "maptimize-healthy"
  ```
