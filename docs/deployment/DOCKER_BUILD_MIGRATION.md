# Docker Build System Migration Guide

## What Changed (2025-09-10)

### New Optimized Build System

A comprehensive Docker optimization system has been implemented to solve disk space issues and improve build efficiency.

## Migration Steps

### 1. Update Your Commands

**OLD Commands (Don't Use):**

```bash
make build
docker compose build
```

**NEW Commands (Use These):**

```bash
make build-optimized                 # Build every production image
make build-service SERVICE=frontend  # Build a single service
make build-clean                     # Full rebuild without cache
```

> **`scripts/smart-docker-build.sh` no longer works.** Every environment it
> can select names a Compose file that was deleted with blue-green on
> 2026-05-15 (`--env blue` → `docker-compose.blue.yml`, `--env green` →
> `docker-compose.green.yml`) or one that is not tracked (its `development`
> default → `docker-compose.yml`). Use the `make` targets above, which drive
> `docker-compose.production.yml` directly.

### 2. Cleanup Commands

**NEW Cleanup Commands:**

```bash
make docker-usage         # Check current usage
make optimize-storage     # Regular cleanup
make deep-clean          # Aggressive cleanup

# Emergency cleanup:
./scripts/docker-build-optimizer.sh --aggressive
```

### 3. Files Updated

`docker-compose.production.yml` builds every service from the optimized
Dockerfiles. It is the only Compose file that describes the running stack;
`docker-compose.blue.yml` and `docker-compose.green.yml` were deleted with
blue-green on 2026-05-15.

### 4. Deprecated Files

Every Dockerfile earlier revisions of this page told you to migrate away
from — `docker/frontend.Dockerfile`, `docker/backend.Dockerfile`,
`docker/ml.Dockerfile`, `docker/frontend.prod.Dockerfile`,
`docker/backend.prod.Dockerfile` — has since been deleted. `docker/` now holds
`frontend.optimized.Dockerfile`, `backend.optimized.Dockerfile`,
`ml.optimized.Dockerfile`, `ml-gpu.Dockerfile` and `essays.Dockerfile`, and
`docker-compose.production.yml` already points at the right one per service.
There is nothing left to migrate.

## Benefits of New System

### Automatic Features

- ✅ Pre-build cleanup (prevents disk overflow)
- ✅ Smart caching (faster rebuilds)
- ✅ Image size limits (alerts on bloat)
- ✅ Keeps only 2 latest images per service
- ✅ Parallel builds when possible

### Size Reductions

- ML Service: 10GB → 4GB (60% smaller)
- Backend: 2GB → 750MB (62% smaller)
- Frontend: 200MB → 60MB (70% smaller)

### Speed Improvements

- Initial builds: 30-50% faster
- Incremental builds: 60-80% faster
- Cache management: Automatic

## Quick Start Guide

### Daily Development

```bash
# Check space before starting
make docker-usage

# Build with optimization
make build-optimized

# Start services (no docker-compose.yml is tracked, so pass the production one)
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```

### Production Deployment

```bash
# 1. Build the changed service
make build-service SERVICE=backend

# 2. Verify sizes
make docker-usage

# 3. Recreate it (repeat per service)
docker compose -f docker-compose.production.yml --env-file .env.production \
  up -d --no-deps --force-recreate backend

# 4. Flush nginx's upstream DNS cache after a backend recreate
docker restart spheroseg-nginx
```

### When Low on Space

```bash
# Quick cleanup
make optimize-storage

# Aggressive cleanup
make deep-clean

# Check what was cleaned
make docker-usage
```

## Troubleshooting

### If Build Fails

```bash
# Try clean build
make build-clean

# Or with specific service
make build-service SERVICE=frontend
```

### If Space Issues Persist

```bash
# Run aggressive cleanup
./scripts/docker-build-optimizer.sh --aggressive

# Check what's using space
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | sort -k3 -h
```

### Monitor Build Sizes

```bash
# Full analysis
./scripts/docker-monitor.sh

# Just check sizes
./scripts/docker-monitor.sh --sizes
```

## Important Notes

1. **Always use optimized commands** - They handle cleanup automatically
2. **Don't use old Dockerfiles** - All compose files point to optimized versions
3. **Monitor regularly** - Run `make docker-usage` weekly
4. **Emergency cleanup exists** - Use `--aggressive` flag when critical

## Support

For issues:

1. Check current usage: `make docker-usage`
2. Run monitoring: `./scripts/docker-monitor.sh`
3. Review logs: `logs/docker/`

## Configuration

Main config file: `docker/build-config.json`

- Adjust size limits
- Change retention policies
- Configure cache settings
