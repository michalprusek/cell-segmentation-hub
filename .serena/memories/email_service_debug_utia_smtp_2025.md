# Email Service Debug and UTIA SMTP Configuration - 2025-09-10

## Root Cause Analysis and Resolution

### Primary Issue: Backend Container Unhealthy Status

- **Problem**: Backend container was failing with "unhealthy" status for 2 days
- **Root Cause**: ES module import error in `/backend/src/db/index.ts`

  ```typescript
  // INCORRECT (missing .js extension)
  import { getPrismaConfig } from './prismaConfig';

  // CORRECT (ES modules require explicit .js extension)
  import { getPrismaConfig } from './prismaConfig.js';
  ```

- **Fix Applied**: Added `.js` extension to import statement
- **Result**: Backend now starts successfully and reports "healthy" status

### Secondary Issue: Email Configuration for UTIA SMTP

#### Current Email Service Implementation

- **Location**: `/backend/src/services/emailService.ts`
- **Features**:
  - SMTP and SendGrid support
  - SSL/TLS configuration
  - Optional authentication (SMTP_AUTH environment variable)
  - Retry logic with exponential backoff
  - Timeout configuration
  - Debug logging support
- **Initialization**: Properly integrated in server startup sequence (lines 272-280 in server.ts)

#### Database Schema Support

- **User Table**: email, emailVerified, verificationToken, resetToken, resetTokenExpiry
- **Profile Table**: emailNotifications preference
- **ProjectShare Table**: email field for email invitations
- **Email Templates**: Password reset, verification, project sharing

#### UTIA SMTP Configuration Created

File: `.env.utia`

```bash
# UTIA SMTP Configuration
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=prusek@utia.cas.cz
SMTP_PASS=M1i2c3h4a5l6
SMTP_AUTH=true
SMTP_REQUIRE_TLS=true
SMTP_IGNORE_TLS=false
FROM_EMAIL=spheroseg@utia.cas.cz
FROM_NAME=SpheroSeg Platform

# Timeouts optimized for UTIA SMTP
EMAIL_TIMEOUT=30000
SMTP_CONNECTION_TIMEOUT_MS=30000
SMTP_GREETING_TIMEOUT_MS=30000
SMTP_SOCKET_TIMEOUT_MS=30000

# Debug settings enabled
SMTP_DEBUG=true
EMAIL_DEBUG=true
```

## Implementation Details

### Email Service Features

1. **Transport Configuration**: Nodemailer with full SSL/TLS support
2. **Authentication**: Optional (configurable with SMTP_AUTH environment variable)
3. **Security**: TLS 1.2+, certificate validation, secure ciphers
4. **Retry Logic**: Exponential backoff for transient failures
5. **Templates**: HTML and text versions for all email types
6. **Internationalization**: Support for 6 languages (EN, CS, ES, DE, FR, ZH)

### Test Endpoints Available

- `GET /api/test-email/test-connection` - Test SMTP connection
- `POST /api/test-email/send-test` - Send test email
- Both endpoints require authentication

### Usage Instructions

1. **Switch to UTIA configuration**:

   ```bash
   docker compose stop backend
   ENV_FILE=.env.utia docker compose up -d backend
   ```

2. **Test email connection** (requires authentication):

   ```bash
   curl -X GET "http://localhost:3001/api/test-email/test-connection" \
        -H "Authorization: Bearer <valid-jwt-token>"
   ```

3. **Revert to MailHog** (development):
   ```bash
   docker compose stop backend
   ENV_FILE=.env.development docker compose up -d backend
   ```

## Key Configuration Options

### SMTP Security Settings

- `SMTP_SECURE=true` - Use SSL (port 465)
- `SMTP_REQUIRE_TLS=true` - Require TLS encryption
- `SMTP_IGNORE_TLS=false` - Don't ignore TLS errors
- `EMAIL_ALLOW_INSECURE=false` - Reject invalid certificates

### Authentication

- `SMTP_AUTH=true` - Enable SMTP authentication
- `SMTP_AUTH=false` - Disable authentication (for servers that don't require it)

### Debugging

- `SMTP_DEBUG=true` - Enable SMTP protocol debugging
- `EMAIL_DEBUG=true` - Enable email service debugging
- `SKIP_EMAIL_SEND=true` - Skip actual email sending (testing)

## Status

- ✅ Backend unhealthy status resolved
- ✅ Email service properly configured and initialized
- ✅ UTIA SMTP configuration created
- ✅ Backend container healthy and running
- ⚠️ Email connection testing requires authentication setup

## Next Steps for Full Email Testing

1. Create admin user or get valid JWT token
2. Test SMTP connection using authenticated endpoint
3. Send test email to verify UTIA SMTP connectivity
4. Monitor logs for any SSL/TLS connection issues

## Files Modified/Created

- Fixed: `/backend/src/db/index.ts` (import statement)
- Created: `.env.utia` (UTIA email configuration)
