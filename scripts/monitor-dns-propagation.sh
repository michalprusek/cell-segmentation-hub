#!/bin/bash

# Monitor SendGrid DNS propagation
# Checks DNS records every 5 minutes and notifies when ready

echo "======================================"
echo "   DNS Propagation Monitor"
echo "   Domain: spherosegapp.utia.cas.cz"
echo "======================================"
echo ""
echo "Monitoring DNS propagation..."
echo "Press Ctrl+C to stop"
echo ""

# Track first detection time
FIRST_DETECTED=""
ALL_RECORDS_OK=false

while true; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Check one key record as indicator
    CHECK=$(dig +short CNAME url4698.spherosegapp.utia.cas.cz 2>/dev/null | head -1)
    
    if [ ! -z "$CHECK" ]; then
        if [ -z "$FIRST_DETECTED" ]; then
            FIRST_DETECTED=$TIMESTAMP
            echo "[$TIMESTAMP] ✅ DNS records detected! Running full check..."
            echo ""
            
            # Run full verification
            /home/cvat/cell-segmentation-hub/scripts/verify-sendgrid-dns.sh
            
            # Check if all records are OK
            TOTAL_OK=$(./scripts/verify-sendgrid-dns.sh 2>/dev/null | grep "Total:" | grep -o "[0-9]/6" | cut -d'/' -f1)
            
            if [ "$TOTAL_OK" = "6" ]; then
                echo ""
                echo "🎉 All DNS records are properly configured!"
                echo "You can now verify the domain in SendGrid dashboard."
                ALL_RECORDS_OK=true
                break
            else
                echo ""
                echo "⚠️  Some records are still propagating..."
            fi
        else
            echo "[$TIMESTAMP] Records detected since $FIRST_DETECTED"
            
            # Quick check of all records
            TOTAL_OK=0
            [ ! -z "$(dig +short CNAME url4698.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            [ ! -z "$(dig +short CNAME 55436482.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            [ ! -z "$(dig +short CNAME em6324.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            [ ! -z "$(dig +short CNAME s1._domainkey.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            [ ! -z "$(dig +short CNAME s2._domainkey.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            [ ! -z "$(dig +short TXT _dmarc.spherosegapp.utia.cas.cz)" ] && ((TOTAL_OK++))
            
            echo "  Records found: $TOTAL_OK/6"
            
            if [ "$TOTAL_OK" = "6" ]; then
                echo ""
                echo "🎉 All DNS records are now propagated!"
                echo ""
                /home/cvat/cell-segmentation-hub/scripts/verify-sendgrid-dns.sh
                ALL_RECORDS_OK=true
                break
            fi
        fi
    else
        echo "[$TIMESTAMP] Waiting for DNS propagation..."
    fi
    
    # Wait 5 minutes before next check
    sleep 300
done

if [ "$ALL_RECORDS_OK" = true ]; then
    echo ""
    echo "======================================"
    echo "   Next Steps"
    echo "======================================"
    echo ""
    echo "1. Go to: https://app.sendgrid.com/settings/sender_auth"
    echo "2. Find domain: spherosegapp.utia.cas.cz"
    echo "3. Click 'Verify'"
    echo "4. All items should show green checkmarks"
    echo ""
    echo "5. Get your API key from:"
    echo "   https://app.sendgrid.com/settings/api_keys"
    echo ""
    echo "6. Configure SendGrid:"
    echo "   ./scripts/setup-sendgrid.sh"
    echo ""
    echo "7. Test email sending:"
    echo "   ./scripts/test-sendgrid.sh"
fi