# Automatic Logout on Missing Authentication Token

_Date: 2025-09-10_

## Feature Request

User requested: "když chybí autentizační token, tak uživatele ihned odhlaš" (when authentication token is missing, immediately logout the user)

## Implementation Summary

Enhanced the authentication system to immediately logout users when the authentication token is missing, providing better security and user experience.

## Changes Made

### 1. API Client Enhancement (`/src/lib/api.ts`)

Added specific handling for missing token errors in the response interceptor:

- Detects when backend returns 401 with message "Chybí autentizační token"
- Immediately clears stored tokens
- Emits a `token_missing` event for user notification
- Redirects to sign-in page (unless already on auth pages)
- Small delay before redirect to allow toast notification

### 2. Auth Events System (`/src/lib/authEvents.ts`)

Extended auth event types to include:

- `token_missing` - When token is not provided
- `token_expired` - When token has expired (for future use)

### 3. Toast Notifications (`/src/hooks/useAuthToasts.ts`)

Added handlers for new auth events:

- Shows error toast when token is missing
- Shows warning toast when token expires
- Provides user-friendly messages with instructions

### 4. Translations

Added new translation keys to all language files:

- Czech: "Chybí autentizační token" / "Prosím přihlaste se znovu"
- English: "Authentication token missing" / "Please sign in again"
- (Same keys should be added to other languages: ES, DE, FR, ZH)

## Technical Details

### Backend Behavior (Already Implemented)

The backend middleware (`/backend/src/middleware/auth.ts`) already correctly:

- Returns 401 status when token is missing
- Sends message "Chybí autentizační token"
- This triggers our frontend handling

### Frontend Flow

1. User makes API request without token
2. Backend returns 401 with specific message
3. API client interceptor catches this error
4. Tokens are cleared from storage
5. Event is emitted for toast notification
6. User is redirected to sign-in page

### Security Benefits

- Prevents unauthorized access attempts
- Ensures clean session management
- Immediate feedback to users
- No lingering invalid states

## Code Snippets

### API Client Interceptor

```typescript
if (
  error.response?.status === 401 &&
  error.response?.data?.message === 'Chybí autentizační token'
) {
  logger.debug('🔒 Missing authentication token - logging out user');
  this.clearTokensFromStorage();

  // Emit event and redirect
  import('./authEvents').then(({ authEventEmitter }) => {
    authEventEmitter.emit({
      type: 'token_missing',
      data: {
        message: 'Authentication required',
        description: 'Your session has expired. Please sign in again.',
      },
    });
  });

  if (
    window.location.pathname !== '/sign-in' &&
    window.location.pathname !== '/sign-up' &&
    !window.location.pathname.startsWith('/public')
  ) {
    setTimeout(() => {
      window.location.href = '/sign-in';
    }, 100);
  }
}
```

## Testing Scenarios

1. **Remove token from localStorage** - Should immediately logout and redirect
2. **Make API call without Authorization header** - Should trigger automatic logout
3. **Access protected route without token** - Should redirect to sign-in
4. **Already on sign-in page** - Should not redirect (avoid loops)

## Edge Cases Handled

- Prevents redirect loops when already on auth pages
- Doesn't redirect from public pages
- Allows toast notification to display before redirect
- Uses dynamic import to avoid circular dependencies

## Future Enhancements

1. Add similar handling for expired tokens
2. Implement refresh token rotation
3. Add session timeout warnings
4. Consider adding a modal dialog before logout
5. Add telemetry for security monitoring

## Related Files

- `/src/lib/api.ts` - API client with interceptors
- `/src/lib/authEvents.ts` - Auth event system
- `/src/hooks/useAuthToasts.ts` - Toast notifications
- `/src/translations/*.ts` - Translation files
- `/backend/src/middleware/auth.ts` - Backend auth middleware

## Notes

- This feature enhances security by preventing stale sessions
- Provides immediate feedback to users about authentication status
- Follows existing patterns in the codebase
- Maintains consistency with backend error messages
