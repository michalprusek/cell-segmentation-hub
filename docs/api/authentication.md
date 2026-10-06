# Authentication API

The endpoints under `/api/auth`: registration, sign-in, the session, the
profile, password reset and e-mail verification.

> **Two different mechanisms — do not mix them up.**
>
> - **The app's own routes** (everything on this page, and every other
>   `/api/...` route) authenticate by an httpOnly **session cookie**. The
>   backend does not read an `Authorization` header on them: a valid access
>   token sent as `Authorization: Bearer …` with no cookie is answered `401`.
> - **The public API** (`/api/v1`) authenticates by an **API key**,
>   `Authorization: Bearer sseg_…`, created under Settings → API. See
>   [Public API](public-v1.md). If you are writing a script, that is the API
>   you want; this page describes what the web app itself uses.

**Every example on this page is a response that was actually received**, from
a backend built from `main` on 2026-10-06 running against an empty database,
with a mail sink standing in for the SMTP server. Ids and timestamps are
shortened; nothing else is edited. An earlier version of this page described
tokens in response bodies, a `GET /me` endpoint, English messages and rate
limits that the service has never had in this form — if you remember one of
those, it was the page that was wrong.

## Conventions

**Envelope.** Success is `{ "success": true, "data": …, "message": "…" }`.
Failure is `{ "success": false, "error": "…", "code": "…" }`, with a `details`
object on a validation error.

**`message` and `error` are Czech, whatever the user's language.** They are
written for the log, not for display: the web app translates by `code`. Switch
on `code` and the HTTP status, never on the text.

| `code`                | Status | Meaning                                                |
| --------------------- | ------ | ------------------------------------------------------ |
| `VALIDATION_ERROR`    | 400    | The body failed validation; see `details`              |
| `BAD_REQUEST`         | 400    | Wrong current password, or an invalid or used token    |
| `UNAUTHORIZED`        | 401    | No session cookie, bad credentials, bad refresh token  |
| `FORBIDDEN`           | 403    | E-mail not verified (only when verification is forced) |
| `USER_NOT_FOUND`      | 404    | `forgot-password` for an address with no account       |
| `NOT_FOUND`           | 404    | No such endpoint                                       |
| `CONFLICT`            | 409    | The e-mail address is already registered               |
| `RATE_LIMIT_EXCEEDED` | 429    | See [Rate limits](#rate-limits)                        |

**The session is three cookies**, set by register, login and refresh and
cleared by logout:

| Cookie          | Path        | httpOnly | Lifetime                               |
| --------------- | ----------- | -------- | -------------------------------------- |
| `access_token`  | `/`         | yes      | 15 minutes                             |
| `refresh_token` | `/api/auth` | yes      | 7 or 30 days — see [Refresh](#refresh) |
| `authenticated` | `/`         | no       | same as `refresh_token`                |

All three are `Secure; SameSite=Strict`. `authenticated` carries no secret; it
exists so the page's JavaScript can tell whether a session is likely to exist
without being able to read one. Because `refresh_token` is scoped to
`/api/auth`, the browser sends it to these endpoints and to nothing else.

**No token ever appears in a response body.**

## Rate limits

Responses carry `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`
and `RateLimit-Reset`; a `429` adds `Retry-After` in seconds.

| Applies to                                                                             | Limit                       |
| -------------------------------------------------------------------------------------- | --------------------------- |
| `POST /register`, `POST /login` (shared counter)                                       | 20 per 15 minutes           |
| `POST /forgot-password`, `/request-password-reset`, `/reset-password` (shared counter) | 5 per 10 minutes            |
| Everything else here                                                                   | the global 5 000 per minute |

Two things worth knowing before you meet them:

- The password-reset counter is **shared by all three endpoints and counts
  failed requests too**. Five mistyped `reset-password` calls lock out the
  correct sixth for ten minutes.
- `POST /resend-verification` has no limit of its own.

```json
// 429 from /login or /register
{ "success": false, "error": "Too many requests. Please try again later.", "code": "RATE_LIMIT_EXCEEDED" }

// 429 from the password-reset endpoints
{ "success": false, "error": "Příliš mnoho pokusů o reset hesla. Zkuste to prosím znovu za 10 minut.", "code": "RATE_LIMIT_EXCEEDED" }
```

## Endpoints

### Register

`POST /api/auth/register` — no authentication.

```json
{ "email": "user@example.com", "password": "at-least-6-chars" }
```

| Field                                                                                 | Rule                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `email`                                                                               | required, a valid address                                                  |
| `password`                                                                            | required, **at least 6 characters** — no other complexity rule is enforced |
| `username`                                                                            | optional, at least 2 characters                                            |
| `preferredLang` / `language`                                                          | optional, one of `en cs es fr de zh`                                       |
| `consentToMLTraining`, `consentToAlgorithmImprovement`, `consentToFeatureDevelopment` | optional booleans                                                          |

`201` — **and the user is signed in**: the response sets the three session
cookies, with the 30-day refresh lifetime.

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6d537076-…",
      "email": "user@example.com",
      "emailVerified": false
    }
  },
  "message": "Uživatel byl úspěšně zaregistrován a přihlášen."
}
```

`data.user` also carries `username` when one was sent. A verification e-mail
is sent in the language given by `preferredLang`.

```json
// 409
{ "success": false, "error": "Uživatel s tímto emailem již existuje", "code": "CONFLICT" }

