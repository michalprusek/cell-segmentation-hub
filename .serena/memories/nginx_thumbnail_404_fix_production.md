# Nginx Thumbnail 404 Fix on Production

## Problem

Thumbnail images returning 404 on production (spherosegapp.utia.cas.cz) even though files exist in backend container.

## Root Cause

Nginx configuration had two issues:

1. The `/uploads/` location block didn't use the `^~` priority prefix modifier
2. The static assets regex pattern `\.(js|css|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$` was catching ALL image files and routing them to frontend instead of backend

## Solution

Modified `/home/cvat/cell-segmentation-hub/docker/nginx/nginx.ssl.conf`:

1. Added `^~` prefix to uploads location block:

```nginx
# Uploads directory - USE PRIORITY PREFIX TO OVERRIDE REGEX
location ^~ /uploads/ {
    proxy_pass http://backend;
    # ... rest of config
}
```

2. Modified static assets regex to exclude /uploads/ path:

```nginx
# Cache static assets with hashes - EXCLUDE /uploads/ path
location ~* ^(?!/uploads/).*\.(js|css|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    proxy_pass http://frontend;
    # ... rest of config
}
```

## Important Notes

- nginx-main container uses bind mount: `/home/cvat/cell-segmentation-hub/docker/nginx/nginx.ssl.conf` → `/etc/nginx/nginx.conf`
- Cannot directly copy files to container due to bind mount (device busy error)
- Must edit the source file and restart container
- Thumbnails are stored in project-specific paths: `/uploads/[userId]/[projectId]/thumbnails/[filename].jpg`

## Testing

```bash
# Test thumbnail loading
curl -I https://spherosegapp.utia.cas.cz/uploads/[userId]/[projectId]/thumbnails/[filename].jpg

# Should return HTTP 200 with content-type: image/jpeg
```

## Commands

```bash
# Backup configuration
cp docker/nginx/nginx.ssl.conf docker/nginx/nginx.ssl.conf.backup-$(date +%Y%m%d-%H%M%S)

# Edit configuration
vim docker/nginx/nginx.ssl.conf

# Restart nginx
docker restart nginx-main

# Verify configuration
docker exec nginx-main nginx -t
```
