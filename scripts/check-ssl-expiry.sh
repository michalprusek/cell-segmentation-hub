#!/bin/bash

# SSL Certificate Expiry Checker for SpheroSeg
# Checks the current SSL certificate status and expiry

set -e

DOMAIN="spherosegapp.utia.cas.cz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔐 SSL Certificate Status for ${DOMAIN}${NC}"
echo -e "${BLUE}============================================${NC}"

# Check if certificate file exists
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo -e "${RED}❌ No SSL certificate found for ${DOMAIN}${NC}"
    echo -e "${YELLOW}Run ./scripts/init-letsencrypt.sh to set up SSL${NC}"
    exit 1
fi

# Get certificate information
CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
CERT_INFO=$(sudo openssl x509 -in "$CERT_FILE" -text -noout)

# Extract key information
SUBJECT=$(echo "$CERT_INFO" | grep "Subject:" | sed 's/.*Subject: //')
ISSUER=$(echo "$CERT_INFO" | grep "Issuer:" | sed 's/.*Issuer: //')
SERIAL=$(echo "$CERT_INFO" | grep "Serial Number:" | sed 's/.*Serial Number: //')

# Get validity dates
NOT_BEFORE=$(sudo openssl x509 -startdate -noout -in "$CERT_FILE" | cut -d= -f2)
NOT_AFTER=$(sudo openssl x509 -enddate -noout -in "$CERT_FILE" | cut -d= -f2)

# Calculate days until expiry
EXPIRY_SECONDS=$(date -d "$NOT_AFTER" +%s)
CURRENT_SECONDS=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))

# Display certificate information
echo -e "${BLUE}📋 Certificate Details:${NC}"
echo -e "  Subject: ${YELLOW}${SUBJECT}${NC}"
echo -e "  Issuer: ${YELLOW}${ISSUER}${NC}"
echo -e "  Serial: ${YELLOW}${SERIAL}${NC}"
echo ""

echo -e "${BLUE}📅 Validity Period:${NC}"
echo -e "  Valid From: ${GREEN}${NOT_BEFORE}${NC}"
echo -e "  Valid Until: ${GREEN}${NOT_AFTER}${NC}"
echo ""

# Status based on days left
if [ $DAYS_LEFT -gt 30 ]; then
    STATUS_COLOR=$GREEN
    STATUS_ICON="✅"
    STATUS_MESSAGE="VALID"
elif [ $DAYS_LEFT -gt 7 ]; then
    STATUS_COLOR=$YELLOW
    STATUS_ICON="⚠️"
    STATUS_MESSAGE="EXPIRING SOON"
elif [ $DAYS_LEFT -gt 0 ]; then
    STATUS_COLOR=$RED
    STATUS_ICON="🚨"
    STATUS_MESSAGE="CRITICAL - EXPIRES SOON"
else
    STATUS_COLOR=$RED
    STATUS_ICON="❌"
    STATUS_MESSAGE="EXPIRED"
fi

echo -e "${BLUE}🔍 Certificate Status:${NC}"
echo -e "  Status: ${STATUS_COLOR}${STATUS_ICON} ${STATUS_MESSAGE}${NC}"
echo -e "  Days Remaining: ${STATUS_COLOR}${DAYS_LEFT} days${NC}"
echo ""

# Check if certificate is actually being used by nginx
echo -e "${BLUE}🌐 Online Certificate Check:${NC}"
if command -v openssl >/dev/null 2>&1; then
    ONLINE_CERT=$(echo | timeout 5 openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -fingerprint -noout -sha1 2>/dev/null)
    LOCAL_CERT=$(sudo openssl x509 -fingerprint -noout -sha1 -in "$CERT_FILE" 2>/dev/null)
    
    if [ "$ONLINE_CERT" = "$LOCAL_CERT" ]; then
        echo -e "  Online Certificate: ${GREEN}✅ Matches local certificate${NC}"
    else
        echo -e "  Online Certificate: ${YELLOW}⚠️ Differs from local certificate${NC}"
        echo -e "  ${YELLOW}This might indicate nginx hasn't been reloaded with the new certificate${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠️ OpenSSL not available for online check${NC}"
fi

# Recommendations based on status
echo ""
echo -e "${BLUE}💡 Recommendations:${NC}"

if [ $DAYS_LEFT -le 0 ]; then
    echo -e "  ${RED}🚨 URGENT: Certificate has expired!${NC}"
    echo -e "     Run: ${YELLOW}sudo ./scripts/certbot-renew.sh${NC}"
elif [ $DAYS_LEFT -le 7 ]; then
    echo -e "  ${RED}🚨 CRITICAL: Certificate expires in ${DAYS_LEFT} days!${NC}"
    echo -e "     Run: ${YELLOW}sudo ./scripts/certbot-renew.sh${NC}"
elif [ $DAYS_LEFT -le 30 ]; then
    echo -e "  ${YELLOW}⚠️ Consider renewing soon (expires in ${DAYS_LEFT} days)${NC}"
    echo -e "     Run: ${YELLOW}sudo ./scripts/certbot-renew.sh${NC}"
else
    echo -e "  ${GREEN}✅ Certificate is healthy${NC}"
    echo -e "     Next check recommended after: $(date -d "+$((DAYS_LEFT - 30)) days" +"%Y-%m-%d")"
fi

# Show renewal service status
echo ""
echo -e "${BLUE}🔄 Automatic Renewal Status:${NC}"
if docker compose -f docker-compose.certbot.yml ps certbot 2>/dev/null | grep -q "Up"; then
    echo -e "  Certbot Service: ${GREEN}✅ Running${NC}"
else
    echo -e "  Certbot Service: ${YELLOW}⚠️ Not running${NC}"
    echo -e "     Start with: ${YELLOW}docker compose -f docker-compose.certbot.yml up -d${NC}"
fi

# Check for recent renewal logs
echo ""
echo -e "${BLUE}📊 Recent Renewal Activity:${NC}"
if [ -d "./scripts/certbot-logs" ]; then
    RECENT_LOGS=$(find ./scripts/certbot-logs -name "renewal-*.log" -type f -mtime -7 | wc -l)
    if [ $RECENT_LOGS -gt 0 ]; then
        echo -e "  Recent renewals: ${GREEN}${RECENT_LOGS} in last 7 days${NC}"
        LATEST_LOG=$(find ./scripts/certbot-logs -name "renewal-*.log" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2)
        if [ -n "$LATEST_LOG" ]; then
            echo -e "  Latest log: ${YELLOW}$(basename $LATEST_LOG)${NC}"
        fi
    else
        echo -e "  Recent renewals: ${YELLOW}None in last 7 days${NC}"
    fi
else
    echo -e "  Log directory: ${YELLOW}Not found${NC}"
fi

echo ""
echo -e "${BLUE}============================================${NC}"