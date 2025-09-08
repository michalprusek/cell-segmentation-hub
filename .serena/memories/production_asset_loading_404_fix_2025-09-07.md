# Production Asset Loading 404 Fix - September 7, 2025

## Problem Summary

Production application experiencing two critical errors:

1. JavaScript assets returning HTML (404 pages) instead of JS files, causing "Failed to fetch dynamically imported module" errors
2. React DevTools error: "Cannot read properties of undefined (reading 'displayName')"

## Root Causes

1. **Asset Hash Mismatch**: Browser cached old index.html with references to old asset hashes (e.g., TermsOfService-DMvIOj_T.js) while container had new assets with different hashes
2. **Nginx Configuration Issue**: Nested location blocks in nginx.prod.conf were not working correctly, preventing proper cache headers for HTML files
3. **Frontend Container Fallback**: Frontend nginx was serving index.html for ALL missing files instead of returning proper 404s

## Solution Implemented

### 1. Fixed Nginx Production Configuration

**File**: `/docker/nginx/nginx.prod.conf`

Moved HTML and asset location blocks to the same level (not nested):

```nginx
# Cache control for HTML files (MUST be before catch-all)
location ~* \.(html|htm)$ {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Prevent caching of HTML files
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
}

# Cache static assets with hashes
location ~* \.(js|css|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    expires 1y;
    add_header Cache-Control "public, immutable" always;
}

# Frontend catch-all (MUST be last)
location / {
    proxy_pass http://frontend;
    # ... rest of config
}
```

### 2. Frontend Container Nginx Already Fixed

**File**: `/docker/frontend.prod.Dockerfile`

The frontend container nginx configuration was already correct:

```nginx
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

### 3. React Components displayName Already Fixed

The three problematic components already had displayName properties set:

- TermsOfService.tsx (line 167-168)
- PrivacyPolicy.tsx (line 287-288)
- Documentation.tsx (line 819-820)

Pattern used:

```typescript
ComponentName.displayName = 'ComponentName';
export default ComponentName;
```

## Deployment Steps

1. Update nginx.prod.conf with fixed location blocks
2. Reload nginx configuration: `docker exec nginx-blue nginx -s reload`
3. Rebuild frontend container: `docker compose -f docker-compose.blue.yml build blue-frontend --no-cache`
4. Restart frontend container: `docker compose -f docker-compose.blue.yml up -d blue-frontend`

## Verification

- Missing assets now return proper 404 status codes
- Existing assets serve with correct JavaScript MIME type
- HTML files have no-cache headers to prevent stale index.html
- React DevTools no longer shows displayName errors

## Prevention

1. Always test nginx configuration changes with `nginx -t` before deploying
2. Ensure location blocks are at the correct nesting level in nginx
3. Add displayName to all lazy-loaded components
4. Use consistent asset naming patterns in Vite configuration
5. Test asset loading after deployments

## Key Lessons

- Nginx location blocks must be at the same level to work correctly (not nested)
- Browser cache of index.html can cause asset hash mismatches after deployments
- Frontend container nginx must return 404 for missing assets, not fallback to index.html
- React production builds need explicit displayName for DevTools compatibility
