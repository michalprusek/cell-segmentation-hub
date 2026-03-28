# Simplify Deployment: Remove Blue-Green, Single Production Compose

## Problem

The blue-green deployment system adds ~50 files of complexity (7 compose files, 10 nginx configs, 27 shell scripts, 5 env files) for a capability that has never been used. Green has never been deployed. The user always rebuilds production (blue) directly. The system is overkill for a single-server, single-developer deployment.

## Design

### Target State

One production compose file. One env file. One nginx config. No switching, no color naming.

```
docker-compose.production.yml   # All services including nginx
.env.production                 # Merged from .env.common + .env.blue
docker/nginx/nginx.production.conf  # Static, no template system
```

### Service Naming

| Before                  | After                      |
| ----------------------- | -------------------------- |
| blue-frontend           | frontend                   |
| blue-backend            | backend                    |
| blue-ml                 | ml                         |
| postgres-blue           | postgres                   |
| redis-blue              | redis                      |
| nginx-blue + nginx-main | nginx (single, in compose) |

### Ports (unchanged externally)

- nginx: 80 (HTTP redirect) + 443 (HTTPS) — exposed to host
- frontend: 4000 (internal, nginx proxies)
- backend: 4001 (internal + exposed for direct API access)
- ML: 4008 (internal + exposed for direct access)
- PostgreSQL: 5432 (internal only)
- Redis: 6379 (internal only)

### Network

- `spheroseg-blue` → `spheroseg`

### Database

- Keep `spheroseg_blue` as database name (renaming risks data issues)
- Container renamed `postgres-blue` → `postgres`
- Preserve existing named volume

### Uploads

- Move `backend/uploads/blue/*` → `backend/uploads/`
- Remove `backend/uploads/blue/` directory
- Update volume mount: `./backend/uploads:/app/uploads`

### nginx-main Integration

Currently nginx-main runs as a standalone `docker run` command. Move it into `docker-compose.production.yml` as the `nginx` service with:

- SSL termination (Let's Encrypt certs at `/etc/letsencrypt/`)
- Static nginx.production.conf (no template system)
- Ports 80 and 443 exposed
- Volume mounts for certs, uploads, nginx config, snippets

### Files to Delete

**Docker compose:**

- `docker-compose.green.yml`
- `docker-compose.green.gpu.yml`
- `docker-compose.active.yml`
- `docker-compose.yml` (unused base)

**Environment:**

- `.env.blue` (merged into .env.production)
- `.env.green`
- `.env.common` (merged into .env.production)
- `.env.blue.production` (merged into .env.production)
- `.active-environment`

**Nginx:**

- `docker/nginx/nginx.template.conf`
- `docker/nginx/nginx.green.conf`
- `docker/nginx/nginx.active.conf` (symlink)
- `docker/nginx/nginx.blue.local.conf`
- `docker/nginx/nginx.main-router.conf`
- `docker/nginx/nginx.ssl.conf`
- `docker/nginx/spheroseg.conf`

**Scripts (green/switch related):**

- `scripts/switch-environment.sh`
- `scripts/switch-blue-green.sh`
- `scripts/switch-nginx-upstream.sh`
- `scripts/deploy-blue-green.sh`
- `scripts/init-green-db.sh`
- `scripts/fix-green-uploads.sh`
- `scripts/fix-green-uploads-immediate.sh`

**Docs:**

- `docs/BLUE-GREEN-DEPLOYMENT.md`

### Files to Modify

- `docker-compose.blue.yml` → rename to `docker-compose.production.yml`, update service names, add nginx service
- `docker/nginx/nginx.blue.conf` → rename to `nginx.production.conf`, update upstream names
- `Makefile` → update targets to use `docker-compose.production.yml`
- `CLAUDE.md` → remove all blue-green references
- `scripts/smart-docker-build.sh` → remove blue/green env parameter
- `scripts/deploy-production.sh` → simplify to use single compose file
- `.husky/pre-commit` → remove environment checks if any

### Migration Steps (Production)

```bash
# 1. Stop current services
docker compose -f docker-compose.blue.yml down
docker stop nginx-main && docker rm nginx-main

# 2. Move uploads
mv backend/uploads/blue/* backend/uploads/ 2>/dev/null
rmdir backend/uploads/blue 2>/dev/null

# 3. Start with new config
docker compose -f docker-compose.production.yml up -d

# 4. Verify
curl https://spherosegapp.utia.cas.cz/health
```

Expected downtime: 2-5 minutes.

### Risks

1. **Database volume**: Docker named volume is tied to old container name. May need to map existing volume to new container.
2. **nginx-main removal**: The standalone nginx-main must be stopped before the compose nginx starts (port conflict on 80/443).
3. **Upload paths**: Any images with absolute paths stored in DB will still work since the mount point `/app/uploads` stays the same inside the container.
