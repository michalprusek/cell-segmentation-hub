# Nginx Uploads 404 Debug Session - September 7, 2025

## Problem Summary

Upload files (thumbnails) are returning 404 when accessed via HTTPS through nginx, but return 200 OK when accessed directly through backend.

### Test Results

1. **Direct backend access - SUCCESS**:

   ```bash
   curl -I http://localhost:4001/uploads/dfd53950-e01e-41e5-8852-c5affa4aadd4/9ce96986-aacd-4dd7-80dc-ee575beeb832/thumbnails/1757259691265_f5_75.jpg
   # Returns: HTTP/1.1 200 OK
   ```

2. **Nginx from container to backend - SUCCESS**:

   ```bash
   docker exec nginx-main curl -s -I http://blue-backend:3001/uploads/path/to/file.jpg
   # Returns: HTTP/1.1 200 OK
   ```

3. **External HTTPS access through nginx - FAILS**:
   ```bash
   curl -I https://spherosegapp.utia.cas.cz/uploads/path/to/file.jpg
   # Returns: HTTP/2 404
   ```

### Configuration Analysis

**Nginx configuration file**: `/home/cvat/spheroseg-app/docker/nginx/nginx.ssl.conf`

- Main nginx container: `nginx-main` (ports 80, 443)
- Container mount: `/etc/nginx/nginx.conf` -> `nginx.ssl.conf`

**Upload route configuration** (FIXED):

```nginx
location /uploads/ {
    proxy_pass http://backend;  # Fixed: was http://backend/uploads/ (double prefix)
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;

    # Cache images for better performance
    add_header Cache-Control "public, max-age=86400";
}
```

**Backend upstream**:

```nginx
upstream backend {
    server blue-backend:3001;
}
```

### Environment Details

- **Blue environment active**: nginx routes to `blue-backend:3001`
- **File exists**: `/app/uploads/dfd53950-e01e-41e5-8852-c5affa4aadd4/9ce96986-aacd-4dd7-80dc-ee575beeb832/thumbnails/1757259691265_f5_75.jpg`
- **Backend serves correctly**: Express static middleware working
- **Container connectivity**: nginx-main can reach blue-backend:3001

### Issue Status: UNRESOLVED

Despite fixing the double `/uploads/` prefix issue and confirming:

1. Backend responds with 200 OK
2. Nginx can connect to backend
3. Configuration appears correct
4. SSL certificates present
5. Cache cleared

The external HTTPS requests still return 404.

### Next Steps for Investigation

1. **Enable nginx debug logs** to trace request routing
2. **Check if multiple nginx configs** are conflicting
3. **Verify nginx reload** actually took effect
4. **Test with different file paths** to isolate the issue
5. **Check Docker network connectivity** between nginx-main and blue-backend
6. **Examine nginx error logs** for specific errors

### Working Backend Configuration

Backend static file serving (confirmed working):

```javascript
// /backend/src/server.ts line 155
app.use('/uploads', express.static(config.UPLOAD_DIR || './uploads'));
```

Environment variables:

- `UPLOAD_DIR=/app/uploads`
- Files properly mounted via Docker volume

This suggests the issue is purely nginx-related routing, not backend configuration.
