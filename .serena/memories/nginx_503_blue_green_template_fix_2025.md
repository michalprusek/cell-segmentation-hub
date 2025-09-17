# Nginx 503 Service Unavailable Fix with Blue-Green Template System

## Problem

Production was experiencing 503 Service Unavailable errors when frontend made 84+ simultaneous requests to `/api/segmentation/images/{uuid}/results` endpoints. Root cause: nginx rate limiting (30 req/s, burst 50) was too restrictive for bulk segmentation result fetching.

## Solution

Created a clean, maintainable blue-green deployment system with template-based nginx configuration that:

1. Increases rate limits for segmentation endpoints (100 req/s, burst 100)
2. Enables easy switching between blue/green environments
3. Properly handles nginx variable substitution

## Key Implementation Details

### Template Variable System

The template uses NGINX*VAR* prefix for nginx runtime variables to prevent envsubst conflicts:

- Shell variables: `${BACKEND_SERVICE}`, `${NGINX_HTTP_PORT}` - substituted during generation
- Nginx variables: `NGINX_VAR_host` → `$host`, `NGINX_VAR_remote_addr` → `$remote_addr` - preserved for nginx

### Rate Limiting Configuration

```nginx
# In nginx.template.conf
limit_req_zone NGINX_VAR_binary_remote_addr zone=segmentation:10m rate=100r/s;

# Segmentation endpoints
location ~ ^/api/segmentation/images/[^/]+/results$ {
    limit_req zone=segmentation burst=100 nodelay;
    limit_conn addr 15;
    proxy_read_timeout 300s;
}
```

### Environment Switching Script

Location: `/home/cvat/spheroseg-app/scripts/switch-environment.sh`

Key processing line:

```bash
envsubst < docker/nginx/nginx.template.conf | sed 's/NGINX_VAR_/$/g' > docker/nginx/nginx.${DEPLOYMENT_COLOR}.conf
```

### Files Structure

```
.env.blue / .env.green     # Environment-specific variables
.env.common                # Shared configuration
nginx.template.conf        # Master template with variables
nginx.active.conf          # Symlink to active environment
.active-environment        # Current environment status
```

### Critical Fixes Applied

1. Changed `${VAR:-default}` to `${VAR}` - envsubst doesn't support default values
2. Fixed SSL snippets path: hardcoded `/etc/letsencrypt/live/spherosegapp.utia.cas.cz/chain.pem`
3. Updated http2 directive: `listen 443 ssl; http2 on;` (deprecated syntax fixed)
4. Commented out missing dhparam.pem reference

## Usage

```bash
# Switch environments
./scripts/switch-environment.sh blue
./scripts/switch-environment.sh green

# Start nginx-main container
docker run -d --name nginx-main \
  --network spheroseg-blue \
  -v /home/cvat/spheroseg-app/docker/nginx/nginx.active.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -p 80:4080 -p 443:4443 \
  nginx:alpine

# Reload configuration
docker exec nginx-main nginx -s reload
```

## Port Mapping

- Blue: 4000-4008 (HTTP: 4080, HTTPS: 4443)
- Green: 5000-5008 (HTTP: 5080, HTTPS: 5443)

## Testing

```bash
# Health check
curl http://localhost/health
# Returns: "blue-production-healthy" or "green-production-healthy"

# Verify rate limits
grep "limit_req zone=segmentation" docker/nginx/nginx.active.conf
```

## Benefits

- Eliminates 503 errors for bulk segmentation requests
- Clean separation between environments
- Easy rollback capability
- Single source of truth for configuration
- Proper handling of nginx vs shell variables
