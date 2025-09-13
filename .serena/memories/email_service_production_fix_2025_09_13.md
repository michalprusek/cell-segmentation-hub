# Email Service Production Fix - Configuration and Queue Processing

## Date: 2025-09-13

## Problem Summary

Email service was not sending emails in production environment, specifically password reset emails. Tests showed emails worked when sent directly but failed through the application's queue system.

## Root Causes Identified

### 1. Configuration Issues

- **SMTP_AUTH was incorrectly set to true** - UTIA server doesn't require authentication from internal network
- **FROM_EMAIL was set to prusek@utia.cas.cz** instead of spheroseg@utia.cas.cz
- **Timeouts were too short** - Only 60-90 seconds when UTIA server needs 300-600 seconds

### 2. Queue Processing Issues

- **Environment variable modification at runtime** in processEmailQueue() causing conflicts
- **Insufficient error logging** in queue processing making debugging difficult
- **Timeout handling** not properly configured for UTIA's slow response times

## Solution Implemented

### 1. Fixed Configuration (.env file)

```bash
# Corrected SMTP Settings
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH=false  # Fixed: Changed from true
FROM_EMAIL=spheroseg@utia.cas.cz  # Fixed: Changed from prusek@
FROM_NAME=Cell Segmentation Platform

# Extended Timeouts for UTIA
EMAIL_TIMEOUT=300000  # 5 minutes (was 60 seconds)
SMTP_SOCKET_TIMEOUT_MS=300000  # 5 minutes (was 60 seconds)
EMAIL_GLOBAL_TIMEOUT=600000  # 10 minutes (was 90 seconds)

# Optimized Retry Settings
EMAIL_MAX_RETRIES=3
EMAIL_RETRY_INITIAL_DELAY=5000
EMAIL_RETRY_MAX_DELAY=30000
```

### 2. Improved Queue Processing (emailRetryService.ts)

- **Removed environment variable modification** - Now uses config objects instead
- **Added detailed error logging** with stack traces and context
- **Improved timeout configuration** passed directly to sendEmail()
- **Better retry logic** with exponential backoff

### 3. Database Migration Applied

- Applied pending migrations to fix segmentation_queue table
- Ensured all schema updates are current

## Testing Results

### Direct SMTP Test

```bash
✅ SMTP connection verified successfully
✅ Email sent successfully!
Message ID: <35102ced-a40c-2302-ad4b-429c33f9debe@utia.cas.cz>
Response: 250 Mail queued for delivery
```

### Password Reset API

```bash
POST /api/auth/request-password-reset
Response: 200 OK
{"success":true,"message":"Password reset email sent"}
```

## Key Technical Details

### UTIA SMTP Server Behavior

- **Connection**: Fast (<1 second)
- **Authentication**: Not required from internal network
- **Data Transfer**: Fast
- **Response Time**: SLOW (2-4 minutes after DATA command)
- **Reliability**: High when configured correctly

### Queue Processing Architecture

1. Emails automatically queued for UTIA server
2. Background processing with 5-minute timeouts
3. Exponential backoff retry (up to 5 attempts)
4. Fire-and-forget pattern prevents API blocking

## Monitoring and Verification

### Health Check

```bash
curl http://localhost:3001/api/health | jq '.data.emailService'
# Should show: "operational": true
```

### Backend Logs

```bash
docker logs spheroseg-backend --tail 50 | grep -E "Email|SMTP"
# Look for: "Email service connection test successful"
```

### Test Email Send

```bash
curl -X POST http://localhost:3001/api/auth/request-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

## Files Modified

1. `/home/cvat/cell-segmentation-hub/.env` - Fixed configuration
2. `/home/cvat/cell-segmentation-hub/backend/src/services/emailRetryService.ts` - Improved queue processing

## Deployment Steps

1. Update .env file with correct configuration
2. Restart backend container: `docker restart spheroseg-backend`
3. Apply database migrations: `docker exec spheroseg-backend npx prisma migrate deploy`
4. Verify email service is operational

## Prevention Measures

1. **Configuration Management**: Always verify SMTP settings match server requirements
2. **Timeout Configuration**: Use extended timeouts for slow SMTP servers
3. **Error Logging**: Implement comprehensive logging in queue systems
4. **Testing**: Test full email flow including queue processing, not just direct sending
5. **Documentation**: Keep SMTP server behavior documented

## Critical Success Factors

- ✅ SMTP_AUTH=false for UTIA internal network
- ✅ FROM_EMAIL matches server expectations (spheroseg@utia.cas.cz)
- ✅ Timeouts extended to 5-10 minutes for UTIA delays
- ✅ Queue processing doesn't modify environment variables
- ✅ Comprehensive error logging enabled

## Future Improvements

1. Add email delivery status tracking in database
2. Implement webhook for email status updates
3. Create admin dashboard for email queue monitoring
4. Consider fallback email provider for redundancy
5. Add metrics for email delivery success rates
