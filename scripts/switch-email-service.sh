#!/bin/bash

# Script to switch between MailHog and SendGrid email services

set -e

echo "======================================"
echo "   Email Service Switcher"
echo "======================================"
echo ""
echo "Choose email service:"
echo "1) MailHog (Development/Testing)"
echo "2) SendGrid (Production)"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        echo ""
        echo "Switching to MailHog..."
        
        # Export MailHog configuration
        export EMAIL_SERVICE=smtp
        export SMTP_HOST=mailhog-blue
        export SMTP_PORT=1025
        export SMTP_SECURE=false
        export SMTP_AUTH=false
        unset SENDGRID_API_KEY
        
        echo "✅ Configured for MailHog"
        echo ""
        echo "Settings:"
        echo "  - SMTP Host: mailhog-blue:1025"
        echo "  - Web UI: http://localhost:8025"
        echo "  - All emails will be captured locally"
        ;;
        
    2)
        echo ""
        echo "Switching to SendGrid..."
        
        # Check for .env.sendgrid
        if [ ! -f ".env.sendgrid" ]; then
            echo "❌ .env.sendgrid not found!"
            echo "Please run: ./scripts/setup-sendgrid.sh"
            exit 1
        fi
        
        # Load SendGrid configuration
        source .env.sendgrid
        
        if [ "$SENDGRID_API_KEY" = "YOUR_SENDGRID_API_KEY_HERE" ]; then
            echo "❌ SendGrid API key not configured!"
            echo "Please run: ./scripts/setup-sendgrid.sh"
            exit 1
        fi
        
        # Export SendGrid configuration
        export EMAIL_SERVICE=sendgrid
        export SENDGRID_API_KEY
        unset SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_AUTH
        
        echo "✅ Configured for SendGrid"
        echo ""
        echo "Settings:"
        echo "  - API Key: ${SENDGRID_API_KEY:0:10}..."
        echo "  - From: $FROM_EMAIL"
        echo "  - Real emails will be sent!"
        ;;
        
    *)
        echo "Invalid choice!"
        exit 1
        ;;
esac

echo ""
echo "======================================"
echo "   Restart Instructions:"
echo "======================================"
echo ""
echo "To apply changes, run:"
echo ""

if [ "$choice" = "1" ]; then
    cat << 'EOF'
# For MailHog:
export EMAIL_SERVICE=smtp
export SMTP_HOST=mailhog-blue
export SMTP_PORT=1025
export SMTP_SECURE=false
export SMTP_AUTH=false

# Also export existing env vars
export DB_PASSWORD=blue_prod_password_2024
export BLUE_JWT_ACCESS_SECRET=a3f8c9d2e5b7f1c4a6d9e2f5b8c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5
export BLUE_JWT_REFRESH_SECRET=b4e9d3f7a2c6e1b5d8f2a5c8b1e4d7f0a3c6b9d2e5f8a1c4b7d0e3f6a9c2b5d8

# Restart backend
docker compose -f docker-compose.blue-hybrid.yml up -d blue-backend

# View emails at: http://localhost:8025
EOF
else
    cat << EOF
# For SendGrid:
source .env.sendgrid
export EMAIL_SERVICE=sendgrid
export SENDGRID_API_KEY

# Also export existing env vars
export DB_PASSWORD=blue_prod_password_2024
export BLUE_JWT_ACCESS_SECRET=a3f8c9d2e5b7f1c4a6d9e2f5b8c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5
export BLUE_JWT_REFRESH_SECRET=b4e9d3f7a2c6e1b5d8f2a5c8b1e4d7f0a3c6b9d2e5f8a1c4b7d0e3f6a9c2b5d8

# Restart backend
docker compose -f docker-compose.blue-hybrid.yml up -d blue-backend

# Monitor SendGrid dashboard at: https://app.sendgrid.com
EOF
fi

echo ""
echo "======================================"