#!/bin/bash

# SSL Certificate Generation Script
set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve to absolute path
SSL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/docker/nginx/ssl"

# Create SSL directory with proper permissions
mkdir -p "$SSL_DIR"

# Generate self-signed certificate for development with SAN
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$SSL_DIR/server.key" \
  -out "$SSL_DIR/server.crt" \
  -subj "/C=US/ST=State/L=City/O=Cell Segmentation Hub/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Set proper permissions
chmod 600 "$SSL_DIR/server.key"
chmod 644 "$SSL_DIR/server.crt"

echo "✅ SSL certificates generated in $SSL_DIR"
echo "Note: These are self-signed certificates for development."
echo "For production, use Let's Encrypt or CA-signed certificates."