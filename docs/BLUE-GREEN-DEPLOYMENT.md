# Blue-Green Deployment System

## Overview

This document describes the clean, maintainable blue-green deployment system for spherosegapp.utia.cas.cz that resolves the 503 Service Unavailable errors caused by nginx rate limiting during bulk segmentation requests.

## Problem Solved

The frontend was making 84+ simultaneous requests to `/api/segmentation/images/{uuid}/results` endpoints, which exceeded nginx's default rate limiting (30 req/s with burst of 50), causing 503 errors. The solution implements:

1. **Increased rate limits** for segmentation endpoints: 100 req/s with burst of 100
2. **Clean blue-green deployment** system for easy environment switching
3. **Template-based configuration** that properly handles nginx variables

## Architecture

### Environment Structure

- **Blue Environment** (Production - Active)
  - Ports: 4000-4008 (HTTP: 4080, HTTPS: 4443)
  - Services: blue-frontend, blue-backend, blue-ml
  - Database: spheroseg_blue
  - Network: spheroseg-blue

- **Green Environment** (Staging)
  - Ports: 5000-5008 (HTTP: 5080, HTTPS: 5443)
  - Services: green-frontend, green-backend, green-ml
  - Database: spheroseg_green
  - Network: spheroseg-green

### Key Files

```
/home/cvat/cell-segmentation-hub/
├── .env.blue                           # Blue environment variables
├── .env.green                          # Green environment variables
├── .env.common                         # Shared environment variables
├── .active-environment                 # Current active environment status
├── docker-compose.active.yml           # Auto-generated active config
├── docker/nginx/
│   ├── nginx.template.conf            # Master nginx template
│   ├── nginx.blue.conf                # Generated blue configuration
│   ├── nginx.green.conf               # Generated green configuration
│   ├── nginx.active.conf              # Symlink to active configuration
│   └── snippets/
│       └── ssl-params.conf            # Shared SSL parameters
└── scripts/
    └── switch-environment.sh          # Environment switching script
```

## Usage

### Switching Environments

```bash
# Switch to blue environment
./scripts/switch-environment.sh blue

# Switch to green environment
./scripts/switch-environment.sh green
```

The script will:

1. Load environment variables from `.env.common` and `.env.{color}`
2. Generate nginx configuration from template
3. Create symlink to active configuration
4. Generate docker-compose.active.yml
5. Update .active-environment status file
6. Show current configuration and service status

### Starting Services

```bash
# Start blue environment
docker compose -f docker-compose.blue.yml up -d

# Start green environment
docker compose -f docker-compose.green.yml up -d
```

### Nginx Management

```bash
# Start nginx-main container (after switching environment)
docker run -d \
  --name nginx-main \
  --network spheroseg-blue \
  -v /home/cvat/cell-segmentation-hub/docker/nginx/nginx.active.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /home/cvat/cell-segmentation-hub/backend/uploads:/app/uploads:ro \
  -v /home/cvat/cell-segmentation-hub/docker/nginx/snippets:/etc/nginx/snippets:ro \
  -p 80:4080 \
  -p 443:4443 \
  nginx:alpine

# Reload nginx configuration
docker exec nginx-main nginx -s reload

# Check nginx status
docker ps | grep nginx-main
docker logs nginx-main
```

## Configuration Details

### Rate Limiting Zones

The nginx template defines four rate limiting zones:

```nginx
limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=segmentation:10m rate=100r/s;  # Critical fix
limit_req_zone $binary_remote_addr zone=upload:10m rate=5r/s;
```

### Segmentation Endpoint Configuration

The critical configuration that fixes the 503 errors:

```nginx
# Segmentation results endpoints - higher limits for bulk requests
location ~ ^/api/segmentation/images/[^/]+/results$ {
    limit_req zone=segmentation burst=100 nodelay;
    limit_conn addr 15;

    proxy_pass http://backend;
    # ... proxy headers ...

    # Extended timeout for bulk result fetching
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    proxy_send_timeout 300s;
}
```

### Template Variable System

The template uses a special prefix system to distinguish between:

- **Shell variables** (substituted by envsubst): `${BACKEND_SERVICE}`, `${NGINX_HTTP_PORT}`
- **Nginx variables** (preserved for runtime): `NGINX_VAR_host` → `$host`, `NGINX_VAR_remote_addr` → `$remote_addr`

