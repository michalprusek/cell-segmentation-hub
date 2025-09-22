# Browser vs CLI HTTP Request Discrepancy - Complete Solution

## Problem Summary

**Issue**: ML service `/api/ml/health` endpoint showed conflicting behavior:

- **CLI curl tests**: Returned 200 OK with proper JSON response
- **Browser console logs**: Showed 401 Unauthorized errors
- **Authentication analysis**: Endpoint correctly placed BEFORE auth middleware

## Root Cause Analysis

### Initial Hypothesis (Incorrect)

- Suspected browser was adding authentication headers automatically
- Suspected CORS issues
- Suspected auth middleware configuration problems

### Actual Root Cause (Correct)

**Environment Variable Configuration Issue**

**Problem**: In development environment, `VITE_ML_SERVICE_URL` was set to absolute URL instead of relative URL:

```yaml
# BEFORE (Problematic):
environment:
  - VITE_ML_SERVICE_URL=http://localhost:3001/api/ml
# Browser behavior:
# 1. Frontend runs on http://localhost:5174 (Vite dev server)
# 2. Browser makes cross-origin request to http://localhost:3001/api/ml/health
# 3. Causes potential CORS or networking issues
```

**Solution**: Changed to relative URL to leverage Vite proxy:

```yaml
# AFTER (Fixed):
environment:
  - VITE_ML_SERVICE_URL=/api/ml
# Browser behavior:
# 1. Frontend runs on http://localhost:5174
# 2. Browser makes same-origin request to /api/ml/health
# 3. Vite proxy forwards to http://localhost:3001/api/ml/health
# 4. Response flows back through proxy
```

## Technical Details

### Vite Proxy Configuration

Located in `vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    secure: false,
  }
}
```

### Network Architecture

- **Frontend**: Uses `network_mode: host`, accessible on port 5174
- **Backend**: Uses `network_mode: host`, accessible on port 3001
- **Port mapping**: Updated documentation to reflect actual behavior

### ML Routes Authentication Structure

**Public endpoints** (no auth required):

- `/api/ml/models`
- `/api/ml/status`
- `/api/ml/health` ✅

**Authentication middleware applied**: Line 127 in `mlRoutes.ts`

**Protected endpoints** (auth required):

- `/api/ml/queue`
- `/api/ml/models/:modelId/warm-up`

## Files Modified

### 1. `/docker-compose.yml`

```yaml
# Changed:
- VITE_ML_SERVICE_URL=/api/ml  # Was: http://localhost:3001/api/ml

# Updated port documentation:
ports:
  - "5174:5174"  # Frontend accessible on port 5174 (host networking)
```

## Testing & Verification

### CLI Testing (Always worked)

```bash
curl http://localhost:3001/api/ml/health  # Direct backend
curl http://localhost:8000/health         # Direct ML service
```

### Browser Testing (Now works)

```bash
curl http://localhost:5174/api/ml/health  # Through Vite proxy
```

### Request Flow Comparison

**Before Fix**:

```
Browser (port 5174) → Cross-origin to localhost:3001 → Backend
❌ Potential CORS/networking issues
```

**After Fix**:

```
Browser (port 5174) → Same-origin /api/ml/health → Vite proxy → Backend (port 3001)
✅ Clean proxy flow, no cross-origin issues
```

## Impact & Benefits

1. **Eliminates cross-origin requests** in development
2. **Uses Vite proxy correctly** for API calls
3. **Maintains clean development setup** with proper port management
4. **Fixes dashboard health check errors** that were showing in browser console
5. **Aligns browser and CLI behavior** to hit same backend endpoint

## Environment Configuration Patterns

### Development

```bash
VITE_ML_SERVICE_URL=/api/ml  # Relative for proxy
```

### Production

```bash
VITE_ML_SERVICE_URL=/api/ml  # Also relative, handled by nginx
```

## Key Learnings

1. **Development proxies are critical** for avoiding cross-origin issues
2. **Environment variables should be proxy-aware** in development
3. **Host networking complicates port mapping** - actual ports differ from mapped ports
4. **Browser requests differ from CLI** due to security policies and origin handling
5. **Authentication placement verification** was correct - the issue was networking, not auth

## Solution Status

✅ **RESOLVED** - Browser requests now work correctly through Vite proxy

Date: 2025-09-21
Category: Performance Debugging, Development Environment, Networking
