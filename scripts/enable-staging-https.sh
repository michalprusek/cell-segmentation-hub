#!/bin/bash
set -euo pipefail

# Enable HTTPS redirect for staging environment
# Run this script AFTER SSL certificate includes staging subdomain

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STAGING_CONFIG="${PROJECT_ROOT}/docker/nginx/sites/staging.spherosegapp.conf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔐 Enabling HTTPS for Staging Environment${NC}"
echo -e "${BLUE}=====================================${NC}"

# Check if SSL certificate includes staging domain
MAIN_DOMAIN="spherosegapp.utia.cas.cz"
STAGING_DOMAIN="staging.spherosegapp.utia.cas.cz"

echo -e "${BLUE}🔍 Checking SSL certificate for staging domain...${NC}"
if ! openssl x509 -in /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem -text -noout | grep -q "${STAGING_DOMAIN}"; then
    echo -e "${RED}❌ SSL certificate does not include ${STAGING_DOMAIN}${NC}"
    echo -e "${YELLOW}Please run: ./scripts/expand-ssl-staging.sh${NC}"
    exit 1
fi

echo -e "${GREEN}✅ SSL certificate includes staging domain${NC}"

# Create backup of current staging config
echo -e "${BLUE}💾 Creating backup of staging nginx config...${NC}"
cp "${STAGING_CONFIG}" "${STAGING_CONFIG}.backup-$(date +%Y%m%d_%H%M%S)"

# Update staging config to redirect HTTP to HTTPS
echo -e "${BLUE}🔧 Updating staging nginx config to use HTTPS redirect...${NC}"

cat > "${STAGING_CONFIG}" << 'EOF'
# Staging Subdomain Configuration
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name staging.spherosegapp.utia.cas.cz;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server for staging
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name staging.spherosegapp.utia.cas.cz;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/spherosegapp.utia.cas.cz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/spherosegapp.utia.cas.cz/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/spherosegapp.utia.cas.cz/chain.pem;
    
    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;

    # HSTS - shorter for staging
    add_header Strict-Transport-Security "max-age=86400; includeSubDomains" always;

    # CSP Header - Staging configuration (more permissive)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://staging.spherosegapp.utia.cas.cz wss://staging.spherosegapp.utia.cas.cz; frame-ancestors 'none'; upgrade-insecure-requests;" always;

    # Staging banner headers
    add_header X-Environment "staging" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "staging-environment-healthy-https\n";
        add_header Content-Type text/plain;
        add_header X-Environment "staging" always;
    }

    # Frontend static files (proxy to staging nginx)
    location / {
        proxy_pass http://staging_nginx;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Environment "staging";
        
        # Add staging headers
        add_header X-Environment "staging" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }

    # API routes (proxy to staging backend)
    location /api/ {
        proxy_pass http://staging_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Environment "staging";
        
        # Rate limiting
        limit_req zone=api_limit burst=20 nodelay;
        
        # Add staging headers
        add_header X-Environment "staging" always;
    }

    # ML API routes (proxy to staging ML service) 
    location /api/ml/ {
        proxy_pass http://staging_ml_service/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Environment "staging";
        
        # Longer timeout for ML operations
        proxy_read_timeout 300s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        
        # Add staging headers
        add_header X-Environment "staging" always;
    }

    # Grafana (proxy to staging grafana)
    location /grafana/ {
        proxy_pass http://staging_grafana/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Environment "staging";
        
        # Add staging headers
        add_header X-Environment "staging" always;
    }

    # Cache static assets (shorter for staging)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://staging_nginx;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Shorter cache for staging
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
        add_header X-Environment "staging" always;
    }

    # WebSocket support for real-time features
    location /ws {
        proxy_pass http://staging_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Environment "staging";
        
        # WebSocket timeout settings
        proxy_read_timeout 86400;
        
        add_header X-Environment "staging" always;
    }
}
EOF

# Test nginx configuration
echo -e "${BLUE}🧪 Testing nginx configuration...${NC}"
if docker compose -f docker-compose.prod.yml exec nginx nginx -t; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
    
    # Reload nginx
    echo -e "${BLUE}🔄 Reloading nginx with HTTPS staging configuration...${NC}"
    docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
    
    echo -e "${GREEN}✅ Staging HTTPS configuration enabled successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Configuration changes:${NC}"
    echo -e "  • HTTP requests to staging subdomain now redirect to HTTPS"
    echo -e "  • HTTPS server block handles all staging traffic"
    echo -e "  • SSL certificate shared with production domain"
    echo -e "  • Staging headers added to all responses"
    echo -e "  • WebSocket support enabled for real-time features"
    
else
    echo -e "${RED}❌ Nginx configuration test failed${NC}"
    echo -e "${YELLOW}Restoring backup...${NC}"
    cp "${STAGING_CONFIG}.backup-$(date +%Y%m%d_%H%M%S)" "${STAGING_CONFIG}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Staging HTTPS is now enabled!${NC}"
echo -e "${BLUE}=============================${NC}"
echo -e "${GREEN}  ✅ HTTP redirects: http://staging.spherosegapp.utia.cas.cz → HTTPS${NC}"
echo -e "${GREEN}  ✅ HTTPS endpoint: https://staging.spherosegapp.utia.cas.cz${NC}"
echo -e "${GREEN}  ✅ API endpoint: https://staging.spherosegapp.utia.cas.cz/api${NC}"
echo -e "${GREEN}  ✅ ML API: https://staging.spherosegapp.utia.cas.cz/api/ml${NC}"
echo -e "${GREEN}  ✅ Grafana: https://staging.spherosegapp.utia.cas.cz/grafana${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  • Test HTTPS access: ${YELLOW}curl -k https://staging.spherosegapp.utia.cas.cz/health${NC}"
echo -e "  • Verify SSL certificate: ${YELLOW}openssl s_client -connect staging.spherosegapp.utia.cas.cz:443${NC}"
echo -e "  • Test full functionality via web browser"