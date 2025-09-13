#!/bin/bash

# Blue-Green Environment Switching Script
# Usage: ./switch-environment.sh [blue|green]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default to blue if no argument provided
DEPLOYMENT_COLOR=${1:-blue}

# Validate input
if [[ ! "$DEPLOYMENT_COLOR" =~ ^(blue|green)$ ]]; then
    echo -e "${RED}Error: DEPLOYMENT_COLOR must be 'blue' or 'green'${NC}"
    echo "Usage: $0 [blue|green]"
    exit 1
fi

# Set the base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo -e "${BLUE}=== Blue-Green Environment Switcher ===${NC}"
echo -e "Switching to ${YELLOW}${DEPLOYMENT_COLOR}${NC} environment"

# Check if environment files exist
if [ ! -f ".env.${DEPLOYMENT_COLOR}" ]; then
    echo -e "${RED}Error: .env.${DEPLOYMENT_COLOR} file not found${NC}"
    exit 1
fi

if [ ! -f ".env.common" ]; then
    echo -e "${RED}Error: .env.common file not found${NC}"
    exit 1
fi

# Load environment variables
echo -e "\n${GREEN}Loading environment variables...${NC}"
set -a  # automatically export all variables
source .env.common
source .env.${DEPLOYMENT_COLOR}
set +a

# Generate nginx configuration from template
echo -e "\n${GREEN}Generating nginx configuration...${NC}"
if [ ! -f "docker/nginx/nginx.template.conf" ]; then
    echo -e "${RED}Error: nginx.template.conf not found${NC}"
    exit 1
fi

# Create the nginx configuration using envsubst
# Export all variables for envsubst
export BACKEND_SERVICE ML_SERVICE FRONTEND_SERVICE NGINX_HTTP_PORT NGINX_HTTPS_PORT
export SSL_DOMAIN SSL_CERT_PATH ENVIRONMENT_NAME HEALTH_CHECK_MESSAGE UPLOAD_DIR

# Use envsubst with all template variables and convert NGINX_VAR_ back to $ for nginx variables
envsubst < docker/nginx/nginx.template.conf | sed 's/NGINX_VAR_/$/g' > docker/nginx/nginx.${DEPLOYMENT_COLOR}.conf

echo -e "Generated: docker/nginx/nginx.${DEPLOYMENT_COLOR}.conf"

# Create symlink for active configuration
echo -e "\n${GREEN}Creating active configuration symlink...${NC}"
cd docker/nginx
ln -sf nginx.${DEPLOYMENT_COLOR}.conf nginx.active.conf
cd "$BASE_DIR"
echo -e "Active configuration: docker/nginx/nginx.active.conf -> nginx.${DEPLOYMENT_COLOR}.conf"

# Generate docker-compose override file
echo -e "\n${GREEN}Generating docker-compose configuration...${NC}"
cat > docker-compose.active.yml <<EOF
# Auto-generated Docker Compose configuration
# Active environment: ${DEPLOYMENT_COLOR}
# Generated: $(date)

version: '3.8'

# This file sets the active environment variables
# Use with: docker compose -f docker-compose.${DEPLOYMENT_COLOR}.yml -f docker-compose.active.yml up

x-active-environment: &active-env
  DEPLOYMENT_COLOR: ${DEPLOYMENT_COLOR}
  ENVIRONMENT_NAME: ${ENVIRONMENT_NAME}
  SERVICE_PREFIX: ${SERVICE_PREFIX}
EOF

echo -e "Generated: docker-compose.active.yml"

# Create environment status file
echo -e "\n${GREEN}Creating environment status file...${NC}"
cat > .active-environment <<EOF
ACTIVE_COLOR=${DEPLOYMENT_COLOR}
SWITCHED_AT=$(date -Iseconds)
SWITCHED_BY=${USER}
EOF

echo -e "Status saved to: .active-environment"

# Display current configuration
echo -e "\n${BLUE}=== Current Configuration ===${NC}"
echo -e "Active Environment: ${YELLOW}${DEPLOYMENT_COLOR}${NC}"
echo -e "Environment Name: ${ENVIRONMENT_NAME}"
echo -e "Service Prefix: ${SERVICE_PREFIX}"
echo -e "Network Name: ${NETWORK_NAME}"
echo -e ""
echo -e "Ports:"
echo -e "  Frontend: ${FRONTEND_PORT}"
echo -e "  Backend: ${BACKEND_PORT}"
echo -e "  ML Service: ${ML_PORT}"
echo -e "  Nginx HTTP: ${NGINX_HTTP_PORT}"
echo -e "  Nginx HTTPS: ${NGINX_HTTPS_PORT}"
echo -e ""
echo -e "Services:"
echo -e "  Frontend: ${FRONTEND_SERVICE}"
echo -e "  Backend: ${BACKEND_SERVICE}"
echo -e "  ML: ${ML_SERVICE}"
echo -e "  Database: ${POSTGRES_SERVICE}"
echo -e "  Redis: ${REDIS_SERVICE}"

# Check if services are running
echo -e "\n${BLUE}=== Service Status ===${NC}"
if docker ps --format "table {{.Names}}" | grep -q "${DEPLOYMENT_COLOR}-"; then
    echo -e "${GREEN}✓ ${DEPLOYMENT_COLOR} services are running${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep "${DEPLOYMENT_COLOR}-" || true
else
    echo -e "${YELLOW}⚠ No ${DEPLOYMENT_COLOR} services are currently running${NC}"
fi

# Provide next steps
echo -e "\n${BLUE}=== Next Steps ===${NC}"
echo -e "1. To start the ${DEPLOYMENT_COLOR} environment:"
echo -e "   ${YELLOW}docker compose -f docker-compose.${DEPLOYMENT_COLOR}.yml up -d${NC}"
echo -e ""
echo -e "2. To reload nginx with new configuration:"
echo -e "   ${YELLOW}docker exec nginx-${DEPLOYMENT_COLOR} nginx -s reload${NC}"
echo -e ""
echo -e "3. To verify the deployment:"
echo -e "   ${YELLOW}curl -s https://${SSL_DOMAIN}/health${NC}"
echo -e ""
echo -e "${GREEN}✓ Environment switch completed successfully!${NC}"