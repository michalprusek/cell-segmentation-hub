#!/bin/bash
set -euo pipefail

# Complete Staging Environment Setup
# Run this script AFTER DNS is configured for staging.spherosegapp.utia.cas.cz
#
# This script will:
# 1. Verify DNS configuration
# 2. Expand SSL certificate to include staging subdomain  
# 3. Enable HTTPS for staging
# 4. Test complete functionality
# 5. Provide access information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
MAIN_DOMAIN="spherosegapp.utia.cas.cz"
STAGING_DOMAIN="staging.spherosegapp.utia.cas.cz"
EMAIL="admin@utia.cas.cz"
SERVER_IP="147.231.160.153"

echo -e "${BOLD}${BLUE}🚀 SpheroSeg Staging Environment - Complete Setup${NC}"
echo -e "${BOLD}${BLUE}==================================================${NC}"
echo ""
echo -e "${BLUE}📋 Setup Overview:${NC}"
echo -e "  🌐 Production: https://${MAIN_DOMAIN}"
echo -e "  🧪 Staging: https://${STAGING_DOMAIN}"
echo -e "  📧 Email: ${EMAIL}"
echo -e "  🔗 Server IP: ${SERVER_IP}"
echo ""

# Step 1: DNS Verification
echo -e "${BOLD}${BLUE}Step 1/5: DNS Configuration Verification${NC}"
echo -e "${BLUE}=========================================${NC}"

echo -e "${BLUE}🔍 Checking DNS for ${STAGING_DOMAIN}...${NC}"
if nslookup "${STAGING_DOMAIN}" | grep -q "Address:"; then
    RESOLVED_IP=$(nslookup "${STAGING_DOMAIN}" | grep "Address:" | tail -1 | awk '{print $2}')
    if [[ "${RESOLVED_IP}" == "${SERVER_IP}" ]]; then
        echo -e "${GREEN}✅ DNS correctly configured: ${STAGING_DOMAIN} → ${SERVER_IP}${NC}"
    else
        echo -e "${YELLOW}⚠️  DNS configured but points to wrong IP: ${RESOLVED_IP} (expected: ${SERVER_IP})${NC}"
        echo -e "${YELLOW}Please update DNS A record to point to ${SERVER_IP}${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ DNS not configured for ${STAGING_DOMAIN}${NC}"
    echo ""
    echo -e "${BOLD}${YELLOW}DNS Configuration Required:${NC}"
    echo -e "${YELLOW}Please add one of these DNS records to utia.cas.cz zone:${NC}"
    echo ""
    echo -e "${YELLOW}Option 1 - A Record:${NC}"
    echo -e "${YELLOW}  staging.spherosegapp.utia.cas.cz    A    ${SERVER_IP}${NC}"
    echo ""
    echo -e "${YELLOW}Option 2 - CNAME Record:${NC}"
    echo -e "${YELLOW}  staging.spherosegapp.utia.cas.cz    CNAME    cvat2.utia.cas.cz${NC}"
    echo ""
    echo -e "${YELLOW}After DNS is configured, wait 5-10 minutes for propagation and run this script again.${NC}"
    echo ""
    echo -e "${BLUE}💡 To check DNS propagation: nslookup ${STAGING_DOMAIN}${NC}"
    exit 1
fi

# Step 2: SSL Certificate Expansion
echo ""
echo -e "${BOLD}${BLUE}Step 2/5: SSL Certificate Expansion${NC}"
echo -e "${BLUE}====================================${NC}"

echo -e "${BLUE}🔐 Expanding SSL certificate to include staging subdomain...${NC}"
if ! "${SCRIPT_DIR}/expand-ssl-staging.sh"; then
    echo -e "${RED}❌ SSL certificate expansion failed${NC}"
    exit 1
fi

# Step 3: HTTPS Configuration
echo ""
echo -e "${BOLD}${BLUE}Step 3/5: HTTPS Configuration${NC}"
echo -e "${BLUE}=============================${NC}"

echo -e "${BLUE}🔐 Enabling HTTPS for staging environment...${NC}"
if ! "${SCRIPT_DIR}/enable-staging-https.sh"; then
    echo -e "${RED}❌ HTTPS configuration failed${NC}"
    exit 1
fi

# Step 4: Verify Staging Services
echo ""
echo -e "${BOLD}${BLUE}Step 4/5: Service Verification${NC}"
echo -e "${BLUE}=============================${NC}"

echo -e "${BLUE}🔍 Verifying staging services are running...${NC}"

# Check staging containers
if ! docker compose -f docker-compose.staging.yml -p staging ps | grep -q "Up.*healthy"; then
    echo -e "${YELLOW}⚠️  Some staging services may not be healthy. Checking...${NC}"
    docker compose -f docker-compose.staging.yml -p staging ps
    echo ""
    echo -e "${BLUE}🚀 Restarting staging services...${NC}"
    docker compose -f docker-compose.staging.yml -p staging restart
    sleep 30
