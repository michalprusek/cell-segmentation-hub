#!/bin/bash

# SendGrid DNS Verification Script
# Checks if all required DNS records are properly configured

set -e

echo "======================================"
echo "   SendGrid DNS Verification"
echo "   Domain: spherosegapp.utia.cas.cz"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# DNS records to check
declare -A CNAME_RECORDS=(
    ["url4698.spherosegapp.utia.cas.cz"]="sendgrid.net"
    ["55436482.spherosegapp.utia.cas.cz"]="sendgrid.net"
    ["em6324.spherosegapp.utia.cas.cz"]="u55436482.wl233.sendgrid.net"
    ["s1._domainkey.spherosegapp.utia.cas.cz"]="s1.domainkey.u55436482.wl233.sendgrid.net"
    ["s2._domainkey.spherosegapp.utia.cas.cz"]="s2.domainkey.u55436482.wl233.sendgrid.net"
)

TXT_HOST="_dmarc.spherosegapp.utia.cas.cz"
TXT_VALUE="v=DMARC1; p=none;"

# Check if dig is available
if ! command -v dig &> /dev/null; then
    echo -e "${RED}❌ 'dig' command not found. Please install bind-utils or dnsutils.${NC}"
    exit 1
fi

echo "Checking CNAME Records..."
echo "========================="
echo ""

CNAME_OK=0
CNAME_FAIL=0

for HOST in "${!CNAME_RECORDS[@]}"; do
    EXPECTED="${CNAME_RECORDS[$HOST]}"
    echo -n "Checking $HOST... "
    
    # Query DNS
    RESULT=$(dig +short CNAME "$HOST" 2>/dev/null | head -1 | sed 's/\.$//')
    
    if [ -z "$RESULT" ]; then
        echo -e "${RED}❌ NOT FOUND${NC}"
        echo "  Expected: $EXPECTED"
        CNAME_FAIL=$((CNAME_FAIL + 1))
    elif [ "$RESULT" = "$EXPECTED" ] || [ "$RESULT." = "$EXPECTED" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        echo "  Points to: $RESULT"
        CNAME_OK=$((CNAME_OK + 1))
    else
        echo -e "${YELLOW}⚠️  MISMATCH${NC}"
        echo "  Expected: $EXPECTED"
        echo "  Found: $RESULT"
        CNAME_FAIL=$((CNAME_FAIL + 1))
    fi
    echo ""
done

echo "Checking TXT Record..."
echo "====================="
echo ""

echo -n "Checking $TXT_HOST... "
TXT_RESULT=$(dig +short TXT "$TXT_HOST" 2>/dev/null | tr -d '"')

if [ -z "$TXT_RESULT" ]; then
    echo -e "${RED}❌ NOT FOUND${NC}"
    echo "  Expected: $TXT_VALUE"
    TXT_OK=0
elif [[ "$TXT_RESULT" == *"$TXT_VALUE"* ]] || [[ "$TXT_RESULT" == *"v=DMARC1"* ]]; then
    echo -e "${GREEN}✅ OK${NC}"
    echo "  Value: $TXT_RESULT"
    TXT_OK=1
else
    echo -e "${YELLOW}⚠️  UNEXPECTED VALUE${NC}"
    echo "  Expected: $TXT_VALUE"
    echo "  Found: $TXT_RESULT"
    TXT_OK=0
fi

echo ""
echo "======================================"
echo "   Summary"
echo "======================================"
echo ""

TOTAL_RECORDS=6
RECORDS_OK=$((CNAME_OK + TXT_OK))

echo "CNAME Records: $CNAME_OK/5"
echo "TXT Records: $TXT_OK/1"
echo "Total: $RECORDS_OK/$TOTAL_RECORDS"
echo ""

if [ $RECORDS_OK -eq $TOTAL_RECORDS ]; then
    echo -e "${GREEN}✅ All DNS records are properly configured!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Go to https://app.sendgrid.com/settings/sender_auth"
    echo "2. Click 'Verify' next to your domain"
    echo "3. All records should show green checkmarks"
elif [ $RECORDS_OK -eq 0 ]; then
    echo -e "${RED}❌ No DNS records found. Please add them to your DNS zone.${NC}"
    echo ""
    echo "See SENDGRID_DNS_SETUP.md for instructions."
else
    echo -e "${YELLOW}⚠️  Some DNS records are missing or incorrect.${NC}"
    echo ""
    echo "Please check the records marked with ❌ or ⚠️ above."
    echo "See SENDGRID_DNS_SETUP.md for correct values."
fi

echo ""
echo "======================================"
echo "   DNS Propagation Check"
echo "======================================"
echo ""

# Check with public DNS servers
echo "Checking with public DNS servers..."
for DNS_SERVER in "8.8.8.8" "1.1.1.1"; do
    echo -n "  $DNS_SERVER: "
    CHECK=$(dig @$DNS_SERVER +short CNAME url4698.spherosegapp.utia.cas.cz 2>/dev/null | head -1)
    if [ ! -z "$CHECK" ]; then
        echo -e "${GREEN}✅ Responding${NC}"
    else
        echo -e "${YELLOW}⚠️  Not propagated yet${NC}"
    fi
done

echo ""
echo "Note: DNS propagation can take 1-48 hours."
echo "If records were just added, please wait and try again later."