import { describe, it, expect } from 'vitest';
import {
  CREDENTIAL_QUERY_PARAMS,
  isCredentialQueryParam,
  redactUrlCredentials,
} from '../redactUrl';

const SECRET = 'sseg_SECRETsecretSECRETsecret';

describe('redactUrlCredentials', () => {
  it.each(CREDENTIAL_QUERY_PARAMS)(
    'redacts ?%s= wherever it sits in the query',
    name => {
      for (const url of [
        `/api/v1/models?${name}=${SECRET}`,
        `/api/v1/models?a=1&${name}=${SECRET}`,
        `/api/v1/models?${name}=${SECRET}&b=2`,
        `/api/v1/models?a=1&${name}=${SECRET}&b=2#frag`,
      ]) {
        const out = redactUrlCredentials(url);
        expect(out).not.toContain(SECRET);
        expect(out).toContain(`${name}=REDACTED`);
      }
    }
  );

  it('keeps every other parameter and the path intact', () => {
    expect(
      redactUrlCredentials(`/api/x/y?page=2&token=${SECRET}&sort=name#top`)
    ).toBe('/api/x/y?page=2&token=REDACTED&sort=name#top');
  });

  it('redacts every occurrence, not just the first', () => {
    const out = redactUrlCredentials(`/p?key=${SECRET}&api_key=${SECRET}`);
    expect(out).toBe('/p?key=REDACTED&api_key=REDACTED');
  });

  it('matches parameter names case-insensitively', () => {
    expect(redactUrlCredentials(`/p?API_KEY=${SECRET}`)).not.toContain(SECRET);
    expect(isCredentialQueryParam('Access_Token')).toBe(true);
  });

  it('does not touch a parameter that merely ends in a credential name', () => {
    // `monkey` ends in `key`, `subtoken` in `token`.
    const url = '/p?monkey=banana&subtoken=abc&keyword=x';
    expect(redactUrlCredentials(url)).toBe(url);
    expect(isCredentialQueryParam('monkey')).toBe(false);
  });

  it('leaves a URL with no query alone', () => {
    expect(redactUrlCredentials('/api/v1/token/key')).toBe('/api/v1/token/key');
  });
});
