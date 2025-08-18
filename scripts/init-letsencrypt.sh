#!/bin/bash

# Initialize Let's Encrypt certificates for SpheroSeg production deployment
# This script should be run ONCE after initial production setup

set -e

# Get repository root directory (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DOMAIN="${LETSENCRYPT_DOMAIN:-spherosegapp.utia.cas.cz}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@utia.cas.cz}"  # Use env var or fallback
STAGING="${LETSENCRYPT_STAGING:-0}"  # Set to 1 for testing

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 SpheroSeg Let's Encrypt SSL Initialization${NC}"
echo -e "${BLUE}============================================${NC}"

# Check if email is provided
if [ -z "$EMAIL" ]; then
    echo -e "${RED}❌ Error: Email address required for Let's Encrypt registration${NC}"
    echo -e "${YELLOW}Set LETSENCRYPT_EMAIL environment variable or edit this script${NC}"
    exit 1
fi

echo -e "${BLUE}📧 Email: ${EMAIL}${NC}"
echo -e "${BLUE}🌐 Domain: ${DOMAIN}${NC}"

# Create required directories
echo -e "${BLUE}📁 Creating certificate directories...${NC}"
sudo mkdir -p /etc/letsencrypt/live/${DOMAIN}
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

# Check if certificates already exist
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo -e "${YELLOW}⚠️  Certificates already exist for ${DOMAIN}${NC}"
    echo -e "${YELLOW}Checking certificate validity...${NC}"
    
    # Check certificate expiry
    EXPIRY=$(sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem | cut -d= -f2)
    EXPIRY_SECONDS=$(date -d "$EXPIRY" +%s)
    CURRENT_SECONDS=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))
    
    if [ $DAYS_LEFT -gt 30 ]; then
        echo -e "${GREEN}✅ Certificate is valid for ${DAYS_LEFT} more days${NC}"
        echo -e "${BLUE}Starting services with existing certificates...${NC}"
    else
        echo -e "${YELLOW}⚠️  Certificate expires in ${DAYS_LEFT} days. Consider renewal.${NC}"
    fi
else
    echo -e "${BLUE}🔄 No existing certificates found. Generating new ones...${NC}"
    
    # Start nginx with temporary self-signed certificate for initial setup
    echo -e "${BLUE}🔧 Creating temporary self-signed certificate...${NC}"
    sudo openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
        -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
        -days 1 \
        -subj "/CN=${DOMAIN}"
    
    # Create chain.pem (copy of fullchain for compatibility)
    sudo cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /etc/letsencrypt/live/${DOMAIN}/chain.pem
fi

# Start the main services
echo -e "${BLUE}🚀 Starting production services...${NC}"
docker compose -f docker-compose.prod.yml up -d

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

# Only generate real certificates if we don't have valid ones
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] || [ "${DAYS_LEFT:-0}" -le 30 ]; then
    echo -e "${BLUE}🔐 Requesting SSL certificate from Let's Encrypt...${NC}"
    
    # Request the certificate
    docker run --rm \
        -v /etc/letsencrypt:/etc/letsencrypt \
        -v /var/lib/letsencrypt:/var/lib/letsencrypt \
        -v "${REPO_ROOT}/docker/nginx/certbot":/var/www/certbot \
        certbot/certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email ${EMAIL} \
        --agree-tos \
        --no-eff-email \
        --keep-until-expiring \
        --non-interactive \
        ${STAGING_ARG} \
        -d ${DOMAIN}
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ SSL certificate generated successfully!${NC}"
        
        # Reload nginx with new certificate
        echo -e "${BLUE}🔄 Reloading nginx with SSL certificate...${NC}"
        docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
        
        echo -e "${GREEN}✅ SSL setup complete!${NC}"
    else
        echo -e "${RED}❌ Failed to obtain SSL certificate${NC}"
        echo -e "${YELLOW}Check the logs above for details${NC}"
        exit 1
    fi
fi

# Start the certbot renewal service
echo -e "${BLUE}🔄 Starting automatic certificate renewal service...${NC}"
docker compose -f docker-compose.certbot.yml up -d

echo -e "${GREEN}🎉 Let's Encrypt SSL setup completed successfully!${NC}"
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}✅ SSL certificates are installed and configured${NC}"
echo -e "${GREEN}✅ Automatic renewal is active (checks every 12 hours)${NC}"
echo -e "${GREEN}✅ Your site should now be accessible at: https://${DOMAIN}${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  • Test your SSL setup: ${YELLOW}https://www.ssllabs.com/ssltest/analyze.html?d=${DOMAIN}${NC}"
echo -e "  • Monitor renewal logs: ${YELLOW}docker compose -f docker-compose.certbot.yml logs -f certbot${NC}"
echo -e "  • Check certificate expiry: ${YELLOW}./scripts/check-ssl-expiry.sh${NC}"
echo ""
echo -e "${YELLOW}⚠️  Keep this script for future reference and SSL troubleshooting${NC}"