# Immediate Authentication Logout and Redirect Implementation

## Date: 2025-09-22

## Request: "když chybí autentizační token, tak mě vždy hned odhlaš a přesměruj na sign in page a refreshni stránku"

## Translation: "when authentication token is missing, always immediately log me out and redirect to sign-in page and refresh the page"

## Problem Analysis

The user wanted immediate logout and forced page refresh when authentication fails, not gradual degradation or error messages. The existing system only handled one specific Czech error message and didn't force complete page refresh.

## Solution Implementation

### 1. Enhanced API Client Interceptor (`/src/lib/api.ts`)

**Changes Made:**

- Handle ALL 401 errors uniformly, not just specific error messages
- Use `window.location.replace()` instead of `window.location.href` for forced refresh
- Added comprehensive error detection for missing, expired, and invalid tokens
- Reduced delay from 100ms to 50ms for faster response

**Key Implementation (lines 227-287):**

```typescript
// Handle ALL 401 errors uniformly for immediate logout
if (
  error.response?.status === 401 &&
  !isRefreshRequest &&
  !originalRequest._retry
) {
  // Determine the specific auth issue
  const errorMessage = error.response?.data?.message || '';
  const isMissingToken =
    errorMessage === 'Chybí autentizační token' ||
    errorMessage.toLowerCase().includes('missing') ||
    errorMessage.toLowerCase().includes('no token');
  const isExpiredToken = errorMessage.toLowerCase().includes('expired');
  const isInvalidToken = errorMessage.toLowerCase().includes('invalid');

  // Clear all authentication data immediately
  this.clearTokensFromStorage();

  // Emit appropriate event
  const eventType = isMissingToken
    ? 'token_missing'
    : isExpiredToken
      ? 'token_expired'
      : 'token_invalid';

  // Force immediate redirect with page refresh
  if (!window.location.pathname.startsWith('/sign-in')) {
    setTimeout(() => {
      window.location.replace('/sign-in'); // Forces refresh
    }, 50);
  }
}
```

### 2. Token Refresh Failure Handling (`/src/lib/api.ts`)

**Enhanced Refresh Failure (lines 303-336):**

- Also forces immediate logout and refresh on token refresh failure
- Ensures no lingering authentication state

### 3. Emergency Logout Utility (`/src/lib/emergencyLogout.ts`)

**New Utility Created:**

- Comprehensive cleanup of all authentication storage
- Forces page refresh with cache bypass using timestamp
- Prevents back navigation with `window.location.replace()`
- Handles emergency logout flag to prevent initialization loops

**Key Functions:**

```typescript
export const emergencyLogout = (
  reason: string = 'Authentication error',
  redirectPath: string = '/sign-in'
): void => {
  // Clear all auth storage (localStorage, sessionStorage, cookies)
  // Force redirect with refresh using window.location.replace()
  // Add timestamp to bypass cache
}

export const isEmergencyLogout = (): boolean
export const clearEmergencyFlag = (): void
```

### 4. AuthContext Enhancement (`/src/contexts/AuthContext.tsx`)

**Added Emergency Logout Detection (lines 26-32):**

```typescript
// Check if this was an emergency logout
if (isEmergencyLogout()) {
  logger.info(
    'Emergency logout detected, clearing flag and staying on sign-in'
  );
  clearEmergencyFlag();
  setLoading(false);
  return;
}
```

## Technical Details

### Why `window.location.replace()` Instead of `window.location.href`?

1. **No History Entry**: `replace()` doesn't create a browser history entry, preventing users from navigating back to an unauthorized state
2. **Forced Refresh**: Guarantees complete page reload, clearing all React state and memory
3. **Clean Session**: Ensures no authentication remnants persist in application state

### Authentication Flow After Implementation

1. **API Request** → 401 Error
2. **Interceptor Catches** → Determines error type (missing/expired/invalid)
3. **Immediate Cleanup** → Clears all tokens from storage
4. **Event Emission** → Notifies app components (for toasts)
5. **Forced Redirect** → `window.location.replace('/sign-in')`
6. **Page Refresh** → Complete state reset
7. **Clean Sign-In** → User sees fresh sign-in page

## Files Modified

1. `/src/lib/api.ts` - Enhanced response interceptor for ALL 401 errors
2. `/src/lib/emergencyLogout.ts` - New utility for emergency logout
3. `/src/contexts/AuthContext.tsx` - Added emergency logout detection

## Benefits

1. **✅ Immediate Response**: No delay or partial functionality with invalid tokens
2. **✅ Complete Cleanup**: All authentication data cleared instantly
3. **✅ Forced Refresh**: Ensures clean application state
4. **✅ No Back Navigation**: Users can't return to unauthorized state
5. **✅ Unified Handling**: ALL 401 errors handled consistently
6. **✅ User Experience**: Clear, immediate feedback when authentication fails

## Testing Scenarios

1. **Missing Token**: Remove token from storage → Immediate logout and refresh
2. **Expired Token**: Wait for token expiry → Immediate logout and refresh
3. **Invalid Token**: Corrupt token in storage → Immediate logout and refresh
4. **Refresh Failure**: Block refresh endpoint → Immediate logout and refresh
5. **Multiple 401s**: Rapid API calls with bad token → Single logout, no loops

## Security Improvements

1. **No Lingering State**: Invalid authentication state never persists
2. **Complete Cleanup**: All storage mechanisms cleared
3. **No Token Leakage**: Failed requests don't retry with bad tokens
4. **Prevention of Unauthorized Access**: Immediate redirect prevents any UI interaction

## User Experience

Before:

- Partial functionality with missing token
- Error messages accumulating
- Possible stuck states
- Manual refresh needed

After:

- Immediate logout on any auth failure
- Clean redirect to sign-in
- Automatic page refresh
- No error accumulation
- Clear session reset

## Future Considerations

1. Add retry counter to prevent infinite redirect loops
2. Implement offline detection to avoid logout during network issues
3. Add telemetry for authentication failure patterns
4. Consider grace period for token renewal during active use
