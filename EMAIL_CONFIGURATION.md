# Email Configuration Documentation

## Current Status

Email functionality supports **TWO MODES**:

- **Development/Testing**: MailHog (captures emails locally)
- **Production**: SendGrid (sends real emails)

## Configuration

### Production (Blue Environment)

- **Service**: MailHog (email capture for testing)
- **SMTP Host**: mailhog-blue
- **SMTP Port**: 1025
- **Security**: None (internal network only)
- **Web UI**: http://localhost:8025

### Email Flow

1. Application sends emails to MailHog SMTP server (port 1025)
2. MailHog captures all emails without sending them externally
3. Emails can be viewed in MailHog web interface
4. Perfect for testing without spamming real email addresses

## Access MailHog Interface

### Local Access

```bash
# Open MailHog web interface
open http://localhost:8025

# Or use SSH tunnel from remote machine
ssh -L 8025:localhost:8025 cvat@spherosegapp.utia.cas.cz
```

### API Access

```bash
# Get all messages
curl http://localhost:8025/api/v2/messages

# Delete all messages
curl -X DELETE http://localhost:8025/api/v1/messages
```

## Testing Email

### Via Application

1. Share a project by email
2. Request password reset
3. Any action that triggers email

### Direct SMTP Test

```bash
printf 'EHLO localhost\r\nMAIL FROM:<test@test.com>\r\nRCPT TO:<user@example.com>\r\nDATA\r\nSubject: Test\r\n\r\nTest message\r\n.\r\nQUIT\r\n' | nc localhost 1025
```

## Environment Variables

```env
EMAIL_SERVICE=smtp
SMTP_HOST=mailhog-blue
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_AUTH=false
FROM_EMAIL=spheroseg@utia.cas.cz
FRONTEND_URL=https://spherosegapp.utia.cas.cz
```

## Docker Services

```yaml
mailhog-blue:
  image: mailhog/mailhog:latest
  container_name: mailhog-blue
  ports:
    - '8025:8025' # Web UI
    - '1025:1025' # SMTP server
  networks:
    - blue-network
```

## SendGrid Setup (Production)

### Quick Setup

```bash
# 1. Run setup script
./scripts/setup-sendgrid.sh

# 2. Enter your SendGrid API key when prompted
# 3. Verify sender email at SendGrid dashboard
```

### Manual Setup

1. **Get SendGrid API Key**:
   - Sign up at https://sendgrid.com
   - Enable Two-Factor Authentication (required)
   - Go to Settings → API Keys → Create API Key
   - Copy the key (shown only once!)

2. **Configure Environment**:

   ```bash
   # Edit .env.sendgrid
   SENDGRID_API_KEY=SG.your_actual_key_here
   EMAIL_SERVICE=sendgrid
   FROM_EMAIL=spheroseg@utia.cas.cz
   ```

3. **Verify Sender**:
   - Go to https://app.sendgrid.com/settings/sender_auth
   - Either verify single email or entire domain
   - Wait for verification confirmation

4. **Test Configuration**:
   ```bash
   ./scripts/test-sendgrid.sh
   ```

### Switching Between Services

```bash
# Use the switcher script
./scripts/switch-email-service.sh

# Option 1: MailHog (development)
# Option 2: SendGrid (production)
```

## Troubleshooting

### SendGrid Issues

1. **401 Unauthorized**: Invalid API key
   - Check key format (starts with `SG.`, 69 chars)
   - Regenerate key if needed

2. **403 Forbidden**: Sender not verified
   - Verify email at: https://app.sendgrid.com/settings/sender_auth
   - Wait for DNS propagation if verifying domain

3. **429 Too Many Requests**: Rate limit exceeded
   - Free tier: 100 emails/day limit
   - Wait or upgrade plan

### Emails not appearing in MailHog

1. Check if MailHog is running: `docker ps | grep mailhog`
2. Restart MailHog: `docker restart mailhog-blue`
3. Check backend logs: `docker logs blue-backend --tail=50`

### Connection refused

- Ensure MailHog container is in same network as backend
- Check firewall rules for port 1025

### Backend can't send emails

- Verify environment variables are set correctly
- Restart backend after configuration changes
- Check `FRONTEND_URL` is set (required for email links)

## Security Notes

- MailHog is for development/testing only
- Do not expose MailHog ports to public internet
- For production, use proper email service with authentication

## Migration to Production Email

When ready to use real email service:

1. Choose email provider (SendGrid recommended)
2. Update docker-compose.yml environment variables
3. Set appropriate API keys/credentials
4. Test with small group first
5. Monitor delivery rates and bounces

## Related Files

- `/docker-compose.blue.yml` - Blue environment configuration
- `/backend/src/services/emailService.ts` - Email service implementation
- `/backend/src/templates/` - Email templates

## Support

For issues with email configuration, check:

1. This documentation
2. Backend logs: `docker logs blue-backend`
3. MailHog interface: http://localhost:8025
4. Contact system administrator for UTIA SMTP access