// 400
{
  "success": false,
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": { "password": ["Heslo musí mít minimálně 6 znaků"] }
}
```

`details` maps each failing field to a list of messages.

### Login

`POST /api/auth/login` — no authentication.

```json
{ "email": "user@example.com", "password": "…", "rememberMe": false }
```

`rememberMe` is optional and defaults to `false`.

`200`, with the three session cookies:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6d537076-…",
      "email": "user@example.com",
      "emailVerified": false,
      "profile": {
        "id": "2c74fd62-…",
        "userId": "6d537076-…",
        "username": null,
        "avatarUrl": null,
        "avatarPath": null,
        "avatarMimeType": null,
        "avatarSize": null,
        "bio": null,
        "organization": null,
        "location": null,
        "title": null,
        "publicProfile": false,
        "preferredLang": "en",
        "preferredTheme": "light",
        "emailNotifications": true,
        "consentToMLTraining": true,
        "consentToAlgorithmImprovement": true,
        "consentToFeatureDevelopment": true,
        "consentUpdatedAt": "2026-10-06T17:22:23.091Z",
        "createdAt": "2026-10-06T17:22:23.092Z",
        "updatedAt": "2026-10-06T17:22:23.092Z"
      }
    }
  },
  "message": "Přihlášení bylo úspěšné"
}
```

```json
// 401 - unknown address and wrong password are not distinguished
{ "success": false, "error": "Neplatné přihlašovací údaje", "code": "UNAUTHORIZED" }

// 403 - only when the server runs with REQUIRE_EMAIL_VERIFICATION=true
{
  "success": false,
  "error": "Email musí být ověřen před přihlášením. Zkontrolujte svou emailovou schránku nebo požádejte o nový ověřovací email.",
  "code": "FORBIDDEN"
}
```

