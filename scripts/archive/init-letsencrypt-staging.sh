#!/bin/bash

# Initialize Let's Encrypt certificates for staging subdomain
# This script should be run to add staging.spherosegapp.utia.cas.cz to the certificate

set -e

# Get repository root directory (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Domains configuration
MAIN_DOMAIN="${LETSENCRYPT_DOMAIN:-spherosegapp.utia.cas.cz}"
STAGING_DOMAIN="staging.${MAIN_DOMAIN}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@utia.cas.cz}"  # Use env var or fallback
STAGING="${LETSENCRYPT_STAGING:-0}"  # Set to 1 for testing

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 SpheroSeg Let's Encrypt SSL - Staging Subdomain Setup${NC}"
echo -e "${BLUE}====================================================${NC}"

# Check if email is provided
if [ -z "$EMAIL" ]; then
    echo -e "${RED}❌ Error: Email address required for Let's Encrypt registration${NC}"
    echo -e "${YELLOW}Set LETSENCRYPT_EMAIL environment variable or edit this script${NC}"
    exit 1
fi

echo -e "${BLUE}📧 Email: ${EMAIL}${NC}"
echo -e "${BLUE}🌐 Main Domain: ${MAIN_DOMAIN}${NC}"
echo -e "${BLUE}🌐 Staging Domain: ${STAGING_DOMAIN}${NC}"

# Create required directories
echo -e "${BLUE}📁 Creating certificate directories...${NC}"
sudo mkdir -p /etc/letsencrypt/live/${MAIN_DOMAIN}
sudo mkdir -p /var/lib/letsencrypt
sudo mkdir -p ./docker/nginx/certbot
sudo mkdir -p ./scripts/certbot-logs

# Set staging or production server
if [ "$STAGING" = "1" ]; then
    echo -e "${YELLOW}⚠️  Using Let's Encrypt STAGING environment (test certificates)${NC}"
    STAGING_ARG="--staging"
else
    echo -e "${GREEN}✅ Using Let's Encrypt PRODUCTION environment${NC}"
    STAGING_ARG=""
fi

