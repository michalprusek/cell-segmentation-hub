# 502 Bad Gateway Error Fix - JWT Configuration Issue

## Problem Summary

- **Error**: 502 Bad Gateway when attempting to sign in
- **Root Cause**: Backend service crashing due to invalid JWT_ACCESS_SECRET configuration
- **Impact**: Authentication completely broken, backend repeatedly restarting

## Root Cause Analysis

### 1. JWT Secret Mismatch

The docker-compose.yml had hardcoded JWT secrets that didn't match the validation requirements:

- **Hardcoded values**: Different 64-char hex strings in docker-compose.yml
- **Backend .env file**: Had correct 64-char hex strings
- **Result**: Container used hardcoded values, which failed validation

### 2. Missing Frontend Proxy Configuration

- Vite dev server lacked proxy configuration for API routes
- Frontend couldn't forward API requests to backend
- Led to 502 errors even when backend was running

### 3. Port Configuration Issue

- Frontend using `network_mode: host` runs on port 5173 (not 3000)
- This wasn't immediately obvious from docker-compose configuration

## Solution Implementation

### 1. Fixed JWT Secrets in docker-compose.yml

```yaml
environment:
  - JWT_ACCESS_SECRET=b75d09c9e67acfe64cf2ff2ebe704648b2b6deba44b1eea6bed51a66b325fd41
  - JWT_REFRESH_SECRET=b1e6ae77c4da116fe524c057879c0779a7fe5f3cc26a59bbc1ab3ef482bc0a3d
```

### 2. Added Vite Proxy Configuration

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      secure: false,
    },
    '/socket.io': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: true,
    },
  },
}
```

### 3. Container Restart Sequence

1. Updated docker-compose.yml with correct JWT secrets
2. Restarted backend container
3. Restarted frontend container to apply proxy config

## Verification Steps

1. **Backend Health Check**: `curl http://localhost:3001/health`
2. **Direct API Test**: `curl -X POST http://localhost:3001/api/auth/login`
3. **Frontend Proxy Test**: `curl -X POST http://localhost:5173/api/auth/login`
4. **All tests passed successfully**

## Key Learnings

### Environment Variable Priority

- Docker-compose environment variables override .env files
- Hardcoded values in docker-compose.yml take precedence
- Best practice: Use environment variable references, not hardcoded values

### Vite Proxy Requirements

- Vite dev server needs explicit proxy configuration
- Without proxy, frontend can't reach backend services
- Proxy must handle both HTTP and WebSocket connections

### Port Documentation

- Document actual ports used by services
- `network_mode: host` changes port exposure behavior
- Frontend on port 5173 (Vite default), not 3000

## Prevention Strategies

1. **Use Environment Variables Properly**

   ```yaml
   # Better approach
   environment:
     - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
     - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
   ```

2. **Centralize Configuration**
   - Keep secrets in .env files only
   - Reference them in docker-compose
   - Never hardcode sensitive values

3. **Add Health Checks**
   - Implement proper health check endpoints
   - Monitor service restarts
   - Alert on repeated crashes

4. **Document Service Ports**
   - Clearly document all service ports
   - Note any network mode configurations
   - Update when configurations change

## Related Issues

- JWT validation mismatch between config.ts and server.ts (previously fixed)
- TypeScript type definitions for AuthRequest (previously fixed)
- API routing 405 errors on production builds