`REQUIRE_EMAIL_VERIFICATION` is **off in production**. When it is on it gates
`/login` only — see [Known gaps](#known-gaps).

### Refresh

`POST /api/auth/refresh` (canonical name `POST /api/auth/refresh-token`; both
are mounted and behave identically) — authenticated by the `refresh_token`
cookie alone. **There is no request body**; a `refreshToken` field in the body
is ignored, and a request carrying only that is a `401`.

`200`, with all three cookies set again:

```json
{ "success": true, "data": null, "message": "Token byl úspěšně obnoven" }
```

The refresh token **rotates**: each call issues a new one and the one just
used stops working (replaying it is a `401`).

A refreshed session always gets the **30-day** cookie, whatever `rememberMe`
was at login. So `rememberMe: false` buys a 7-day refresh cookie only until
the first refresh, which the web app performs every 13 minutes.

```json
// 401 - no cookie
{ "success": false, "error": "Chybí refresh token", "code": "UNAUTHORIZED" }

// 401 - a cookie that is unknown, expired or already used
{ "success": false, "error": "Neplatný nebo vypršený refresh token", "code": "UNAUTHORIZED" }
```

### Logout

`POST /api/auth/logout` — session cookie required. No request body.

`200`, and the three cookies are cleared (`Expires` in 1970):

```json
{ "success": true, "data": null, "message": "Odhlášení bylo úspěšné" }
```

Without a session it is a `401` (`Chybí autentizační token`), not a silent
success.

### Check the session

`GET /api/auth/check` — session cookie required.

```json
{
  "success": true,
  "data": {
    "authenticated": true,
    "user": {
      "id": "6d537076-…",
      "email": "user@example.com",
      "emailVerified": false
    }
  },
  "message": "Uživatel je přihlášen"
}
```

Without a session this is a `401`, not `authenticated: false`.

### Get the profile

`GET /api/auth/profile` — session cookie required. (There is no `/me`.)

```json
{
  "success": true,
  "data": {
    "id": "6d537076-…",
    "email": "user@example.com",
    "isEmailVerified": false,
    "isAdmin": false,
    "language": "en",
    "theme": "light",
    "avatarUrl": null,
    "createdAt": "2026-10-06T17:22:23.092Z",
    "settings": {
      "notifications": {
        "email": true,
        "push": false,
        "segmentationComplete": true,
        "projectShared": true
      }
    },
    "stats": {
      "totalProjects": 0,
      "totalImages": 0,
      "totalSegmentations": 0,
      "storageUsed": "0 B",
      "storageUsedBytes": 0,
      "imagesUploadedToday": 0,
      "processedImages": 0
    },
    "impersonatedBy": null
  },
  "message": "Profil uživatele úspěšně načten"
}
```

**This is a different shape from the `user.profile` object that login and
`PUT /profile` return**, and the field names differ: `language` / `theme` /
`isEmailVerified` here, `preferredLang` / `preferredTheme` / `emailVerified`
there. `impersonatedBy` is non-null while an administrator is acting as this
user.

### Update the profile

`PUT /api/auth/profile` — session cookie required. Every field is optional.

```json
{
  "username": "new_username",
  "bio": "Updated bio text",
  "preferredLang": "cs",
  "preferredTheme": "dark",
  "emailNotifications": false
}
```

| Field                                                         | Rule                        |
| ------------------------------------------------------------- | --------------------------- |
| `username`                                                    | at least 2 characters       |
| `bio`                                                         | at most 500 characters      |
| `organization`, `location`, `title`                           | at most 100 characters each |
| `publicProfile`, `emailNotifications`, the three `consentTo…` | boolean                     |
| `avatarUrl`                                                   | a URL                       |
| `preferredLang` / `language`                                  | one of `en cs es fr de zh`  |
| `preferredTheme`                                              | `light` or `dark`           |
| `theme`                                                       | `light`, `dark` or `system` |

`200` returns the same `data.user` object as login (with the updated
`profile`) and `"message": "Profil byl úspěšně aktualizován"`.

```json
// 400
{
  "success": false,
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": {
    "username": ["Uživatelské jméno musí mít minimálně 2 znaky"],
    "preferredLang": [
      "Invalid enum value. Expected 'en' | 'cs' | 'es' | 'fr' | 'de' | 'zh', received 'xx'"
    ]
  }
}
```

The segmentation model is not a profile field: it belongs to the project
(`projects.segmentationModel`).

### Upload an avatar

`POST /api/auth/avatar` — session cookie required. `multipart/form-data` with
the picture in a file part named **`image`** (a part named `avatar` is refused
with `400 Neočekávané pole souboru: avatar`).

```json
{
  "success": true,
  "data": {
    "avatarUrl": "/uploads/avatars/<userId>/avatar-<userId>-<uuid>.jpg",
    "message": "Avatar uploaded successfully"
  },
  "message": "Avatar byl úspěšně nahrán"
}
```

### Storage statistics

`GET /api/auth/storage-stats` — session cookie required.

```json
{
  "success": true,
  "data": {
    "totalStorageMB": 0,
    "totalStorageGB": 0,
    "totalImages": 0,
    "averageImageSizeMB": 0,
    "totalBytes": 0,
    "totalMB": 0,
    "totalGB": 0,
    "imageCount": 0
  }
}
```

### Change the password

`POST /api/auth/change-password` — session cookie required.

```json
{ "currentPassword": "…", "newPassword": "at-least-6-chars" }
```

```json
// 200
{
  "success": true,
  "data": { "message": "Heslo bylo úspěšně změněno." },
  "message": "Heslo bylo úspěšně změněno."
}

// 400 - wrong current password
{ "success": false, "error": "Současné heslo není správné", "code": "BAD_REQUEST" }

// 400 - new password too short
{
  "success": false,
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": { "newPassword": ["Nové heslo musí mít minimálně 6 znaků"] }
}
```

The session that made the change stays signed in.

### Request a password reset

`POST /api/auth/forgot-password` (also mounted as
`POST /api/auth/request-password-reset`) — no authentication.

```json
{ "email": "user@example.com" }
```

```json
// 200 - the address has an account; a reset link was e-mailed
{
  "success": true,
  "data": { "message": "Pokud email existuje, byl odeslán odkaz pro reset hesla." },
  "message": "Pokud email existuje, byl odeslán odkaz pro reset hesla."
}

// 404 - the address has no account
{ "success": false, "error": "Email není registrován v systému.", "code": "USER_NOT_FOUND" }
```

The success message says "if the address exists", but the endpoint does tell
the two cases apart — see [Known gaps](#known-gaps).

The e-mailed link is `<FRONTEND_URL>/reset-password?token=<64 characters>`.

### Reset the password

`POST /api/auth/reset-password` — no authentication.

```json
{ "token": "<token from the e-mail>", "newPassword": "at-least-6-chars" }
```

```json
// 200
{
  "success": true,
  "data": { "message": "Heslo bylo úspěšně změněno. Nyní se můžete přihlásit s novým heslem." },
  "message": "Heslo bylo úspěšně změněno. Nyní se můžete přihlásit s novým heslem."
}

// 400 - unknown, expired or already used token
{ "success": false, "error": "Neplatný nebo vypršený reset token", "code": "BAD_REQUEST" }
```

A token works once. The old password stops working immediately. The response
sets no cookies — the user signs in afterwards.

### Verify the e-mail address

`GET /api/auth/verify-email/{token}` — no authentication. The e-mailed link is
`<FRONTEND_URL>/verify-email?token=…`; the page there calls this endpoint.

```json
// 200
{
  "success": true,
  "data": { "message": "Email byl úspěšně ověřen." },
  "message": "Email byl úspěšně ověřen."
}

// 400 - unknown token, or one already used
{ "success": false, "error": "Neplatný ověřovací token", "code": "BAD_REQUEST" }
```

A token works once: a second request with the same token is the `400`.

### Resend the verification e-mail

`POST /api/auth/resend-verification` — no authentication.

```json
{ "email": "user@example.com" }
```

Always `200`, whether or not the address has an account or is already
verified:

```json
{
  "success": true,
  "data": {
    "message": "Pokud email existuje a není ověřen, byl odeslán ověřovací email."
  },
  "message": "Pokud email existuje a není ověřen, byl odeslán ověřovací email."
}
```

Outside production (`NODE_ENV` other than `production`), `data` also carries
the `verificationToken`, so a test can verify without a mailbox. That branch
is read from the code, not observed: the measurements for this page ran with
`NODE_ENV=production`.

## Token payloads

Both tokens are HS256 JWTs signed with different secrets, and both carry the
same claims — there is no `type` or `sessionId` claim:

```json
{
  "userId": "6d537076-1523-4d5c-a30d-fe2ca5ae3ad1",
  "email": "user@example.com",
  "emailVerified": false,
  "iat": 1791307343,
  "exp": 1791308243,
  "aud": "cell-segmentation-app",
  "iss": "cell-segmentation-api"
}
```

They live in httpOnly cookies, so a client never needs to decode one. This is
recorded for whoever debugs the server.

## Using it from a page

```typescript
// 1. Sign in. The response sets the session cookies; there is nothing to store.
await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

// 2. Call the API. The cookies travel by themselves.
const send = (url: string, options: RequestInit = {}) =>
  fetch(url, { ...options, credentials: 'include' });

// 3. On a 401 the access cookie has expired (15 minutes): refresh, retry once.
let response = await send('/api/projects');
if (response.status === 401) {
  const refreshed = await send('/api/auth/refresh', { method: 'POST' });
  if (refreshed.ok) response = await send('/api/projects');
}
```

The web app also refreshes on a 13-minute timer rather than waiting for the
`401`.

## Known gaps

Behaviour found while verifying this page that a reader should not be
surprised by. Each was observed on the wire on 2026-10-06; none is fixed by the
change that rewrote this page.

- **There is no account-deletion endpoint.** The web app's "Delete account"
  dialog calls `DELETE /api/auth/profile`, which answers `404 NOT_FOUND`. A
  `deleteAccount` controller exists in `authController.ts`, but no route
  mounts it.
- **`/api/users/change-password` and `DELETE /api/users/account` are stubs.**
  They answer `success: true` and do nothing (both are marked `TODO` in
  `userRoutes.ts`). The working password change is the one on this page.
- **`forgot-password` reveals whether an address is registered** (`200` vs
  `404 USER_NOT_FOUND`), although its success message is worded as if it did
  not. `resend-verification` does not have this problem.
- **Changing or resetting a password does not end other sessions.** A session
  opened before a password reset kept working, and kept refreshing, after it.
- **`REQUIRE_EMAIL_VERIFICATION=true` does not stop an unverified user from
  using the app**: `/register` signs the new user in directly, and only a
  later `/login` is refused.
- **`rememberMe: false` is effectively 30 days** — see [Refresh](#refresh).

## Password storage

Passwords are hashed with bcrypt, 12 salt rounds (`backend/src/auth/password.ts`).
