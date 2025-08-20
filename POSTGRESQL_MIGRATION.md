# PostgreSQL Migration Guide

## Overview

This PR migrates the application from SQLite to PostgreSQL for production readiness.

## Breaking Changes

- **SQLite is no longer supported** - All environments must use PostgreSQL
- **DATABASE_URL** format has changed from `file:./data/dev.db` to `postgresql://user:password@host:port/database`
- **New required environment variables**: `DB_USER`, `DB_PASSWORD`, `DB_NAME`

## Migration Steps

### 1. For New Installations

```bash
# Set environment variables
export DB_USER=spheroseg
export DB_PASSWORD=your_secure_password
export DB_NAME=spheroseg

# Start services with PostgreSQL
docker compose -f docker-compose.postgres.yml up -d

# Run migrations
docker exec spheroseg-backend npx prisma migrate deploy
```

### 2. For Existing Installations (Data Migration)

#### Option A: Export/Import via JSON

```bash
# 1. Export data from SQLite
docker exec spheroseg-backend npx prisma db pull
docker exec spheroseg-backend node scripts/export-sqlite-data.js

# 2. Stop services
docker compose down

# 3. Start with PostgreSQL
docker compose -f docker-compose.postgres.yml up -d

# 4. Import data
docker exec spheroseg-backend node scripts/import-to-postgres.js
```

#### Option B: Fresh Start (Recommended for development)

```bash
# 1. Backup uploads directory
cp -r backend/uploads backend/uploads.backup

# 2. Remove old SQLite data
rm -rf backend/data

# 3. Start with PostgreSQL
docker compose -f docker-compose.postgres.yml up -d

# 4. Restore uploads
cp -r backend/uploads.backup/* backend/uploads/
```

## Configuration Changes

### Environment Variables (.env)

```env
# Old (SQLite)
DATABASE_URL=file:./data/dev.db

# New (PostgreSQL)
DATABASE_URL=postgresql://spheroseg:password@postgres:5432/spheroseg
DB_USER=spheroseg
DB_PASSWORD=your_secure_password
DB_NAME=spheroseg
```

### Prisma Schema Updates

- Changed provider from `sqlite` to `postgresql`
- Added proper indexes for performance
- Added cascade delete constraints

## Performance Improvements

- Connection pooling enabled by default
- Proper indexes on foreign keys
- Optimized queries with PostgreSQL-specific features

## Rollback Procedure

If you need to rollback to SQLite:

1. Checkout previous commit: `git checkout HEAD~1`
2. Restore SQLite database: `cp backend/data.backup/dev.db backend/data/`
3. Start old services: `docker compose up -d`

## Testing

```bash
# Verify PostgreSQL connection
docker exec spheroseg-backend npx prisma db push --skip-generate

# Run migrations
docker exec spheroseg-backend npx prisma migrate deploy

# Test database operations
docker exec spheroseg-backend npm test
```

## Known Issues

- First startup may take longer due to database initialization
- Ensure PostgreSQL has sufficient memory allocation (minimum 512MB)

## Support

For migration issues, please open an issue on GitHub with:

- Error messages
- Docker logs: `docker compose logs postgres backend`
- Environment details