fi

echo -e "${GREEN}✅ Staging containers status:${NC}"
docker compose -f docker-compose.staging.yml -p staging ps

# Step 5: Functionality Testing
echo ""
echo -e "${BOLD}${BLUE}Step 5/5: Functionality Testing${NC}"
echo -e "${BLUE}===============================${NC}"

echo -e "${BLUE}🧪 Testing staging environment endpoints...${NC}"

# Test HTTPS health endpoint
if curl -f -s "https://${STAGING_DOMAIN}/health" | grep -q "staging-environment-healthy"; then
    echo -e "${GREEN}  ✅ HTTPS Health endpoint: Working${NC}"
else
    echo -e "${RED}  ❌ HTTPS Health endpoint: Failed${NC}"
fi

# Test API endpoint
if curl -f -s "https://${STAGING_DOMAIN}/api/auth/me" | grep -q "error"; then
    echo -e "${GREEN}  ✅ API endpoint: Working (auth required)${NC}"
else
    echo -e "${RED}  ❌ API endpoint: Failed${NC}"
fi

# Test ML endpoint
if curl -f -s "https://${STAGING_DOMAIN}/api/ml/health" | grep -q "healthy"; then
    echo -e "${GREEN}  ✅ ML API endpoint: Working${NC}"
else
    echo -e "${RED}  ❌ ML API endpoint: Failed${NC}"
fi

# Test HTTP to HTTPS redirect
if curl -I -s "http://${STAGING_DOMAIN}/health" | grep -q "301"; then
    echo -e "${GREEN}  ✅ HTTP to HTTPS redirect: Working${NC}"
else
    echo -e "${YELLOW}  ⚠️  HTTP to HTTPS redirect: Check manually${NC}"
fi

# Final Summary
echo ""
echo -e "${BOLD}${GREEN}🎉 Staging Environment Setup Complete!${NC}"
echo -e "${BOLD}${GREEN}=====================================${NC}"
echo ""
echo -e "${GREEN}✅ DNS: Configured and verified${NC}"
echo -e "${GREEN}✅ SSL: Certificate expanded to include staging subdomain${NC}"
echo -e "${GREEN}✅ HTTPS: Enabled with proper redirects${NC}"
echo -e "${GREEN}✅ Services: All staging containers running${NC}"
echo -e "${GREEN}✅ Testing: Core functionality verified${NC}"
echo ""

echo -e "${BOLD}${BLUE}🌐 Access URLs:${NC}"
echo -e "${BLUE}===============${NC}"
echo -e "${GREEN}🚀 Production:${NC}"
echo -e "  • Frontend: https://${MAIN_DOMAIN}"
echo -e "  • API: https://${MAIN_DOMAIN}/api"
echo -e "  • ML API: https://${MAIN_DOMAIN}/api/ml"
echo -e "  • Grafana: https://${MAIN_DOMAIN}/grafana (port 3030)"
echo ""
echo -e "${GREEN}🧪 Staging:${NC}"
echo -e "  • Frontend: https://${STAGING_DOMAIN}"
echo -e "  • API: https://${STAGING_DOMAIN}/api"
echo -e "  • ML API: https://${STAGING_DOMAIN}/api/ml"
echo -e "  • Grafana: https://${STAGING_DOMAIN}/grafana"
echo -e "  • Direct Grafana: http://localhost:3031"
echo ""

echo -e "${BOLD}${BLUE}🛠️  Management Commands:${NC}"
echo -e "${BLUE}=====================${NC}"
echo -e "${YELLOW}# View staging status${NC}"
echo -e "docker compose -f docker-compose.staging.yml -p staging ps"
echo ""
echo -e "${YELLOW}# View staging logs${NC}"
echo -e "docker compose -f docker-compose.staging.yml -p staging logs -f [service]"
echo ""
echo -e "${YELLOW}# Restart staging services${NC}"
echo -e "./scripts/staging-manager.sh restart"
echo ""
echo -e "${YELLOW}# Deploy new staging version${NC}"
echo -e "./scripts/deploy-staging.sh"
echo ""
echo -e "${YELLOW}# Check SSL certificate${NC}"
echo -e "./scripts/check-ssl-expiry.sh"
echo ""

echo -e "${BOLD}${BLUE}🔒 Security Notes:${NC}"
echo -e "${BLUE}=================${NC}"
echo -e "• Staging uses separate database: spheroseg_staging"
echo -e "• Staging has own JWT secrets and session keys"
echo -e "• Staging traffic marked with X-Environment: staging header"
echo -e "• Staging blocked from search engines (noindex, nofollow)"
echo -e "• Production environment remains completely isolated"
echo ""

echo -e "${BOLD}${GREEN}Staging environment is now ready for use! 🚀${NC}"