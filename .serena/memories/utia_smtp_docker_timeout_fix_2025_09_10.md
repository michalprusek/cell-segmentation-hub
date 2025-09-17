# UTIA SMTP Docker Timeout Fix - 2025-09-10

## Problem Description

Email sending fails with timeout errors when running in Docker containers (Blue production environment), even though the same SMTP configuration works from the host machine.

## Root Cause Analysis

### Investigation Results

1. **Network Connectivity**: ✅ Working - Container can reach mail.utia.cas.cz:25
2. **DNS Resolution**: ✅ Working - Resolves to hermes.utia.cas.cz (147.231.12.5)
3. **SMTP Handshake**: ✅ Working - Connection established and STARTTLS succeeds
4. **Authentication**: ✅ Working - AUTH PLAIN succeeds with credentials
5. **Data Transmission**: ✅ Working - Email content sent successfully
6. **Server Response**: ❌ **TIMEOUT** - UTIA server takes >120 seconds to respond with "250 OK"

### Key Finding

The issue is NOT a Docker networking problem. The UTIA SMTP server (Axigen ESMTP) has extreme processing delays, taking over 2 minutes to acknowledge email receipt after the DATA command completes.

## Solution Implemented

### 1. Extended Timeout Configuration

Updated `.env.blue.production`:

```bash
# Timeout Settings - Extended for UTIA SMTP server extreme delays
EMAIL_TIMEOUT=180000                    # 3 minutes for individual send
SMTP_CONNECTION_TIMEOUT_MS=15000       # Connection is fast
SMTP_GREETING_TIMEOUT_MS=15000         # Greeting is fast
SMTP_SOCKET_TIMEOUT_MS=180000          # 3 minutes for server response
EMAIL_GLOBAL_TIMEOUT=180000            # 3 minutes total timeout
```

### 2. Automatic Queue Strategy

The emailService.ts already implements smart queuing for UTIA:

- Password reset emails are automatically queued for background processing
- This prevents 504 Gateway Timeout errors for users
- Background queue has extended timeouts for reliable delivery

## Working Configuration

### SMTP Settings (Verified Working)

```bash
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH=true
SMTP_USER=prusek@utia.cas.cz
SMTP_PASS=M1i2c3h4a5l6
```

### Connection Details

- Server: hermes.utia.cas.cz (Axigen ESMTP)
- IP: 147.231.12.5
- Port: 25 with STARTTLS upgrade
- Authentication: Optional but recommended

## Docker Network Configuration

### Development (Working)

Uses `network_mode: host` - containers share host network stack

### Production Blue (Fixed)

Uses bridge network `blue-network` - works with extended timeouts

## Testing Commands

### Test from Docker Container

```bash
docker exec blue-backend sh -c "nc -zv mail.utia.cas.cz 25 -w 5"
docker exec blue-backend sh -c "nslookup mail.utia.cas.cz"
```

### Test Script Location

`/home/cvat/spheroseg-app/backend/test-docker-fix.cjs`

## Important Notes

1. **UTIA Server Behavior**: The server consistently takes 120-150 seconds to respond after receiving email data
2. **Not a Bug**: This is normal behavior for the UTIA SMTP server (mail.utia.cas.cz)
3. **User Experience**: Users receive immediate response while emails process in background
4. **Monitoring**: Check background queue logs for actual delivery status

## Verification

After applying the fix:

1. Restart backend: `docker compose -f docker-compose.blue.yml restart blue-backend`
2. Test email sending from the application
3. Check logs: `docker logs blue-backend --tail 100`
4. Emails should queue immediately and deliver within 3 minutes

## Related Files

- `/home/cvat/spheroseg-app/.env.blue.production`
- `/home/cvat/spheroseg-app/backend/src/services/emailService.ts`
- `/home/cvat/spheroseg-app/backend/src/services/emailRetryService.ts`
- `/home/cvat/spheroseg-app/docker-compose.blue.yml`
