# Auth: JWT → httpOnly cookies (hard cutover)

**Date:** 2026-05-30
**Status:** Approved, ready for implementation
**Branch:** `feat/auth-httponly-cookies`

## Context / problem

Access + refresh JWTs are currently returned in the login/register/refresh
JSON body and stored in `localStorage` on the frontend (`src/lib/api.ts`),
then sent on every request via an axios `Authorization: Bearer` interceptor and
passed to the socket.io handshake as `auth.token`. `localStorage` is readable
by any successful XSS, so a single injection exfiltrates long-lived credentials.
Helmet/CSP mitigates XSS but doesn't eliminate the exposure.

Goal: move both tokens into `httpOnly`, `Secure`, `SameSite=Strict` cookies so
JavaScript can never read them, closing the XSS-exfiltration vector.

## Decisions (agreed)

1. **Hard cutover** — cookie is the _only_ transport. The backend stops
   returning tokens in the body and stops reading the `Authorization` header /
   `req.body.refreshToken`. No header fallback, no dual path. All currently
   logged-in users (incl. the test account) are logged out once and re-login.
2. **Dev cross-origin via Vite proxy** — the FE dev server proxies `/api` and
   `/socket.io` to `:3001`, making dev same-origin like production (nginx). One
   cookie policy (`SameSite=Strict`) works identically in dev and prod.
3. **CSRF: SameSite=Strict, no token** — for a same-origin SPA, Strict blocks
   cross-site requests from carrying the cookie. No double-submit token. (Strict
   only blocks the cross-site _navigation_; the SPA's subsequent same-origin
   XHRs still carry the cookie, so there is no in-app UX cost.)
4. **Dead-code removal is a first-class deliverable** — the old localStorage /
   header / `auth.token` paths are _deleted_, not left as compat.

## Cookie design

| Cookie          | Flags                                | Path        | Max-Age                                    |
| --------------- | ------------------------------------ | ----------- | ------------------------------------------ |
| `access_token`  | `httpOnly; Secure*; SameSite=Strict` | `/`         | access-token expiry (15m)                  |
| `refresh_token` | `httpOnly; Secure*; SameSite=Strict` | `/api/auth` | refresh expiry (7d, or 30d for rememberMe) |

`Secure` is set in production only (dev over http via the Vite proxy must omit
`Secure` or the browser drops the cookie). The `refresh_token` is path-scoped to
`/api/auth` so it is sent only to the refresh/logout endpoints, not on every API
call. `rememberMe` continues to control the refresh-token lifetime, now applied
to the cookie `Max-Age` instead of a JS-side preference.

## Backend changes (`backend/`)

- **`server.ts`**: add `cookie-parser` middleware (read `req.cookies`). CORS
  already sets `credentials: true`.
- **New `src/utils/authCookies.ts`**: `setAuthCookies(res, access, refresh, { rememberMe })`
  and `clearAuthCookies(res)`. Single source of truth for cookie names, flags,
  paths, and max-ages (derived from the existing JWT expiry config).
- **`authController.ts`**: `login` / `register` / `refreshToken` call
  `setAuthCookies` and return **user info only** (no tokens) in the body.
  `logout` reads `req.cookies.refresh_token`, revokes the session, and calls
  `clearAuthCookies`.
- **`middleware/auth.ts`**: read the token from `req.cookies.access_token`
  instead of `extractTokenFromHeader(req.headers.authorization)` (both the
  `authenticate` path at ~line 56 and the optional path at ~line 231).
- **`websocketService.ts`** (~line 160): parse `access_token` from
  `socket.handshake.headers.cookie` (drop the `handshake.auth.token` branch).
  socket.io receives cookies automatically on a same-origin handshake.

## Frontend changes (`src/`)

- **`lib/api.ts`**: set `withCredentials: true` on the axios instance. **Remove**
  the `Authorization`-header request interceptor and _all_ `localStorage` token
  get/set/remove. The 401→refresh response interceptor simply calls
  `/api/auth/refresh` (cookie auto-sent) and retries — no token handling.
- **`contexts/AuthContext.tsx`**: `isAuthenticated` is derived from the `user`
  state (already loaded via `/api/auth/profile` on init), not from a stored
  token. Login/register set `user` from the response body.
- **`services/webSocketManager.ts`**: drop the `token` field from
  `currentUser`/`connect()`; create the socket with `withCredentials: true`
  (cookie carries auth). Reconnection keys on user id, not token.
- **`vite.config.ts`**: `server.proxy` for `/api` and `/socket.io` → `http://localhost:3001`
  (`ws: true` for socket.io). FE API base URL becomes relative.

## Dead code to remove (verified via grep before deletion)

FE: localStorage token I/O, the Authorization interceptor, `getAccessToken` /
`getRefreshToken` / `rememberMePreferred` token logic if unreferenced after the
change, the `token` field threaded through `webSocketManager` and `AuthContext`.
BE: token fields in response bodies, `req.body.refreshToken` reads, the
`extractTokenFromHeader` call sites _and the function itself in `auth/jwt.ts`_
if nothing else uses it, the `handshake.auth.token` branch.

## Error handling

- Missing/invalid `access_token` cookie → 401 (unchanged middleware contract).
- Missing/invalid `refresh_token` → refresh returns 401; FE interceptor clears
  `user` state and routes to sign-in.
- Logout always clears both cookies even if session revocation fails.

## Testing

- **Backend (vitest)**: update auth controller/middleware/service tests to
  assert `Set-Cookie` (name, flags, path, max-age) and cookie-based reads
  instead of body tokens / header. New `authCookies.ts` unit-tested directly.
  socket auth test reads from the cookie header.
- **Frontend (vitest)**: `api.ts` + `AuthContext` tests assert `withCredentials`,
  no localStorage writes, profile-derived `isAuthenticated`, refresh-on-401.
- **Coverage**: must stay ≥ the configured 80% floor; full suites green.

## Verification (CLAUDE.md gates, before claiming done)

1. `curl -i` login → assert two `Set-Cookie` headers with correct flags.
2. `curl -b cookies.txt` `/api/auth/profile` → 200 (cookie auth works);
   without the jar → 401.
3. `curl -b` refresh → new `access_token` cookie; logout → cookies cleared.
4. Production-mode local preview + Playwright: login → dashboard renders →
   WebSocket connects (auth via cookie) → trigger a refresh → logout. **0
   console errors.** Confirm `document.cookie` does NOT expose the tokens
   (httpOnly) and `localStorage` holds no tokens.

## Out of scope

CSRF double-submit token; header/localStorage backwards-compat; "remember me"
UX changes beyond mapping it to cookie Max-Age; any non-auth refactor.

## Rollout

Single deploy of backend + frontend (the cutover must be atomic — a new FE
against an old BE, or vice versa, would fail auth). nginx restart after backend
recreate (DNS cache). All sessions invalidated on deploy.
