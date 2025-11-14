#!/bin/bash
# SSL Certificate Renewal Script for spherosegapp.utia.cas.cz
# This script renews the Let's Encrypt SSL certificate using standalone mode

set -e

echo "=== SSL Certificate Renewal ==="
echo "Domain: spherosegapp.utia.cas.cz"
echo "Date: $(date)"
echo ""

# Check current certificate status
echo "Current certificate status:"
openssl x509 -in /etc/letsencrypt/live/spherosegapp.utia.cas.cz/cert.pem -noout -dates 2>/dev/null || echo "Certificate not found"
echo ""

# Stop nginx-main to free ports 80 and 443
echo "Stopping nginx-main container..."
docker stop nginx-main
echo "✓ nginx-main stopped"
echo ""

# Renew certificate with standalone mode
echo "Renewing certificate with certbot (standalone mode)..."
certbot certonly --standalone \
    -d spherosegapp.utia.cas.cz \
    --email spheroseg@utia.cas.cz \
    --agree-tos \
    --non-interactive \
    --force-renewal \
    --preferred-challenges http \
    --http-01-port 80

echo "✓ Certificate renewed successfully"
echo ""

# Show new certificate dates
echo "New certificate status:"
openssl x509 -in /etc/letsencrypt/live/spherosegapp.utia.cas.cz/cert.pem -noout -dates
echo ""

# Start nginx-main again
echo "Starting nginx-main container..."
docker start nginx-main
sleep 3
docker exec nginx-main nginx -s reload 2>/dev/null || echo "Nginx will reload on start"
echo "✓ nginx-main started and reloaded"
echo ""

# Reload other nginx containers
echo "Reloading nginx-blue container..."
docker exec nginx-blue nginx -s reload 2>/dev/null && echo "✓ nginx-blue reloaded" || echo "⚠ nginx-blue not found"
echo ""

echo "=== Certificate Renewal Complete ==="
echo "New certificate valid until: $(openssl x509 -in /etc/letsencrypt/live/spherosegapp.utia.cas.cz/cert.pem -noout -enddate | cut -d= -f2)"
echo "Please verify at: https://spherosegapp.utia.cas.cz/"
echo ""
