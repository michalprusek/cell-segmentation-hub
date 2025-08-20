#!/bin/bash

# SSL Certificate Generation Script for Cell Segmentation Hub
# This script generates self-signed SSL certificates for development/testing
# For production, use Let's Encrypt or proper CA-signed certificates

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔐 SSL Certificate Generation Script${NC}"
echo "======================================"

# Check if OpenSSL is installed
if ! command -v openssl &> /dev/null; then
    echo -e "${RED}Error: OpenSSL is not installed${NC}"
    echo "Please install OpenSSL and try again"
    exit 1
fi

# Configuration
SSL_DIR="docker/nginx/ssl"
CERT_FILE="$SSL_DIR/server.crt"
KEY_FILE="$SSL_DIR/server.key"
CSR_FILE="$SSL_DIR/server.csr"
CONFIG_FILE="$SSL_DIR/openssl.cnf"

# Get domain from user or use default
read -p "Enter your domain name (default: localhost): " DOMAIN
DOMAIN=${DOMAIN:-localhost}

echo -e "\n${YELLOW}Generating SSL certificates for: $DOMAIN${NC}"

# Create SSL directory if it doesn't exist
mkdir -p $SSL_DIR

# Create OpenSSL configuration file
cat > $CONFIG_FILE <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=State
L=City
O=Cell Segmentation Hub
OU=Development
CN=$DOMAIN

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = *.$DOMAIN
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

# Generate private key
echo -e "\n${YELLOW}1. Generating private key...${NC}"
openssl genrsa -out $KEY_FILE 2048

# Generate certificate signing request
echo -e "\n${YELLOW}2. Generating certificate signing request...${NC}"
openssl req -new -key $KEY_FILE -out $CSR_FILE -config $CONFIG_FILE

# Generate self-signed certificate (valid for 365 days)
echo -e "\n${YELLOW}3. Generating self-signed certificate...${NC}"
openssl x509 -req -days 365 -in $CSR_FILE -signkey $KEY_FILE -out $CERT_FILE -extensions v3_req -extfile $CONFIG_FILE

# Set proper permissions
chmod 600 $KEY_FILE
chmod 644 $CERT_FILE

# Clean up CSR file
rm -f $CSR_FILE

# Generate DH parameters for additional security (optional but recommended)
echo -e "\n${YELLOW}4. Generating DH parameters (this may take a while)...${NC}"
openssl dhparam -out $SSL_DIR/dhparam.pem 2048

# Verify certificate
echo -e "\n${YELLOW}5. Verifying certificate...${NC}"
openssl x509 -in $CERT_FILE -text -noout | grep -E "Subject:|DNS:|IP:"

echo -e "\n${GREEN}✅ SSL certificates generated successfully!${NC}"
echo "======================================"
echo "Certificate files created:"
echo "  - Certificate: $CERT_FILE"
echo "  - Private Key: $KEY_FILE"
echo "  - DH Parameters: $SSL_DIR/dhparam.pem"
echo ""
echo -e "${YELLOW}⚠️  Note: These are self-signed certificates for development/testing.${NC}"
echo -e "${YELLOW}    For production, use Let's Encrypt or proper CA-signed certificates.${NC}"
echo ""
echo "To use Let's Encrypt in production, run:"
echo "  certbot certonly --standalone -d $DOMAIN"