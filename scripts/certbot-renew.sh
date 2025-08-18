#!/bin/bash

# Automated SSL certificate renewal script for SpheroSeg
# This script checks and renews Let's Encrypt certificates if needed

set -e

DOMAIN="spherosegapp.utia.cas.cz"
LOG_FILE="./scripts/certbot-logs/renewal-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Ensure log directory exists
mkdir -p ./scripts/certbot-logs

# Function to log with timestamp
log() {
    echo -e "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "${BLUE}🔄 Starting SSL certificate renewal check for ${DOMAIN}${NC}"

# Check if certificate exists
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "${RED}❌ No certificate found for ${DOMAIN}${NC}"
    log "${YELLOW}Run ./scripts/init-letsencrypt.sh first${NC}"
    exit 1
fi

# Check certificate expiry
EXPIRY=$(sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem | cut -d= -f2)
EXPIRY_SECONDS=$(date -d "$EXPIRY" +%s)
CURRENT_SECONDS=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))

log "${BLUE}📅 Certificate expires in ${DAYS_LEFT} days${NC}"

# Renewal threshold (30 days)
RENEWAL_THRESHOLD=30

if [ $DAYS_LEFT -gt $RENEWAL_THRESHOLD ]; then
    log "${GREEN}✅ Certificate is still valid for ${DAYS_LEFT} days. No renewal needed.${NC}"
    exit 0
fi

log "${YELLOW}⚠️  Certificate expires in ${DAYS_LEFT} days. Starting renewal process...${NC}"

# Check if nginx is running
if ! docker compose -f docker-compose.prod.yml ps nginx | grep -q "Up"; then
    log "${RED}❌ Nginx is not running. Cannot perform renewal.${NC}"
    exit 1
fi

# Backup current certificate
BACKUP_DIR="./scripts/ssl-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
sudo cp -r /etc/letsencrypt/live/${DOMAIN} "$BACKUP_DIR/" || log "${YELLOW}⚠️  Could not backup current certificate${NC}"
log "${BLUE}💾 Current certificate backed up to ${BACKUP_DIR}${NC}"

# Attempt renewal
log "${BLUE}🔐 Attempting certificate renewal...${NC}"

# Try dry run first
if docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v $(pwd)/docker/nginx/certbot:/var/www/certbot \
    certbot/certbot renew --dry-run --webroot \
    --webroot-path=/var/www/certbot >> "$LOG_FILE" 2>&1; then
    
    log "${GREEN}✅ Dry run successful. Proceeding with actual renewal...${NC}"
    
    # Actual renewal
    if docker run --rm \
        -v /etc/letsencrypt:/etc/letsencrypt \
        -v /var/lib/letsencrypt:/var/lib/letsencrypt \
        -v $(pwd)/docker/nginx/certbot:/var/www/certbot \
        certbot/certbot renew --webroot \
        --webroot-path=/var/www/certbot >> "$LOG_FILE" 2>&1; then
        
        log "${GREEN}✅ Certificate renewed successfully!${NC}"
        
        # Reload nginx to use new certificate
        log "${BLUE}🔄 Reloading nginx with new certificate...${NC}"
        if docker compose -f docker-compose.prod.yml exec nginx nginx -s reload; then
            log "${GREEN}✅ Nginx reloaded successfully${NC}"
            
            # Verify new certificate
            NEW_EXPIRY=$(sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem | cut -d= -f2)
            NEW_EXPIRY_SECONDS=$(date -d "$NEW_EXPIRY" +%s)
            NEW_DAYS_LEFT=$(( (NEW_EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))
            
            log "${GREEN}🎉 Certificate renewal completed! New certificate valid for ${NEW_DAYS_LEFT} days${NC}"
            
            # Send notification (if notification system is available)
            if command -v curl >/dev/null 2>&1 && [ -n "$NOTIFICATION_WEBHOOK" ]; then
                curl -X POST "$NOTIFICATION_WEBHOOK" \
                     -H "Content-Type: application/json" \
                     -d "{\"text\":\"✅ SSL certificate for ${DOMAIN} renewed successfully. Valid for ${NEW_DAYS_LEFT} days.\"}" \
                     >/dev/null 2>&1 || true
            fi
            
        else
            log "${RED}❌ Failed to reload nginx${NC}"
            exit 1
        fi
    else
        log "${RED}❌ Certificate renewal failed${NC}"
        log "${YELLOW}Check the log file: ${LOG_FILE}${NC}"
        exit 1
    fi
else
    log "${RED}❌ Dry run failed. Not proceeding with renewal.${NC}"
    log "${YELLOW}Check the log file: ${LOG_FILE}${NC}"
    exit 1
fi

# Cleanup old logs (keep last 30 days)
find ./scripts/certbot-logs/ -name "renewal-*.log" -type f -mtime +30 -delete 2>/dev/null || true
find ./scripts/ssl-backups/ -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

log "${GREEN}🧹 Cleaned up old logs and backups${NC}"
log "${GREEN}✅ SSL certificate renewal process completed successfully!${NC}"