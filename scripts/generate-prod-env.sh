#!/bin/bash

# Production Environment Variables Generation Script
# Generates secure random values for production secrets

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔐 Production Environment Setup Script${NC}"
echo "======================================"

# Function to generate secure random string
generate_secret() {
    openssl rand -hex $1
}

# Function to generate strong password
generate_password() {
    # Generate 32 random bytes and convert to hex for full entropy (64 hex chars)
    # Then take first 25 characters for compatibility
    openssl rand -hex 32 | cut -c1-25
}

ENV_FILE=".env.production"
ENV_TEMPLATE=".env.production.template"

# Check if template exists
if [ ! -f "$ENV_TEMPLATE" ]; then
    echo -e "${RED}Error: $ENV_TEMPLATE not found${NC}"
    exit 1
fi

# Copy template to production file
cp $ENV_TEMPLATE $ENV_FILE

echo -e "${YELLOW}Generating secure production values...${NC}\n"

# Generate JWT secrets (64 hex characters = 256 bits)
JWT_ACCESS_SECRET=$(generate_secret 32)
JWT_REFRESH_SECRET=$(generate_secret 32)

echo -e "${BLUE}JWT Secrets:${NC}"
echo "  JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET:0:20}... (truncated)"
echo "  JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:0:20}... (truncated)"

# Generate database passwords
POSTGRES_PASSWORD=$(generate_password)
REDIS_PASSWORD=$(generate_password)
GF_SECURITY_ADMIN_PASSWORD=$(generate_password)

echo -e "\n${BLUE}Database Passwords:${NC}"
echo "  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:0:10}... (truncated)"
echo "  REDIS_PASSWORD: ${REDIS_PASSWORD:0:10}... (truncated)"
echo "  GRAFANA_ADMIN_PASSWORD: ${GF_SECURITY_ADMIN_PASSWORD:0:10}... (truncated)"

# Generate application secrets
APP_SECRET=$(generate_secret 32)
ENCRYPTION_KEY=$(generate_secret 16)

echo -e "\n${BLUE}Application Secrets:${NC}"
echo "  APP_SECRET: ${APP_SECRET:0:20}... (truncated)"
echo "  ENCRYPTION_KEY: ${ENCRYPTION_KEY:0:20}... (truncated)"

# Update the production environment file
sed -i.bak "s|JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET|" $ENV_FILE
sed -i.bak "s|JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET|" $ENV_FILE
sed -i.bak "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" $ENV_FILE
sed -i.bak "s|REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" $ENV_FILE
sed -i.bak "s|GF_SECURITY_ADMIN_PASSWORD=.*|GF_SECURITY_ADMIN_PASSWORD=$GF_SECURITY_ADMIN_PASSWORD|" $ENV_FILE
sed -i.bak "s|APP_SECRET=.*|APP_SECRET=$APP_SECRET|" $ENV_FILE
sed -i.bak "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" $ENV_FILE

# Clean up backup files
rm -f ${ENV_FILE}.bak*

echo -e "\n${GREEN}✅ Production environment file created: $ENV_FILE${NC}"
echo "======================================"
echo -e "${YELLOW}⚠️  Important Security Notes:${NC}"
echo "1. Store this file securely and never commit it to version control"
echo "2. Back up these credentials in a secure password manager"
echo "3. Set up proper file permissions: chmod 600 $ENV_FILE"
echo "4. For SendGrid API key, obtain from: https://sendgrid.com/docs/ui/account-and-settings/api-keys/"
echo "5. For AWS credentials (if using S3), configure in AWS IAM"
echo ""
echo -e "${YELLOW}Required Manual Configuration:${NC}"
echo "- SENDGRID_API_KEY: Get from SendGrid dashboard"
echo "- DATABASE_URL: Update with your production PostgreSQL URL"
echo "- FRONTEND_URL: Update with your production domain"
echo "- ML_SERVICE_URL: Update if using separate ML infrastructure"

# Set proper permissions
chmod 600 $ENV_FILE

echo -e "\n${GREEN}File permissions set to 600 (owner read/write only)${NC}"