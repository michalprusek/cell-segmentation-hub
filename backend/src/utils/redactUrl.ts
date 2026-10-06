/**
 * Query parameters that carry a credential. One list, read by three places:
 *
 *  - `authenticateApiKey` REFUSES a `/api/v1` request that uses any of them;
 *  - `accessLogger` and the request logger REDACT their values before a URL
 *    is written anywhere.
 *
 * The refusal alone is not enough. A client that sends
 * `?api_key=sseg_...` is answered 400 — but both loggers record the URL of
 * every request, including refused ones, so without the redaction the very
 * request that gets "do not put keys in URLs" would write the key to disk.
 * (Measured: one line in access.log and one on stdout per such request.)
 *
 * `token` is on the list for the export/essays download links, whose
 * `?token=` is a short-lived HMAC credential that was being logged in full.
 *
 * This cannot reach the nginx access log in front of the backend, which is
 * why the 400 still tells the caller to treat that key as leaked.
 */
export const CREDENTIAL_QUERY_PARAMS = [
  'api_key',
  'apikey',
  'access_token',
  'key',
  'token',
] as const;

const CREDENTIAL_PARAM_NAMES: ReadonlySet<string> = new Set(
  CREDENTIAL_QUERY_PARAMS
);

/** Names are matched case-insensitively: `?API_KEY=` leaks just as well. */
export function isCredentialQueryParam(name: string): boolean {
  return CREDENTIAL_PARAM_NAMES.has(name.toLowerCase());
}

const CREDENTIAL_IN_QUERY = new RegExp(
  `([?&](?:${CREDENTIAL_QUERY_PARAMS.join('|')})=)[^&#]*`,
  'gi'
);

/** Replace the VALUE of every credential-bearing query parameter. */
export function redactUrlCredentials(url: string): string {
  return url.replace(CREDENTIAL_IN_QUERY, '$1REDACTED');
}
