# Complete Password Reset Flow Fix - Cell Segmentation Hub

## Date: 2025-09-10

## Problem Summary

Password reset emails were not being delivered to users, and when manually sent, the reset link led to a 404 error page.

## Root Causes Identified

### 1. Email Delivery Issues

- **Complex HTML templates** causing UTIA SMTP server to hang
- **Queue processing stuck** due to template complexity
- **No actual email sending** despite queue processing logs

### 2. Frontend Issues

- **Missing `/reset-password` route** - page didn't exist
- **No ResetPassword component** to handle password reset tokens

### 3. UTIA SMTP Behavior

- Server takes 2-4 minutes to process emails
- Complex HTML with inline styles causes indefinite hangs
- Simple HTML works immediately

## Complete Solution Implemented

### 1. Created ResetPassword Page

**File**: `/src/pages/ResetPassword.tsx`

```tsx
// Complete password reset component with:
- Token validation from URL parameters
- Password reset form with confirmation
- Success/error/invalid token states
- Password visibility toggles
- Proper loading states
- Redirect to sign-in after success
```

### 2. Added Route Configuration

**File**: `/src/App.tsx`

```tsx
const ResetPassword = createLazyComponent(
  () => import('./pages/ResetPassword'),
  'ResetPassword'
);

<Route
  path="/reset-password"
  element={
    <Suspense fallback={<PageLoadingFallback type="form" />}>
      <ResetPassword />
    </Suspense>
  }
/>;
```

### 3. Simplified Email Templates

**File**: `/backend/src/templates/passwordResetEmail.ts`

**Before** (200+ lines, complex HTML):

- Gradients, animations, complex CSS
- Multiple nested divs with inline styles
- CSS transforms and transitions

**After** (30 lines, simple HTML):

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Password Reset Request</h2>
  <p>Reset link: <a href="${resetUrl}">Reset Password</a></p>
  <p>Link expires in 1 hour</p>
</div>
```

### 4. Fixed Email Service Queue Processing

**File**: `/backend/src/services/emailRetryService.ts`

- Proper queue processing with setImmediate
- Extended timeouts for UTIA (300 seconds)
- Better error handling and logging

### 5. Added Translation Keys

**File**: `/src/translations/en.ts`

```javascript
enterNewPassword: 'Enter your new password';
newPassword: 'New Password';
confirmPassword: 'Confirm Password';
passwordRequirements: 'Password must be at least 8 characters';
passwordResetSuccess: 'Password Reset Successful';
invalidResetToken: 'Invalid Reset Link';
```

## Working Email Configuration

### SMTP Settings (Production)

```bash
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false  # Important: false for simple connection
SMTP_AUTH=false         # No authentication needed
EMAIL_FROM=spheroseg@utia.cas.cz
EMAIL_TIMEOUT=300000    # 5 minutes for UTIA
```

### Direct Email Test Script

**File**: `/backend/fix-password-reset.cjs`

- Bypasses queue for immediate sending
- Generates fresh reset token
- Updates database directly
- Sends simple HTML email

## User Flow

1. **Request Reset**: User visits `/forgot-password`, enters email
2. **Email Sent**: Simple HTML email with reset link sent via UTIA
3. **Click Link**: User clicks link → `/reset-password?token=xxx`
4. **Reset Password**: Enter new password, confirm, submit
5. **Success**: Password updated, redirect to sign-in

## Testing Results

### Email Delivery

- ✅ Test email delivered in 0.2 seconds
- ✅ Password reset email delivered successfully
- ✅ Message ID: <96d001bd-adfb-407a-0d1c-e36546eda8ba@utia.cas.cz>
- ✅ SMTP Response: 250 Mail queued for delivery

### Frontend

- ✅ `/reset-password` route working
- ✅ Token validation functional
- ✅ Password reset form operational
- ✅ Success/error states working

## Key Learnings

### UTIA SMTP Server

1. **Simplicity is key** - Complex HTML causes hangs
2. **No TLS required** - Works better without requireTLS
3. **No auth needed** - SMTP_AUTH=false for internal network
4. **Extended timeouts** - 5 minutes minimum for reliability

### Email Templates

1. **Avoid complex CSS** - No gradients, animations, transforms
2. **Minimal inline styles** - Only basic formatting
3. **Simple structure** - Single container, basic elements
4. **Plain text fallback** - Always include text version

### Queue Processing

1. **Use setImmediate** for proper async handling
2. **Extended timeouts** for slow SMTP servers
3. **Proper error logging** to diagnose issues
4. **Fallback mechanisms** for failed sends

## Monitoring Commands

```bash
# Trigger password reset
curl -X POST http://localhost:4001/api/auth/request-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# Check email logs
docker logs blue-backend --tail 100 | grep -E "Email|Password"

# Direct email test
docker exec blue-backend node fix-password-reset.cjs
```

## Files Modified

1. `/src/pages/ResetPassword.tsx` - NEW password reset page
2. `/src/App.tsx` - Added route configuration
3. `/backend/src/templates/passwordResetEmail.ts` - Simplified template
4. `/backend/src/services/emailRetryService.ts` - Fixed queue processing
5. `/src/translations/*.ts` - Added translation keys

## Prevention Measures

1. **Always test with production SMTP** during development
2. **Keep email templates simple** for compatibility
3. **Test complete user flow** including frontend routes
4. **Monitor email queue** for stuck messages
5. **Use direct send scripts** for debugging

## Critical Success Factors

- ✅ Simple HTML templates for UTIA SMTP
- ✅ Complete frontend route implementation
- ✅ Proper token validation and expiry
- ✅ Extended timeouts for slow SMTP
- ✅ User-friendly error handling
