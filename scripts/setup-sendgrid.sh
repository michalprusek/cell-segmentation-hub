#!/bin/bash

# SendGrid Setup Script for SpheroSeg
# This script helps configure SendGrid email service

set -e

echo "======================================"
echo "   SendGrid Email Setup for SpheroSeg"
echo "======================================"
echo ""

# Check if .env.sendgrid exists
if [ ! -f ".env.sendgrid" ]; then
    echo "Creating .env.sendgrid file..."
    cat > .env.sendgrid << 'EOF'
# SendGrid Configuration
SENDGRID_API_KEY=YOUR_API_KEY_HERE
EMAIL_SERVICE=sendgrid
FROM_EMAIL=spheroseg@utia.cas.cz
FROM_NAME=SpheroSeg Platform
EOF
fi

# Prompt for SendGrid API key
echo "Please enter your SendGrid API key:"
echo "(Get it from: https://app.sendgrid.com/settings/api_keys)"
echo ""
read -p "SendGrid API Key (SG.xxx...): " api_key

if [ -z "$api_key" ]; then
    echo "Error: API key cannot be empty"
    exit 1
fi

# Validate API key format (should start with SG. and be 69 chars)
if [[ ! "$api_key" =~ ^SG\..{66}$ ]]; then
    echo "Warning: API key format looks incorrect. SendGrid keys are 69 chars starting with 'SG.'"
    read -p "Continue anyway? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        exit 1
    fi
fi

# Update .env.sendgrid
sed -i "s/SENDGRID_API_KEY=.*/SENDGRID_API_KEY=$api_key/" .env.sendgrid

echo ""
echo "✅ SendGrid API key saved to .env.sendgrid"
echo ""

# Ask about sender email
read -p "Enter sender email (default: spheroseg@utia.cas.cz): " sender_email
if [ ! -z "$sender_email" ]; then
    sed -i "s/FROM_EMAIL=.*/FROM_EMAIL=$sender_email/" .env.sendgrid
    echo "✅ Sender email updated: $sender_email"
fi

echo ""
echo "======================================"
echo "   Next Steps:"
echo "======================================"
echo ""
echo "1. VERIFY YOUR SENDER:"
echo "   - Go to: https://app.sendgrid.com/settings/sender_auth"
echo "   - Verify either:"
echo "     a) Single sender email: $sender_email"
echo "     b) Your entire domain"
echo ""
echo "2. TEST YOUR CONFIGURATION:"
echo "   ./scripts/test-sendgrid.sh"
echo ""
echo "3. DEPLOY TO PRODUCTION:"
echo "   export SENDGRID_API_KEY='$api_key'"
echo "   docker compose -f docker-compose.blue.yml up -d"
echo ""
echo "4. SWITCH BETWEEN MAILHOG AND SENDGRID:"
echo "   - Development (MailHog): EMAIL_SERVICE=smtp"
echo "   - Production (SendGrid): EMAIL_SERVICE=sendgrid"
echo ""

# Create test script
cat > scripts/test-sendgrid.sh << 'EOF'
#!/bin/bash
# Test SendGrid configuration

source .env.sendgrid

echo "Testing SendGrid configuration..."
echo "API Key: ${SENDGRID_API_KEY:0:10}..."
echo "From Email: $FROM_EMAIL"

# Test with curl
response=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $SENDGRID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "personalizations": [{"to": [{"email": "test@example.com"}]}],
    "from": {"email": "'$FROM_EMAIL'"},
    "subject": "SendGrid Test",
    "content": [{"type": "text/plain", "value": "Test email from SpheroSeg"}]
  }')

if [ "$response" = "202" ]; then
  echo "✅ SendGrid configuration is working!"
elif [ "$response" = "401" ]; then
  echo "❌ Invalid API key"
elif [ "$response" = "403" ]; then
  echo "❌ Sender not verified. Please verify $FROM_EMAIL at:"
  echo "   https://app.sendgrid.com/settings/sender_auth"
else
  echo "❌ SendGrid test failed with status: $response"
fi
EOF

chmod +x scripts/test-sendgrid.sh

echo "Setup complete! Configuration saved in .env.sendgrid"