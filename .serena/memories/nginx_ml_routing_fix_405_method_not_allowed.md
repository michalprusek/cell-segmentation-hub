# Nginx ML Routing Fix: 405 Method Not Allowed

## Problem

Frontend calls to `/api/ml/status` were returning 405 Method Not Allowed because:

1. **ML service expects `/api/v1/` prefix**: FastAPI routes are mounted with `/api/v1` prefix in `main.py`
2. **Nginx was stripping wrong path**: nginx `/api/ml/` location was stripping to `/` instead of `/api/v1/`
3. **Location priority issue**: General `/api/` location was matching before specific `/api/ml/` locations

## Root Cause Analysis

- ML service (FastAPI) has routes mounted with `app.include_router(router, prefix="/api/v1")`
- Frontend calls `/api/ml/status`
- Nginx was routing this as `/status` to ML service instead of `/api/v1/status`

## Solution

Fixed in `/docker/nginx/nginx.blue.local.conf`:

```nginx
# Direct exact match for status endpoint (highest priority)
location = /api/ml/status {
    proxy_pass http://ml/api/v1/status;
    # ... other config
}

# General ML routes with path rewriting
location ^~ /api/ml/ {
    rewrite ^/api/ml/(.*)$ /api/v1/$1 break;
    proxy_pass http://ml;
    # ... other config
}
```

## Key Technical Points

1. **Exact match `location =`** has highest priority in nginx
2. **Docker volume mounting**: Changes to config files require container restart to take effect
3. **Path rewriting**: Use `rewrite` with `break` flag to modify paths before proxying
4. **Location order**: More specific locations must come before general ones

## Testing Commands

```bash
# Test status endpoint
curl -X GET http://localhost:4080/api/ml/status

# Should return:
{
  "status": "idle",
  "is_processing": false,
  "current_model": null,
  "queue_length": 0,
  "available": true,
  "timestamp": "2025-09-07T14:04:33.605604"
}

# Test models endpoint
curl -X GET http://localhost:4080/api/ml/models
```

## Production Deployment

Also update `/docker/nginx/nginx.prod.conf` with the same fix for production deployment.

## Files Modified

- `/docker/nginx/nginx.blue.local.conf` - Blue environment config
- `/docker/nginx/nginx.blue.conf` - Blue production config (also fixed)
- `/docker/nginx/nginx.prod.conf` - Production config (also fixed)

Date: 2025-09-07
