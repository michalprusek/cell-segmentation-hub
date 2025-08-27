# Email Service Configuration Session - 2025-08-27

## Session Summary

Fixed production site (spherosegapp.utia.cas.cz) that was showing ERR_CONNECTION_REFUSED and attempted to configure UTIA SMTP email service for password reset functionality.

## Key Accomplishments

### 1. Production Site Restoration

- **Issue**: Site was down with ERR_CONNECTION_REFUSED
- **Root Cause**: nginx.prod.conf was routing to non-existent blue-backend containers
- **Solution**: Updated nginx configuration to route to green containers
- **Status**: ✅ Site fully operational

### 2. Database Issues Fixed

- **Issue**: Green backend couldn't connect to PostgreSQL
- **Solution**: Set proper DB_PASSWORD environment variable
- **Additional**: Ran missing database migration for detectHoles column
- **Status**: ✅ Database fully functional

### 3. Project Sharing Fixed

- **Issue**: Shared projects not visible to prusemic@cvut.cz
- **Solution**: Manually updated database to accept share (set accepted=true, added sharedWithId)
- **Status**: ✅ Users can now access and segment images in shared projects

### 4. Password Reset Workaround

- **Issue**: Email service not working for password resets
- **Workaround**: Manually reset password for prusemic@cvut.cz to "password123"
- **Status**: ✅ User can log in without email functionality

## Email Service Configuration Attempts

### SMTP Credentials Provided

- Host: mail.utia.cas.cz
- User: prusek@utia.cas.cz
- Password: M1i2c3h4a5l6

### Configuration Attempts

1. **Port 25 + STARTTLS**: Timeout after 60s during authentication
2. **Port 25 without TLS**: Server refuses AUTH without encryption
3. **Port 465 + SSL**: SSL handshake hangs indefinitely
4. **Port 587 + STARTTLS**: Port not accessible from server

### Technical Findings

- Port 25: Open, responds with "220 SMTPD UTIA" but closes after AUTH LOGIN
- Port 465: Accepts connection but SSL negotiation fails
- Port 587: Not reachable (connection timeout)
- STARTTLS verification successful with openssl on port 25

### Code Changes Made

- Updated emailService.ts with 60-second timeouts (was 30s)
- Added debug logging to nodemailer configuration
- Set EMAIL_ALLOW_INSECURE=true for certificate issues
- Rebuilt backend Docker image multiple times

## Current Environment Configuration

### docker-compose.green.yml (current)

```yaml
- SMTP_HOST=mail.utia.cas.cz
- SMTP_PORT=465
- SMTP_SECURE=true
- SMTP_AUTH=true
- SMTP_REQUIRE_TLS=false
- SMTP_USER=prusek@utia.cas.cz
- SMTP_PASS=M1i2c3h4a5l6
- SKIP_EMAIL_SEND=false
- EMAIL_ALLOW_INSECURE=true
- EMAIL_TIMEOUT=30000
```

### Active Services

- nginx-green: Routing production traffic
- green-backend: Port 5001, healthy
- green-frontend: Port 5000, serving UI
- green-ml: Port 5008, ML service
- postgres-green: Database with spheroseg_green
- redis-green: Cache service

## Unresolved Issues

### Email Service

- **Status**: ❌ Not functional
- **Impact**: Password reset emails don't send
- **Workaround**: Manual password resets via database
- **Next Steps**:
  1. Contact UTIA IT for correct SMTP settings
  2. Check firewall/IP whitelisting requirements
  3. Consider alternative email provider (SendGrid, AWS SES)

## Important Files Modified

1. `/docker/nginx/nginx.prod.conf` - Changed upstream from blue to green services
2. `/docker-compose.green.yml` - Updated SMTP configuration multiple times
3. `/backend/src/services/emailService.ts` - Increased timeouts, added debug logging
4. `/.env.green` - Added SMTP credentials

## Database Commands Used

```sql
-- Accept project share
UPDATE "ProjectShare"
SET accepted = true,
    sharedWithId = '6da17190-4a23-47e6-beed-c4f29a4701e6'
WHERE shareToken = '3306dca3-4d91-4bc8-8155-cabf570d63ed';

-- Reset password
UPDATE "User"
SET password = '$2a$10$VZq6rV6zikJp2rBH0yQmReEzxJFnVPBHoGMFZv8GVEGvzqN0jTwXu'
WHERE email = 'prusemic@cvut.cz';
```

## Lessons Learned

1. Always check nginx upstream configuration when containers change
2. SMTP servers may have specific authentication requirements not obvious from port scanning
3. Docker environment variables need explicit export for docker-compose
4. Backend rebuilds may use cached layers - use --no-cache when code changes aren't reflected
5. UTIA SMTP server has non-standard configuration that doesn't work with typical nodemailer setup
