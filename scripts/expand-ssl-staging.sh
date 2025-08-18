#!/bin/bash
set -euo pipefail

# Expand SSL certificate to include staging subdomain
# Run this script AFTER DNS is configured for staging.spherosegapp.utia.cas.cz

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MAIN_DOMAIN="spherosegapp.utia.cas.cz"
STAGING_DOMAIN="staging.spherosegapp.utia.cas.cz"
EMAIL="admin@utia.cas.cz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔐 Expanding SSL Certificate for Staging Environment${NC}"
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}📧 Email: ${EMAIL}${NC}"
echo -e "${BLUE}🌐 Main Domain: ${MAIN_DOMAIN}${NC}"
echo -e "${BLUE}🌐 Staging Domain: ${STAGING_DOMAIN}${NC}"
echo ""

# Check if DNS is configured
echo -e "${BLUE}🔍 Checking DNS configuration for staging domain...${NC}"
if ! nslookup "${STAGING_DOMAIN}" | grep -q "Address:"; then
    echo -e "${RED}❌ DNS not configured for ${STAGING_DOMAIN}${NC}"
    echo -e "${YELLOW}Please configure DNS A record:${NC}"
    echo -e "${YELLOW}  ${STAGING_DOMAIN}  A  147.231.160.153${NC}"
    echo -e "${YELLOW}Or CNAME record:${NC}"
    echo -e "${YELLOW}  ${STAGING_DOMAIN}  CNAME  cvat2.utia.cas.cz${NC}"
    echo ""
    echo -e "${YELLOW}After DNS is configured, wait 5-10 minutes for propagation and run this script again.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ DNS is configured for ${STAGING_DOMAIN}${NC}"

# Check if production nginx is running
if ! docker compose -f docker-compose.prod.yml ps nginx | grep -q "Up"; then
    echo -e "${BLUE}🚀 Starting production services...${NC}"
    docker compose -f docker-compose.prod.yml up -d
    
    # Wait for nginx to be ready
    echo -e "${BLUE}⏳ Waiting for nginx to be ready...${NC}"
    timeout=60
    start_time=$(date +%s)
    
    while true; do
        if curl -f -s http://localhost/health >/dev/null 2>&1; then
            break
        fi
        
        current_time=$(date +%s)
        elapsed=$((current_time - start_time))
        
        if [ $elapsed -ge $timeout ]; then
            echo -e "${RED}❌ Nginx not ready after ${timeout} seconds${NC}"
            exit 1
        fi
        
        echo "Waiting for nginx... (${elapsed}/${timeout}s)"
        sleep 2
    done
    
    echo -e "${GREEN}✅ Nginx is ready${NC}"
fi

# Create certbot webroot directory
mkdir -p "${PROJECT_ROOT}/docker/nginx/certbot"

# Expand SSL certificate to include staging domain
echo -e "${BLUE}🔐 Expanding SSL certificate to include staging subdomain...${NC}"
docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v "${PROJECT_ROOT}/docker/nginx/certbot":/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "${EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --expand \
    --non-interactive \
    -d "${MAIN_DOMAIN}" \
    -d "${STAGING_DOMAIN}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ SSL certificate expanded successfully!${NC}"
    
    # Reload nginx to use new certificate
    echo -e "${BLUE}🔄 Reloading nginx with expanded SSL certificate...${NC}"
    docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
    
    # Show certificate details
    echo -e "${BLUE}📋 Certificate details:${NC}"
    openssl x509 -in /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem -text -noout | grep -A1 "Subject Alternative Name" || echo "No SAN found"
    
    echo -e "${GREEN}✅ SSL certificate expansion completed successfully!${NC}"
    echo ""
    echo -e "${GREEN}🎉 Both domains are now covered by SSL certificate:${NC}"
    echo -e "${GREEN}  ✅ Production: https://${MAIN_DOMAIN}${NC}"
    echo -e "${GREEN}  ✅ Staging: https://${STAGING_DOMAIN}${NC}"
    
else
    echo -e "${RED}❌ Failed to expand SSL certificate${NC}"
    echo -e "${YELLOW}Check the logs above for details${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  • Update staging nginx config: ${YELLOW}./scripts/enable-staging-https.sh${NC}"
echo -e "  • Test SSL: ${YELLOW}https://${STAGING_DOMAIN}${NC}"
echo -e "  • Monitor certificate expiry: ${YELLOW}./scripts/check-ssl-expiry.sh${NC}"