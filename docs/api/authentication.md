# Authentication API

User authentication endpoints for registration, login, logout, and token management.

## Base Path

`/api/auth`

## Endpoints

### Register New User

Create a new user account.

**Endpoint**: `POST /register`  
**Authentication**: None  
**Rate Limit**: 10 requests per hour per IP

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

#### Validation Rules

- `email`: Valid email address, unique in system
- `password`: Minimum 8 characters, must contain uppercase, lowercase, number, and special character

#### Success Response `201`

```json
{
  "success": true,
  "message": "User registered successfully. Please verify your email.",
  "data": {
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "emailVerified": false,
      "createdAt": "2024-01-01T12:00:00.000Z",
      "updatedAt": "2024-01-01T12:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900
    }
  }
}
```

#### Error Responses

```json
// 400 - Validation Error
{
  "success": false,
  "error": "Validation failed",
  "errors": {
    "email": ["Email is already registered"],
    "password": ["Password must be at least 8 characters long"]
  }
}

// 409 - User Already Exists
{
  "success": false,
  "error": "User with this email already exists"
}
```

### Login User

Authenticate user and receive JWT tokens.

**Endpoint**: `POST /login`  
**Authentication**: None  
**Rate Limit**: 5 requests per 15 minutes per IP

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "emailVerified": true,
      "createdAt": "2024-01-01T12:00:00.000Z",
      "updatedAt": "2024-01-01T12:00:00.000Z",
      "profile": {
        "id": "profile_456",
        "username": "scientist_user",
        "preferredModel": "hrnet",
        "modelThreshold": 0.5,
        "preferredLang": "cs",
        "preferredTheme": "light"
      }
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900
    }
  }
}
```

#### Error Responses

```json
// 401 - Invalid Credentials
{
  "success": false,
  "error": "Invalid email or password"
}

// 429 - Rate Limited
{
  "success": false,
  "error": "Too many login attempts. Please try again later."
}
```

### Refresh Token

Exchange refresh token for new access token.

**Endpoint**: `POST /refresh`  
**Authentication**: None (requires refresh token)  
**Rate Limit**: 100 requests per hour per IP

#### Request Body

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

#### Error Responses

```json
// 401 - Invalid Refresh Token
{
  "success": false,
  "error": "Invalid or expired refresh token"
}
```

### Logout User

Invalidate user's refresh token and log out.

**Endpoint**: `POST /logout`  
**Authentication**: Required (Bearer token)

#### Request Body

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Logout successful"
}
```

### Get Current User

Retrieve current authenticated user's information.

**Endpoint**: `GET /me`  
**Authentication**: Required (Bearer token)

#### Success Response `200`

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "emailVerified": true,
      "createdAt": "2024-01-01T12:00:00.000Z",
      "updatedAt": "2024-01-01T12:00:00.000Z",
      "profile": {
        "id": "profile_456",
        "username": "scientist_user",
        "avatarUrl": "/uploads/avatars/avatar_456.jpg",
        "bio": "Cell biology researcher",
        "preferredModel": "hrnet",
        "modelThreshold": 0.5,
        "preferredLang": "cs",
        "preferredTheme": "light",
        "emailNotifications": true,
        "createdAt": "2024-01-01T12:00:00.000Z",
        "updatedAt": "2024-01-01T12:05:00.000Z"
      }
    }
  }
}
```

### Update User Profile

Update user profile information.

**Endpoint**: `PUT /profile`  
**Authentication**: Required (Bearer token)

#### Request Body

```json
{
  "username": "new_username",
  "bio": "Updated bio text",
  "preferredModel": "resunet_advanced",
  "modelThreshold": 0.7,
  "preferredLang": "en",
  "preferredTheme": "dark",
  "emailNotifications": false
}
```

#### Validation Rules

- `username`: 3-30 characters, alphanumeric and underscores only, unique
- `bio`: Maximum 500 characters
- `preferredModel`: Must be one of: `hrnet`, `resunet_advanced`, `resunet_small`
- `modelThreshold`: Number between 0.0 and 1.0
- `preferredLang`: Must be one of: `cs`, `en`
- `preferredTheme`: Must be one of: `light`, `dark`

#### Success Response `200`

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "profile": {
      "id": "profile_456",
      "username": "new_username",
      "bio": "Updated bio text",
      "preferredModel": "resunet_advanced",
      "modelThreshold": 0.7,
      "preferredLang": "en",
      "preferredTheme": "dark",
      "emailNotifications": false,
      "updatedAt": "2024-01-01T12:30:00.000Z"
    }
  }
}
```

### Delete User Account

Delete user account and all associated data. Requires email confirmation for security.

