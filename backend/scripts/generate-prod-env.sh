#!/bin/bash

# Generate secure production environment variables

set -e

echo "🔐 Generating Production Environment Variables"
echo "============================================="

# Check if template exists
if [ ! -f ".env.production.template" ]; then
    echo "Error: .env.production.template not found"
    exit 1
fi

# Copy template
cp .env.production.template .env.production

# Generate secure random values
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
GF_ADMIN_PASSWORD=$(openssl rand -hex 16)

# Function to verify sed replacement
verify_replacement() {
    local key="$1"
    local value="$2"
    if ! grep -q "^${key}=${value}$" .env.production; then
        echo "Error: Failed to set ${key} in .env.production" >&2
        exit 1
    fi
}

# Update the file (cross-platform)
if [[ "$(uname -s)" == "Darwin" ]]; then
    # macOS requires empty string as separate argument
    sed -i '' "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET|" .env.production
    verify_replacement "JWT_ACCESS_SECRET" "$JWT_ACCESS_SECRET"
    
    sed -i '' "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET|" .env.production
    verify_replacement "JWT_REFRESH_SECRET" "$JWT_REFRESH_SECRET"
    
    sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" .env.production
    verify_replacement "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
    
    sed -i '' "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" .env.production
    verify_replacement "REDIS_PASSWORD" "$REDIS_PASSWORD"
    
    sed -i '' "s|^GF_ADMIN_PASSWORD=.*|GF_ADMIN_PASSWORD=$GF_ADMIN_PASSWORD|" .env.production
    verify_replacement "GF_ADMIN_PASSWORD" "$GF_ADMIN_PASSWORD"
else
    # Linux/other
    sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET|" .env.production
    verify_replacement "JWT_ACCESS_SECRET" "$JWT_ACCESS_SECRET"
    
    sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET|" .env.production
    verify_replacement "JWT_REFRESH_SECRET" "$JWT_REFRESH_SECRET"
    
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" .env.production
    verify_replacement "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
    
    sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" .env.production
    verify_replacement "REDIS_PASSWORD" "$REDIS_PASSWORD"
    
    sed -i "s|^GF_ADMIN_PASSWORD=.*|GF_ADMIN_PASSWORD=$GF_ADMIN_PASSWORD|" .env.production
    verify_replacement "GF_ADMIN_PASSWORD" "$GF_ADMIN_PASSWORD"
fi

# Set secure permissions
chmod 600 .env.production

echo "✅ Production environment created: .env.production"
echo ""
echo "⚠️  Manual configuration still required:"
echo "  - SENDGRID_API_KEY"
echo "  - DATABASE_URL (production PostgreSQL)"
echo "  - FRONTEND_URL (your domain)"
echo ""
echo "Keep this file secure and never commit to git!"