The switch script processes this with:

```bash
envsubst < docker/nginx/nginx.template.conf | sed 's/NGINX_VAR_/$/g' > docker/nginx/nginx.${DEPLOYMENT_COLOR}.conf
```

## Health Checks

Each environment provides health endpoints:

```bash
# HTTP health check
curl http://localhost/health
# Returns: "blue-production-healthy" or "green-production-healthy"

# Check via headers
curl -I http://localhost/api/health | grep X-Environment
# Returns: X-Environment: production-blue or production-green
```

## Deployment Process

### Blue-Green Deployment Steps

1. **Prepare green environment**

   ```bash
   ./scripts/switch-environment.sh green
   docker compose -f docker-compose.green.yml up -d
   ```

2. **Test green environment**

   ```bash
   curl http://localhost:5080/health
   # Run smoke tests
   ```

3. **Switch traffic to green**
   - Update main nginx proxy to route to green ports
   - Monitor for issues

4. **If issues occur, switch back to blue**
   ```bash
   ./scripts/switch-environment.sh blue
   # Update main nginx proxy back to blue
   ```

## Monitoring

### Check Active Environment

```bash
cat .active-environment
# Output:
# ACTIVE_COLOR=blue
# SWITCHED_AT=2025-09-10T12:53:57+00:00
# SWITCHED_BY=cvat
```

### Monitor Rate Limiting

Watch nginx logs for rate limit messages:

```bash
docker logs nginx-main -f | grep "limiting requests"
```

### Service Health

```bash
# Check all services
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check specific environment
./scripts/switch-environment.sh blue | grep "Service Status" -A5
```

## Troubleshooting

### Common Issues

1. **nginx-main container fails to start**
   - Check SSL certificates exist: `ls -la /etc/letsencrypt/live/spherosegapp.utia.cas.cz/`
   - Verify network exists: `docker network ls | grep spheroseg-blue`
   - Check configuration syntax: `docker run --rm -v /path/to/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t`

2. **503 errors still occurring**
   - Verify rate limits: `grep "limit_req zone=segmentation" docker/nginx/nginx.active.conf`
   - Check if configuration was reloaded: `docker exec nginx-main nginx -s reload`
   - Monitor actual request rates in logs

3. **Environment variables not substituted**
   - Ensure variables are exported in switch script
   - Check .env files have correct values
   - Verify template uses `${VAR}` syntax (not `${VAR:-default}`)

### Debug Commands

```bash
# Check which configuration is active
ls -la docker/nginx/nginx.active.conf

# Verify environment variables
source .env.blue && echo "HTTP=$NGINX_HTTP_PORT HTTPS=$NGINX_HTTPS_PORT"

# Test configuration generation
source .env.blue && envsubst < docker/nginx/nginx.template.conf | head -50

# Check nginx configuration inside container
docker exec nginx-main cat /etc/nginx/conf.d/default.conf | grep limit_req
```

## Security Considerations

1. **SSL/TLS Configuration**
   - Uses Let's Encrypt certificates
   - TLS 1.2 and 1.3 only
   - Strong cipher suites
   - HSTS enabled

2. **Rate Limiting**
   - Protects against DoS attacks
   - Different limits for different endpoint types
   - Connection limits per IP

3. **Environment Isolation**
   - Separate databases for blue/green
   - Separate Docker networks
   - Clear environment identification in headers

## Maintenance

### Regular Tasks

- **Certificate renewal**: Handled by Let's Encrypt/certbot
- **Log rotation**: Configure Docker logging driver
- **Database backups**: Separate for blue/green environments
- **Performance monitoring**: Check rate limit hits, response times

### Updating Configuration

1. Edit `docker/nginx/nginx.template.conf`
2. Run `./scripts/switch-environment.sh {color}` to regenerate
3. Reload nginx: `docker exec nginx-main nginx -s reload`

## Benefits

1. **Resolves 503 errors**: Proper rate limiting for bulk requests
2. **Zero-downtime deployments**: Switch between environments seamlessly
3. **Easy rollback**: Quick switch back if issues occur
4. **Clean configuration**: Template-based, version controlled
5. **Environment clarity**: Clear identification of active environment
6. **Maintainable**: Single source of truth for configuration
