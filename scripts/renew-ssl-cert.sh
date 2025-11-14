#!/bin/bash
# SSL Certificate Renewal Script for spherosegapp.utia.cas.cz
# This script renews the Let's Encrypt SSL certificate using standalone mode
# with comprehensive error handling and blue-green deployment support

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

DOMAIN="${DOMAIN:-spherosegapp.utia.cas.cz}"
EMAIL="${EMAIL:-spheroseg@utia.cas.cz}"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/cert.pem"
LOGFILE="/var/log/ssl-renewal-$(date +%Y%m%d-%H%M%S).log"
ALERT_EMAIL="${ALERT_EMAIL:-spheroseg@utia.cas.cz}"

# ============================================================================
# Logging Setup
# ============================================================================

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOGFILE")"

# Redirect all output to log file and console
exec 1> >(tee -a "$LOGFILE")
exec 2>&1

# ============================================================================
# Error Handling
# ============================================================================

function send_alert() {
    local status=$1
    local message=$2
    echo "ALERT: $message"

    # Try to send email alert if mail command is available
    if command -v mail >/dev/null 2>&1; then
        echo "$message" | mail -s "SSL Renewal $status - $DOMAIN" "$ALERT_EMAIL" 2>/dev/null || true
    else
        echo "Warning: mail command not available, cannot send email alert"
    fi
}

function cleanup_on_error() {
    local exit_code=$?
    echo ""
    echo "ERROR: Script failed with exit code $exit_code"
    echo "Attempting service recovery..."

    # Try to restart nginx-main to restore service
    if docker ps -a --format '{{.Names}}' | grep -q '^nginx-main$'; then
        if ! docker ps --format '{{.Names}}' | grep -q '^nginx-main$'; then
            echo "nginx-main is stopped, attempting to restart..."
            if docker start nginx-main; then
                echo "✓ nginx-main restarted - service restored"
                send_alert "PARTIAL FAILURE" "SSL renewal failed but service was restored. Check log: $LOGFILE"
            else
                echo "CRITICAL: Failed to restart nginx-main - SERVICE IS DOWN!"
                send_alert "CRITICAL FAILURE" "SSL renewal failed and service could not be restored. IMMEDIATE ACTION REQUIRED. Check log: $LOGFILE"
            fi
        fi
    fi

    exit $exit_code
}

trap cleanup_on_error ERR

# ============================================================================
# Main Script
# ============================================================================

echo "=== SSL Certificate Renewal ==="
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo "Date: $(date)"
echo "Log file: $LOGFILE"
echo ""

# Check current certificate status
echo "Current certificate status:"
if openssl x509 -in "$CERT_PATH" -noout -dates 2>/dev/null; then
    echo "Certificate found and valid"
else
    echo "Certificate not found or invalid (this is normal for first run)"
fi
echo ""

# Stop nginx-main to free ports 80 and 443
echo "Stopping nginx-main container..."
if docker ps --format '{{.Names}}' | grep -q '^nginx-main$'; then
    if ! docker stop nginx-main; then
        echo "ERROR: Failed to stop nginx-main container"
        echo "Check if container exists: docker ps -a | grep nginx-main"
        exit 1
    fi
    echo "✓ nginx-main stopped"
else
    echo "ℹ nginx-main is not running (this may be expected)"
fi
echo ""

# Renew certificate with standalone mode
echo "Renewing certificate with certbot (standalone mode)..."
if ! certbot certonly --standalone \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --force-renewal \
    --preferred-challenges http \
    --http-01-port 80 2>&1 | tee /tmp/certbot-renewal.log; then

    echo ""
    echo "ERROR: Certificate renewal failed!"
    echo "Certbot log saved to: /tmp/certbot-renewal.log"
    echo ""
    echo "Common causes:"
    echo "  - Rate limit exceeded (Let's Encrypt limits: 5/week per domain)"
    echo "  - Port 80 still in use (check: lsof -i :80)"
    echo "  - DNS not resolving (check: nslookup $DOMAIN)"
    echo "  - Network connectivity issues"
    echo "  - Firewall blocking port 80"
    echo ""

    # cleanup_on_error trap will handle service recovery
    exit 1
fi

echo "✓ Certificate renewed successfully"
echo ""

# Show new certificate dates
echo "New certificate status:"
openssl x509 -in "$CERT_PATH" -noout -dates
echo ""

# Start nginx-main again
echo "Starting nginx-main container..."
if ! docker start nginx-main; then
    echo "CRITICAL ERROR: Failed to start nginx-main container"
    echo "Certificate was renewed but nginx cannot start"
    echo "SERVICE IS DOWN - immediate manual intervention required!"
    echo ""
    echo "Troubleshooting steps:"
    echo "  1. Check docker logs: docker logs nginx-main"
    echo "  2. Try manual start: docker start nginx-main"
    echo "  3. Check nginx config: docker exec nginx-main nginx -t"
    echo ""
    exit 3
fi

echo "Waiting for nginx to initialize..."
sleep 3

# Verify nginx configuration is valid
echo "Verifying nginx configuration..."
if ! docker exec nginx-main nginx -t 2>&1; then
    echo "ERROR: Nginx configuration test failed"
    echo "Service may be running with old configuration"
    echo "Check configuration: docker exec nginx-main nginx -t"
    exit 4
fi
echo "✓ Nginx configuration is valid"

# Reload nginx to pick up new certificate
if docker exec nginx-main nginx -s reload 2>&1; then
    echo "✓ nginx-main started and reloaded successfully"
else
    echo "WARNING: Nginx reload failed, but container is running"
    echo "Service should still be operational with configuration from startup"
fi
echo ""

# Reload nginx-blue (if running - blue-green deployment)
echo "Reloading nginx-blue container..."
if docker ps --format '{{.Names}}' | grep -q '^nginx-blue$'; then
    if docker exec nginx-blue nginx -t 2>&1; then
        if docker exec nginx-blue nginx -s reload 2>&1; then
            echo "✓ nginx-blue reloaded successfully"
        else
            echo "ERROR: nginx-blue reload failed"
            echo "Check: docker exec nginx-blue nginx -s reload"
            exit 5
        fi
    else
        echo "ERROR: nginx-blue configuration test failed"
        echo "Check: docker exec nginx-blue nginx -t"
        exit 6
    fi
else
    echo "ℹ nginx-blue container not running (this may be expected)"
fi
echo ""

# Reload nginx-green (if running - blue-green deployment)
echo "Reloading nginx-green container..."
if docker ps --format '{{.Names}}' | grep -q '^nginx-green$'; then
    if docker exec nginx-green nginx -t 2>&1; then
        if docker exec nginx-green nginx -s reload 2>&1; then
            echo "✓ nginx-green reloaded successfully"
        else
            echo "ERROR: nginx-green reload failed"
            echo "Check: docker exec nginx-green nginx -s reload"
            exit 7
        fi
    else
        echo "ERROR: nginx-green configuration test failed"
        echo "Check: docker exec nginx-green nginx -t"
        exit 8
    fi
else
    echo "ℹ nginx-green container not running (this may be expected)"
fi
echo ""

echo "=== Certificate Renewal Complete ==="
echo "New certificate valid until: $(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)"
echo "Please verify at: https://$DOMAIN/"
echo "Log saved to: $LOGFILE"
echo ""

# Send success notification
send_alert "SUCCESS" "SSL certificate for $DOMAIN renewed successfully. Valid until: $(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)"

exit 0