# Check if main domain certificates already exist
if [ -f "/etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem" ]; then
    echo -e "${YELLOW}⚠️  Certificates already exist for ${MAIN_DOMAIN}${NC}"
    echo -e "${BLUE}Checking if staging domain is included...${NC}"
    
    # Check if staging domain is in the certificate
    if sudo openssl x509 -in /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem -text -noout | grep -q "${STAGING_DOMAIN}"; then
        echo -e "${GREEN}✅ Staging domain already included in certificate${NC}"
        
        # Check certificate expiry
        EXPIRY=$(sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem | cut -d= -f2)
        EXPIRY_SECONDS=$(date -d "$EXPIRY" +%s)
        CURRENT_SECONDS=$(date +%s)
        DAYS_LEFT=$(( (EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))
        
        echo -e "${GREEN}✅ Certificate is valid for ${DAYS_LEFT} more days${NC}"
        
        if [ $DAYS_LEFT -gt 30 ]; then
            echo -e "${GREEN}✅ No action needed - certificate is valid${NC}"
            exit 0
        else
            echo -e "${YELLOW}⚠️  Certificate expires in ${DAYS_LEFT} days. Will renew with staging domain.${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Staging domain not found in existing certificate. Will expand certificate.${NC}"
    fi
else
    echo -e "${BLUE}🔄 No existing certificates found. Generating new multi-domain certificate...${NC}"
    
    # Start nginx with temporary self-signed certificate for initial setup
    echo -e "${BLUE}🔧 Creating temporary self-signed certificate...${NC}"
    sudo openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout /etc/letsencrypt/live/${MAIN_DOMAIN}/privkey.pem \
        -out /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem \
        -days 1 \
        -subj "/CN=${MAIN_DOMAIN}" \
        -addext "subjectAltName=DNS:${MAIN_DOMAIN},DNS:${STAGING_DOMAIN}"
    
    # Create chain.pem (copy of fullchain for compatibility)
    sudo cp /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem /etc/letsencrypt/live/${MAIN_DOMAIN}/chain.pem
fi

# Ensure main production services are running
echo -e "${BLUE}🚀 Ensuring production services are running...${NC}"
if ! docker compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo -e "${BLUE}Starting production services...${NC}"
    docker compose -f docker-compose.prod.yml up -d
fi

# Wait for nginx to be ready with active polling
echo -e "${BLUE}⏳ Waiting for nginx to be ready...${NC}"

NGINX_WAIT_TIMEOUT=60  # 1 minute
start_time=$(date +%s)

while true; do
    if curl -f -s http://localhost/health >/dev/null 2>&1; then
        break
    fi
    
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    
    if [ $elapsed -ge $NGINX_WAIT_TIMEOUT ]; then
        echo -e "${RED}❌ Nginx not ready after ${NGINX_WAIT_TIMEOUT} seconds. Check logs:${NC}"
        echo -e "${YELLOW}docker compose -f docker-compose.prod.yml logs nginx${NC}"
        exit 1
    fi
    
    echo "Nginx not ready, waiting... (${elapsed}/${NGINX_WAIT_TIMEOUT}s)"
    sleep 2
done

echo -e "${GREEN}✅ Nginx is running${NC}"

# Request certificate with both domains
echo -e "${BLUE}🔐 Requesting SSL certificate with staging subdomain from Let's Encrypt...${NC}"

# Use expand to add the staging domain to existing certificate, or create new multi-domain cert
CERT_ACTION="expand"
if [ ! -f "/etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem" ] || [ "${DAYS_LEFT:-0}" -le 30 ]; then
    CERT_ACTION="certonly"
fi

# Request the certificate
docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v "${REPO_ROOT}/docker/nginx/certbot":/var/www/certbot \
    certbot/certbot ${CERT_ACTION} \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email ${EMAIL} \
    --agree-tos \
    --no-eff-email \
    --keep-until-expiring \
    --non-interactive \
    ${STAGING_ARG} \
    -d ${MAIN_DOMAIN} \
    -d ${STAGING_DOMAIN}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ SSL certificate with staging domain generated successfully!${NC}"
    
    # Reload nginx with new certificate
    echo -e "${BLUE}🔄 Reloading nginx with updated SSL certificate...${NC}"
    docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
    
    echo -e "${GREEN}✅ SSL setup complete!${NC}"
else
    echo -e "${RED}❌ Failed to obtain SSL certificate${NC}"
    echo -e "${YELLOW}Check the logs above for details${NC}"
    exit 1
fi

# Show certificate details
echo -e "${BLUE}📋 Certificate details:${NC}"
sudo openssl x509 -in /etc/letsencrypt/live/${MAIN_DOMAIN}/fullchain.pem -text -noout | grep -A1 "Subject Alternative Name" || echo "No SAN found"

echo -e "${GREEN}🎉 Let's Encrypt SSL setup with staging domain completed successfully!${NC}"
echo -e "${BLUE}===================================================================${NC}"
echo -e "${GREEN}✅ SSL certificates are installed and configured${NC}"
echo -e "${GREEN}✅ Both production and staging domains are covered${NC}"
echo -e "${GREEN}✅ Production site: https://${MAIN_DOMAIN}${NC}"
echo -e "${GREEN}✅ Staging site: https://${STAGING_DOMAIN}${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  • Deploy staging environment: ${YELLOW}./scripts/deploy-staging.sh${NC}"
echo -e "  • Test production SSL: ${YELLOW}https://www.ssllabs.com/ssltest/analyze.html?d=${MAIN_DOMAIN}${NC}"
echo -e "  • Test staging SSL: ${YELLOW}https://www.ssllabs.com/ssltest/analyze.html?d=${STAGING_DOMAIN}${NC}"
echo -e "  • Check certificate expiry: ${YELLOW}./scripts/check-ssl-expiry.sh${NC}"
echo ""
echo -e "${YELLOW}⚠️  Make sure DNS A record for ${STAGING_DOMAIN} points to this server${NC}"