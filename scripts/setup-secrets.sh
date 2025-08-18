#!/bin/bash
# Setup Docker secrets for production deployment
# Run this script before starting the production stack

set -e

echo "🔐 Setting up Docker secrets for production deployment..."

# Check if Docker swarm is initialized
if ! docker info | grep -q "Swarm: active"; then
    echo "⚠️  Docker swarm not active. Initializing..."
    docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')
fi

# Function to create or update a secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2
    local description=$3
    
    if docker secret ls --format "{{.Name}}" | grep -q "^${secret_name}$"; then
        echo "🔄 Updating existing secret: $description"
        docker secret rm "$secret_name" 2>/dev/null || true
        sleep 1
    else
        echo "➕ Creating new secret: $description"
    fi
    
    echo -n "$secret_value" | docker secret create "$secret_name" -
}

# Load environment variables from .env.production if it exists
if [[ -f ".env.production" ]]; then
    source .env.production
    echo "📄 Loaded environment from .env.production"
fi

# Create secrets (prompt for values if not in environment)
if [[ -z "$JWT_ACCESS_SECRET" ]]; then
    echo "🔑 JWT Access Secret not found in environment."
    read -s -p "Enter JWT Access Secret (or press Enter to generate): " JWT_ACCESS_SECRET
    echo
    if [[ -z "$JWT_ACCESS_SECRET" ]]; then
        JWT_ACCESS_SECRET=$(openssl rand -base64 64)
        echo "🎲 Generated random JWT Access Secret"
    fi
fi

if [[ -z "$JWT_REFRESH_SECRET" ]]; then
    echo "🔑 JWT Refresh Secret not found in environment."
    read -s -p "Enter JWT Refresh Secret (or press Enter to generate): " JWT_REFRESH_SECRET
    echo
    if [[ -z "$JWT_REFRESH_SECRET" ]]; then
        JWT_REFRESH_SECRET=$(openssl rand -base64 64)
        echo "🎲 Generated random JWT Refresh Secret"
    fi
fi

if [[ -z "$DB_PASSWORD" ]]; then
    echo "🗄️ Database Password not found in environment."
    read -s -p "Enter Database Password (or press Enter to generate): " DB_PASSWORD
    echo
    if [[ -z "$DB_PASSWORD" ]]; then
        DB_PASSWORD=$(openssl rand -base64 32)
        echo "🎲 Generated random Database Password"
    fi
fi

if [[ -z "$GRAFANA_ADMIN_PASSWORD" ]]; then
    echo "📊 Grafana Admin Password not found in environment."
    read -s -p "Enter Grafana Admin Password (or press Enter to generate): " GRAFANA_ADMIN_PASSWORD
    echo
    if [[ -z "$GRAFANA_ADMIN_PASSWORD" ]]; then
        GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16)
        echo "🎲 Generated random Grafana Admin Password"
    fi
fi

# Create Docker secrets
create_or_update_secret "spheroseg_jwt_access_secret" "$JWT_ACCESS_SECRET" "JWT Access Token Secret"
create_or_update_secret "spheroseg_jwt_refresh_secret" "$JWT_REFRESH_SECRET" "JWT Refresh Token Secret"
create_or_update_secret "spheroseg_db_password" "$DB_PASSWORD" "PostgreSQL Database Password"
create_or_update_secret "spheroseg_grafana_admin_password" "$GRAFANA_ADMIN_PASSWORD" "Grafana Admin Password"

echo "✅ Docker secrets created successfully!"
echo ""
echo "📋 Summary:"
echo "   🔑 JWT Access Secret: spheroseg_jwt_access_secret"
echo "   🔑 JWT Refresh Secret: spheroseg_jwt_refresh_secret"
echo "   🗄️ Database Password: spheroseg_db_password"
echo "   📊 Grafana Admin Password: spheroseg_grafana_admin_password"
echo ""
echo "🚀 You can now start the production stack with secrets:"
echo "   docker-compose -f docker-compose.prod.yml -f docker-compose.secrets.yml up -d"
echo ""
echo "⚠️  IMPORTANT: Save the generated passwords securely if they were auto-generated!"

# Save generated secrets to a secure file (only if they were generated)
if [[ ! -f ".env.production" ]]; then
    cat > .env.production.generated << EOF
# Generated secrets for SpheroSeg production deployment
# KEEP THIS FILE SECURE AND DO NOT COMMIT TO VERSION CONTROL

JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
DB_PASSWORD=$DB_PASSWORD
GRAFANA_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD

# Generated on: $(date)
EOF
    echo "💾 Generated secrets saved to .env.production.generated"
    echo "   Make sure to keep this file secure!"
    chmod 600 .env.production.generated
fi