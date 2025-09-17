# Email Service Simplification for UTIA SMTP Compatibility

## Problem

UTIA SMTP server (mail.utia.cas.cz) silently fails when processing complex HTML email templates, accepting the email but never delivering it. This specifically affects password reset emails.

## Root Cause

- UTIA's mail server hangs on complex HTML with extensive inline styles
- The server accepts emails (returns success) but never processes them
- Fire-and-forget pattern hides these failures from users

## Solution

Created simplified email templates with minimal HTML structure that UTIA can process:

### 1. Simple Password Reset Template

```typescript
// File: /backend/src/templates/passwordResetEmailSimple.ts
export const generateSimplePasswordResetHTML = (
  data: PasswordResetEmailData
): string => {
  // ULTRA-SIMPLE HTML - proven to work with UTIA SMTP
  return `<html>
<body>
<h2>Reset hesla - Cell Segmentation Platform</h2>
<p>Dobrý den,</p>
<p>Byla vyžádána změna hesla pro účet: ${safeUserEmail}</p>
<p><a href="${safeResetUrl}">Klikněte zde pro reset hesla</a></p>
<p>Nebo zkopírujte tento odkaz:<br>${safeResetUrl}</p>
<p><strong>Platnost do: ${expirationTime}</strong></p>
<p>Pokud jste si reset nevyžádali, ignorujte tento email.</p>
<p>---<br>Cell Segmentation Platform</p>
</body>
</html>`;
};
```

### 2. Reliable Email Service Design

```typescript
// Synchronous sending for immediate feedback
// No queue for critical emails like password reset
// Simple templates that work with UTIA
// Proper error handling and user feedback
```

## Key Configuration for UTIA

```bash
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH=false  # No auth required from internal network
FROM_EMAIL=spheroseg@utia.cas.cz

# Extended timeouts for UTIA's slow processing
EMAIL_TIMEOUT=300000  # 5 minutes
SMTP_SOCKET_TIMEOUT_MS=300000  # 5 minutes
EMAIL_GLOBAL_TIMEOUT=600000  # 10 minutes
```

## Testing

Test emails work because they use simple templates. Password reset emails fail with complex templates but succeed with simplified versions.

## Implementation Status

- Created simplified templates
- Designed reliable email service with synchronous sending
- Modified authService to use new reliable service
- Issue: NodeMailer import complications in TypeScript ES module environment

## Alternative Quick Fix

Modify existing emailService.ts to use simplified templates for password reset instead of complex ones. This avoids import issues while solving the delivery problem.
