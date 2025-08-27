# Green Production Deployment Fixes

## Issues Encountered and Resolved

### 1. Share Link Fix Deployment

Successfully deployed fix for share link project assignment after registration/login.

### 2. Database Connection Issues

**Problem**: Backend couldn't connect to database - authentication failed
**Root Causes**:

- Hardcoded password in docker-compose.green.yml instead of using environment variable
- Missing .env.green file with proper credentials
- Database volume had old password from previous deployment

### 3. Solutions Applied

#### Created .env.green file:

```
DATABASE_URL="postgresql://spheroseg:spheroseg_green_2024@postgres-green:5432/spheroseg_green?schema=public"
DB_PASSWORD=spheroseg_green_2024
POSTGRES_PASSWORD=spheroseg_green_2024
JWT_ACCESS_SECRET=green_access_secret_2024_secure_key
JWT_REFRESH_SECRET=green_refresh_secret_2024_secure_key
```

#### Fixed docker-compose.green.yml:

- Changed `POSTGRES_PASSWORD=spheroseg` to `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`
- DATABASE_URL already used ${DB_PASSWORD} variable correctly

#### Deployment Steps:

1. Stop containers: `docker-compose --env-file .env.green -f docker-compose.green.yml down -v`
2. Start with env file: `docker-compose --env-file .env.green -f docker-compose.green.yml up -d`
3. Run database migrations in container network
4. Restart backend container

### 4. Final Status

- All containers healthy (nginx, backend, frontend, ml, postgres, redis)
- API responding correctly on port 5001
- Database connected and operational
- Share link fix successfully deployed

## Key Learnings

1. Always use --env-file parameter with docker-compose for environment-specific deployments
2. Ensure environment variables in docker-compose files use ${VAR} syntax
3. Delete database volumes when changing passwords to avoid authentication issues
4. Run Prisma migrations in same network as database container

## URLs

- Frontend: http://localhost:5000
- Backend API: http://localhost:5001
- ML Service: http://localhost:5008
- Public: https://spherosegapp.utia.cas.cz (via nginx)
