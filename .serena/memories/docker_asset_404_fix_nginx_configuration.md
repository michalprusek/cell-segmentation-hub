# Docker Asset 404 Fix - Nginx Configuration Issue

## Problem Description

JavaScript assets were returning 404 HTML pages instead of actual JS files in production Blue-Green deployment.

## Root Cause Analysis

1. **Asset Hash Mismatch**: Browser requests assets with old hashes (e.g., `TermsOfService-DMvIOj_T.js`) but container has assets with new hashes (e.g., `TermsOfService-B3eLvAWh.js`)
2. **Frontend Nginx Fallback Issue**: Frontend container nginx config was falling back to `index.html` for ALL missing files instead of returning 404
3. **HTML Caching Issue**: Production nginx lacked no-cache headers for HTML files, allowing browser to cache stale `index.html`

## Solutions Implemented

### 1. Frontend Container Nginx Fix (docker/frontend.prod.Dockerfile)

```nginx
# OLD - Falls back to index.html for ALL requests
location / {
    try_files $uri $uri/ /index.html;
}

# NEW - Static assets return 404, only SPA routes fall back to index.html
# Static assets - serve directly or return 404
location ~* \.(js|css|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# SPA fallback for all other routes
location / {
    try_files $uri $uri/ /index.html;
}
```

### 2. Production Nginx HTML No-Cache Fix (docker/nginx/nginx.blue.local.conf)

```nginx
# No cache for HTML files to prevent stale index.html (MUST be first)
location ~* \.(html|htm)$ {
    proxy_pass http://frontend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
}
```

## Verification Steps

1. Missing assets now return 404 instead of HTML: `curl -I http://frontend/assets/nonexistent.js` → 404
2. Existing assets serve correctly: `curl http://frontend/assets/existing.js` → JavaScript content
3. HTML files have no-cache headers: `curl -I http://production-nginx/index.html` → Cache-Control: no-cache

## Deployment Requirements

1. Rebuild frontend container with fixed nginx config
2. Update production nginx configuration (both blue and green environments)
3. Apply same fixes to main nginx.prod.conf for live production

## Critical Notes

- **Location block order matters**: Regex locations must come before catch-all `/` location
- **Always use `always` flag** for headers to ensure they're sent even on error responses
- **Test both missing and existing assets** to ensure correct behavior
- **Apply to all environments**: dev, blue, green, and production nginx configs

## Related Files

- `/docker/frontend.prod.Dockerfile` - Frontend nginx config
- `/docker/nginx/nginx.blue.local.conf` - Blue environment nginx
- `/docker/nginx/nginx.prod.conf` - Production nginx (needs same fix)
- `/docker-compose.blue.yml` - Blue environment setup
