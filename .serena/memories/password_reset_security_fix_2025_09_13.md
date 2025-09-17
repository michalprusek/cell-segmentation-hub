# Password Reset Security Vulnerability Fix

**Date**: September 13, 2024
**Issue**: Critical security vulnerability in password reset token validation

## Problem Description

The password reset functionality had a critical security vulnerability where the system would return ANY user with a valid (non-expired) reset token instead of the specific user whose token matched the provided one.

### Original Broken Code (authService.ts lines 431-440)

```typescript
// VULNERABLE CODE - DO NOT USE
const user = await prisma.user.findFirst({
  where: {
    resetTokenExpiry: { gte: new Date() },
    resetToken: { not: null },
  },
});
```

This query finds ANY user with a non-expired token, not the specific user whose token matches!

## Root Cause

Password reset tokens are hashed using bcrypt before storage in the database. Since we cannot reverse the hash to query directly, we need to:

1. Find all users with valid tokens
2. Iterate through them
3. Compare each hashed token with the provided token

## Solution Implemented

### Fixed Code (authService.ts lines 432-454)

```typescript
// Find ALL users with non-expired reset tokens
// We need to iterate because tokens are hashed and we can't query directly
const usersWithTokens = await prisma.user.findMany({
  where: {
    resetTokenExpiry: { gte: new Date() },
    resetToken: { not: null },
  },
});

// Find the user whose hashed token matches the provided token
let matchedUser = null;
for (const user of usersWithTokens) {
  if (user.resetToken) {
    const isTokenValid = await verifyPassword(data.token, user.resetToken);
    if (isTokenValid) {
      matchedUser = user;
      break;
    }
  }
}

if (!matchedUser) {
  throw ApiError.badRequest('Neplatný nebo vypršený reset token');
}
```

## Additional Fixes

1. **TypeScript Compilation Error**: Fixed `createTransporter` → `createTransport` in reliableEmailService.ts
2. **Translations**: Added complete password reset translations for all 6 languages (EN, CS, ES, DE, FR, ZH)

## Security Impact

**Before**: Any user with a valid token could potentially reset any other user's password
**After**: Only the user with the exact matching token can reset their password

## Testing

Test script available at `/backend/test-password-reset.js`

## Files Modified

- `/backend/src/services/authService.ts` - Fixed token validation logic
- `/backend/src/services/reliableEmailService.ts` - Fixed TypeScript error
- `/src/translations/*.ts` - Added missing translations for all languages

## Lessons Learned

1. Always consider how hashed values affect database queries
2. Security-critical code needs thorough testing with multiple scenarios
3. Password reset tokens must be validated against the specific user, not just any user
