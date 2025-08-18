# Production Networking Configuration Fix

## Problem Summary

The production deployment had networking issues due to mixed network modes:

- Backend and DB using `network_mode: "host"`
- Nginx and other services using bridge network `spheroseg-network`
- This caused external access failures and inter-service communication problems

## Solution Applied

### 1. Unified Bridge Networking

**All services now use the same bridge network**: `spheroseg-network`

### 2. Service Configuration Changes

#### Database (PostgreSQL)

- **Before**: `network_mode: "host"`
- **After**: Bridge network with exposed port for external admin access

```yaml
ports:
  - '5432:5432'
networks:
  - spheroseg-network
```

#### Backend API

- **Before**: `network_mode: "host"` with localhost connections
- **After**: Bridge network with internal exposure

```yaml
expose:
  - '3001'
networks:
  - spheroseg-network
environment:
  - DATABASE_URL=postgresql://spheroseg:${DB_PASSWORD}@db:5432/spheroseg_prod
  - REDIS_URL=redis://redis:6379
  - SEGMENTATION_SERVICE_URL=http://ml:8000
```

#### ML Service

- **Before**: External port mapping `8000:8000`
- **After**: Internal exposure only

```yaml
expose:
  - '8000'
```

#### Redis

- **Before**: External port mapping `6379:6379`
- **After**: Internal exposure only

```yaml
expose:
  - '6379'
```

### 3. Nginx Configuration Updates

#### Upstream Services

```nginx
# Before
upstream backend_upstream {
    server host.docker.internal:3001;
}
upstream ml_upstream {
    server host.docker.internal:8000;
}

# After
upstream backend_upstream {
    server backend:3001;
}
upstream ml_upstream {
    server ml:8000;
}
```

#### Removed Dependencies

- Removed `extra_hosts` configuration for `host.docker.internal`
- Removed unused `frontend_upstream` (nginx serves static files directly)

## Benefits

1. **Proper Service Discovery**: All services can find each other using Docker's built-in DNS
2. **Enhanced Security**: Internal services not exposed to host network
3. **Consistent Networking**: Single network model across all containers
4. **External Access**: Only nginx exposes ports 80/443 for public access
5. **Better Isolation**: Services isolated from host network for security

## Verification Steps

1. **Start the stack**:

   ```bash
   docker-compose -f docker-compose.production.yml up -d
   ```

2. **Check service health**:

   ```bash
   docker-compose -f docker-compose.production.yml ps
   ```

3. **Test external access**:

   ```bash
   curl -k https://spherosegapp.utia.cas.cz/health
   ```

4. **Verify inter-service communication**:
   ```bash
   docker exec spheroseg-backend curl -f http://ml:8000/health
   docker exec spheroseg-backend nc -z db 5432
   ```

## Files Modified

1. `/docker-compose.production.yml` - Network mode and service configuration changes
2. `/docker/nginx/nginx.prod.conf` - Upstream service endpoints updated

The application should now be fully accessible externally via https://spherosegapp.utia.cas.cz while maintaining proper inter-service communication.
