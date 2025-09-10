# SSL Protocol Error and Database Migration Fix for Local Development

## Problem

After Docker rebuild, two critical issues occurred:

1. **SSL Protocol Error**: Frontend showing `ERR_SSL_PROTOCOL_ERROR` when trying to login
   - Error: `POST https://spherosegapp.utia.cas.cz/api/auth/login net::ERR_SSL_PROTOCOL_ERROR`
2. **Database Missing Tables**: Backend showing `The table 'public.segmentation_queue' does not exist`

## Root Causes

1. **SSL Error**: Frontend was accessing the application via production URL (https://spherosegapp.utia.cas.cz) instead of localhost
   - Frontend built with relative API URLs (`VITE_API_BASE_URL=/api`)
   - When accessed via production domain, it tries to use HTTPS which is disabled in local environment
2. **Database Error**: Prisma migrations were not applied after Docker rebuild
   - New database container didn't have the schema tables

## Solution

### 1. Database Migrations

```bash
# Apply all pending migrations
docker exec blue-backend npx prisma migrate deploy

# Restart backend to recognize new tables
docker restart blue-backend
```

### 2. SSL/Frontend Access

**IMPORTANT**: Access the application via localhost URLs, not production domain:

- Frontend: http://localhost:4000
- Backend API: http://localhost:4001
- ML Service: http://localhost:4008

### Why This Works

- Frontend is built with relative URLs (`/api`)
- When accessed via localhost:4000, API calls go to `http://localhost:4000/api`
- Nginx proxies these to the backend on port 4001
- No SSL certificates needed for local development

### Configuration Details

The blue environment runs on ports 4000-4008:

- `blue-frontend`: Port 4000
- `blue-backend`: Port 4001
- `blue-ml`: Port 4008
- `nginx-blue`: Ports 4080 (HTTP), 4443 (HTTPS disabled)

### Verification

```bash
# Check API is working
curl -X POST http://localhost:4001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'

# Should return authentication error (not network error)
```

## Prevention

1. Always access local development via localhost URLs
2. Run migrations after any database container rebuild
3. Use correct docker-compose file for environment (blue/green/dev)
4. Check `.active-environment` file to verify which environment is active
