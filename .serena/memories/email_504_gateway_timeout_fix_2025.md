# Cell Segmentation Hub - 504 Gateway Timeout Email Fix

## Problem Description

Users experienced 504 Gateway Timeout errors when requesting password reset on https://spherosegapp.utia.cas.cz. The frontend showed infinite loading animation and after ~60 seconds returned 504 error.

## Root Cause Analysis

### Primary Issue: Timeout Cascade

1. **SMTP Server**: mail.utia.cas.cz takes 30-45+ seconds to respond
2. **Backend Email Service**: Configured with 3 retries × 30s timeout = ~97 seconds total
3. **Nginx Proxy**: Had 60-second timeout (default) for /api/ routes
4. **Result**: Nginx returned 504 before email service completed

### Secondary Issues

- Synchronous email sending blocked HTTP request
- No async processing pattern for emails
- Inconsistent timeout configurations across services

## Solution Implemented

### 1. Nginx Configuration Fix

**Files Modified**:

- `/docker/nginx/nginx.ssl.conf` (production)
- `/docker/nginx/nginx.blue.conf` (blue deployment)

**Changes**:

```nginx
location /api/ {
    proxy_connect_timeout 60s;
    proxy_send_timeout 120s;   # Increased from default 60s
    proxy_read_timeout 120s;   # Increased from default 60s
}
```

### 2. Fire-and-Forget Email Pattern

**File**: `/backend/src/services/authService.ts`

**Key Change**: Removed `await` from email sending:

```typescript
// Before (blocking):
await EmailService.sendPasswordResetEmail(email, token, expiry);

// After (fire-and-forget):
EmailService.sendPasswordResetEmail(email, token, expiry)
  .then(() => logger.info('Email sent'))
  .catch(err => logger.error('Email failed'));
```

### 3. Email Service Optimization

**Files**:

- `/backend/src/services/emailService.ts`
- `/backend/src/services/emailRetryService.ts`

**Improvements**:

- Added global 45-second timeout protection
- Implemented background email queue for timeouts
- Optimized retry configuration (2 retries instead of 3)
- Fixed TLS configuration conflict (removed `secureProtocol`)

### 4. Environment Configuration

**File**: `.env.blue.production`

**SMTP Settings for UTIA**:

```bash
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
EMAIL_TIMEOUT=45000
SMTP_CONNECTION_TIMEOUT_MS=30000
```

## Results

- **Before**: 504 error after 60 seconds, no email sent
- **After**: Response in 0.266 seconds, email sent in background

## Testing Commands

```bash
# Test password reset
curl -X POST http://localhost:4001/api/auth/request-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# Check logs
docker logs blue-backend --tail 50 | grep "Password reset"
```

## Deployment

```bash
# Rebuild and restart backend
export DB_PASSWORD=spheroseg_blue_2024
docker-compose -f docker-compose.blue.yml build blue-backend
docker-compose -f docker-compose.blue.yml restart blue-backend

# Restart nginx
docker restart nginx-main nginx-blue
```

## Key Learnings

1. Always check proxy timeout settings when backend operations are slow
2. Use fire-and-forget pattern for non-critical async operations
3. SMTP servers can have very long response times (30-60+ seconds)
4. Don't mix `minVersion` and `secureProtocol` in TLS config (causes conflicts)

## Monitoring

Watch for these log messages:

- `Password reset email queued for sending` - Immediate response
- `Password reset email sent successfully` - Background success
- `Email send timeout, queuing for background retry` - Timeout handling

## Future Improvements

Consider implementing:

1. Proper job queue (Bull/BullMQ) for email processing
2. Email status tracking in database
3. Webhook for email delivery confirmation
4. Alternative email service (SendGrid/SES) for better reliability