**Endpoint**: `DELETE /profile`  
**Authentication**: Required (Bearer token)  
**Rate Limit**: 3 requests per hour per user

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "CurrentPassword123!"
}
```

#### Validation Rules

- `email`: Must match authenticated user's email exactly
- `password`: Must match user's current password

#### Success Response `200`

```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

#### Error Responses

```json
// 400 - Email Mismatch
{
  "success": false,
  "error": "Email does not match account email"
}

// 400 - Password Incorrect
{
  "success": false,
  "error": "Password is incorrect"
}

// 429 - Rate Limited
{
  "success": false,
  "error": "Too many deletion attempts. Please try again later."
}
```

**Security Notes**:

- Account deletion is immediate and irreversible
- All user data including projects, images, and segmentations are permanently deleted
- User receives email confirmation after successful deletion
- GitHub-style confirmation UI requires typing exact email address

### Change Password

Change user's password.

**Endpoint**: `POST /change-password`  
**Authentication**: Required (Bearer token)  
**Rate Limit**: 5 requests per hour per user

#### Request Body

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!"
}
```

#### Validation Rules

- `currentPassword`: Must match user's current password
- `newPassword`: Same rules as registration password

#### Success Response `200`

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

#### Error Responses

```json
// 400 - Current Password Incorrect
{
  "success": false,
  "error": "Current password is incorrect"
}

// 400 - Password Validation Failed
{
  "success": false,
  "error": "Password validation failed",
  "errors": {
    "newPassword": ["Password must contain at least one uppercase letter"]
  }
}
```

### Request Password Reset

Request password reset email.

**Endpoint**: `POST /forgot-password`  
**Authentication**: None  
**Rate Limit**: 3 requests per hour per IP

#### Request Body

```json
{
  "email": "user@example.com"
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "If an account with this email exists, a password reset link has been sent."
}
```

_Note: For security reasons, this endpoint always returns success, even if the email doesn't exist._

### Reset Password

Reset password using token from email.

**Endpoint**: `POST /reset-password`  
**Authentication**: None  
**Rate Limit**: 10 requests per hour per IP

#### Request Body

```json
{
  "token": "reset_token_from_email",
  "newPassword": "NewSecurePassword789!"
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

#### Error Responses

```json
// 400 - Invalid or Expired Token
{
  "success": false,
  "error": "Invalid or expired reset token"
}
```

### Verify Email

Verify user's email address using token from email.

**Endpoint**: `POST /verify-email`  
**Authentication**: None

#### Request Body

```json
{
  "token": "verification_token_from_email"
}
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

### Resend Verification Email

Send verification email again.

**Endpoint**: `POST /resend-verification`  
**Authentication**: Required (Bearer token)  
**Rate Limit**: 3 requests per hour per user

#### Success Response `200`

```json
{
  "success": true,
  "message": "Verification email sent successfully"
}
```

## JWT Token Structure

### Access Token Payload

```json
{
  "userId": "user_123",
  "type": "access",
  "iat": 1640995200,
  "exp": 1640996100
}
```

### Refresh Token Payload

```json
{
  "userId": "user_123",
  "type": "refresh",
  "sessionId": "session_789",
  "iat": 1640995200,
  "exp": 1641600000
}
```

## Authentication Flow Examples

### Frontend Login Flow

```typescript
// 1. Login user
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

const { tokens } = await loginResponse.json();

// 2. Store tokens (in memory, not localStorage for security)
setAccessToken(tokens.accessToken);
setRefreshToken(tokens.refreshToken);

// 3. Set up automatic token refresh
setInterval(
  async () => {
    try {
      const refreshResponse = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      const { accessToken } = await refreshResponse.json();
      setAccessToken(accessToken);
    } catch (error) {
      // Redirect to login
      window.location.href = '/login';
    }
  },
  14 * 60 * 1000
); // Refresh 1 minute before expiry
```

### API Request with Authentication

```typescript
const makeAuthenticatedRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Try refreshing token
    await refreshAccessToken();

    // Retry original request
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${newAccessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  return response;
};
```

## Security Considerations

### Token Security

- **Access tokens**: Short-lived (15 minutes) to limit exposure
- **Refresh tokens**: Stored in database for revocation capability
- **HTTPS only**: All authentication endpoints require HTTPS in production
- **Secure cookies**: Refresh tokens can optionally be stored in httpOnly cookies

### Password Security

- **bcrypt hashing**: Passwords hashed with salt rounds = 12
- **Password complexity**: Enforced minimum security requirements
- **Rate limiting**: Prevents brute force attacks
- **Account lockout**: Optional feature for repeated failed attempts

### Session Management

- **Token rotation**: Refresh tokens rotate on use (optional)
- **Session tracking**: All active sessions tracked in database
- **Remote logout**: Ability to invalidate all sessions for user
