# SendGrid DNS Configuration for spherosegapp.utia.cas.cz

## DNS Records to Add

Please add the following DNS records to verify the domain with SendGrid:

### CNAME Records

| Type  | Host                                    | Value                                     |
| ----- | --------------------------------------- | ----------------------------------------- |
| CNAME | url4698.spherosegapp.utia.cas.cz        | sendgrid.net                              |
| CNAME | 55436482.spherosegapp.utia.cas.cz       | sendgrid.net                              |
| CNAME | em6324.spherosegapp.utia.cas.cz         | u55436482.wl233.sendgrid.net              |
| CNAME | s1.\_domainkey.spherosegapp.utia.cas.cz | s1.domainkey.u55436482.wl233.sendgrid.net |
| CNAME | s2.\_domainkey.spherosegapp.utia.cas.cz | s2.domainkey.u55436482.wl233.sendgrid.net |

### TXT Records

| Type | Host                             | Value             |
| ---- | -------------------------------- | ----------------- |
| TXT  | \_dmarc.spherosegapp.utia.cas.cz | v=DMARC1; p=none; |

## Purpose of Each Record

1. **url4698 & 55436482**: Link branding - customizes links in emails
2. **em6324**: Email sending subdomain
3. **s1.\_domainkey & s2.\_domainkey**: DKIM authentication - proves emails are from your domain
4. **\_dmarc**: DMARC policy - tells receiving servers how to handle unauthenticated emails

## How to Add Records

### For UTIA DNS Administrator:

1. **Access DNS Management**:
   - Log into UTIA DNS management system
   - Navigate to spherosegapp.utia.cas.cz zone

2. **Add CNAME Records**:

   ```bash
   # Example for BIND/named:
   url4698.spherosegapp.utia.cas.cz.    IN CNAME sendgrid.net.
   55436482.spherosegapp.utia.cas.cz.   IN CNAME sendgrid.net.
   em6324.spherosegapp.utia.cas.cz.     IN CNAME u55436482.wl233.sendgrid.net.
   s1._domainkey.spherosegapp.utia.cas.cz. IN CNAME s1.domainkey.u55436482.wl233.sendgrid.net.
   s2._domainkey.spherosegapp.utia.cas.cz. IN CNAME s2.domainkey.u55436482.wl233.sendgrid.net.
   ```

3. **Add TXT Record**:

   ```bash
   _dmarc.spherosegapp.utia.cas.cz. IN TXT "v=DMARC1; p=none;"
   ```

4. **Apply Changes**:
   - Save the zone file
   - Reload DNS service
   - Wait for propagation (1-2 hours)

## Verification

### Check DNS Propagation:

```bash
# Check CNAME records
dig url4698.spherosegapp.utia.cas.cz CNAME
dig em6324.spherosegapp.utia.cas.cz CNAME
dig s1._domainkey.spherosegapp.utia.cas.cz CNAME
dig s2._domainkey.spherosegapp.utia.cas.cz CNAME

# Check TXT record
dig _dmarc.spherosegapp.utia.cas.cz TXT

# Or use nslookup
nslookup -type=CNAME url4698.spherosegapp.utia.cas.cz
nslookup -type=TXT _dmarc.spherosegapp.utia.cas.cz
```

### Verify in SendGrid:

1. Go to https://app.sendgrid.com/settings/sender_auth
2. Find your domain (spherosegapp.utia.cas.cz)
3. Click "Verify"
4. All records should show green checkmarks

## Troubleshooting

### Records Not Propagating:

- Wait 1-2 hours for full DNS propagation
- Check TTL settings (lower TTL = faster updates)
- Clear DNS cache: `sudo systemd-resolve --flush-caches`

### Verification Failing:

- Ensure no typos in DNS records
- Check for trailing dots in BIND format
- Verify records with: `dig @8.8.8.8 [hostname] [type]`

### SendGrid Not Detecting:

- Records may take up to 48 hours to verify
- Try "Verify" button multiple times
- Contact SendGrid support if issues persist

## Benefits After Verification

✅ **Improved Deliverability**: Emails less likely to go to spam
✅ **Custom Domain Links**: Links in emails use your domain
✅ **DKIM Signing**: Cryptographic proof emails are from you
✅ **DMARC Policy**: Control how receivers handle your emails
✅ **Higher Reputation**: Better sender reputation with ISPs

## Security Notes

- These records are safe to add and won't affect existing services
- DMARC policy is set to "none" (monitoring only)
- Can be upgraded to "quarantine" or "reject" later
- Keep SendGrid account secure with 2FA

## Support

- **SendGrid Dashboard**: https://app.sendgrid.com
- **SendGrid Support**: https://support.sendgrid.com
- **DNS Issues**: Contact UTIA IT administrator
- **Recovery Code**: See `.sendgrid-recovery` file

## Current Status

- [ ] DNS records added to zone file
- [ ] DNS service reloaded
- [ ] Records propagated (check with dig)
- [ ] SendGrid verification completed
- [ ] Test email sent successfully

---

_Created: 2025-08-23_
_Domain: spherosegapp.utia.cas.cz_
_SendGrid Account ID: u55436482_
