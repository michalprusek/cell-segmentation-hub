import { describe, it, expect } from 'vitest';
import {
  cutoffForNow,
  isIssuedBeforeCutoff,
  tokenIssuedAtMs,
} from '../sessionCutoff';

describe('isIssuedBeforeCutoff', () => {
  const cutoff = new Date('2026-10-07T12:00:00.000Z');

  it('never revokes when the user has no cut-off', () => {
    expect(isIssuedBeforeCutoff(0, null)).toBe(false);
    expect(isIssuedBeforeCutoff(undefined, null)).toBe(false);
    expect(isIssuedBeforeCutoff(undefined, undefined)).toBe(false);
  });

  it('revokes what was issued before the cut-off and keeps what was issued at or after it', () => {
    expect(isIssuedBeforeCutoff(cutoff.getTime() - 1, cutoff)).toBe(true);
    // AT the cut-off is valid: the replacement session can be signed in the
    // same millisecond as the write that set it.
    expect(isIssuedBeforeCutoff(cutoff.getTime(), cutoff)).toBe(false);
    expect(isIssuedBeforeCutoff(cutoff.getTime() + 1, cutoff)).toBe(false);
  });

  it('treats a record with no issue time as older than any cut-off', () => {
    // A refresh record written before `createdAt` existed. Failing open here
    // would exempt every session that predates the deploy from "sign out
    // everywhere", for up to 30 days.
    expect(isIssuedBeforeCutoff(undefined, cutoff)).toBe(true);
    expect(isIssuedBeforeCutoff(Number.NaN, cutoff)).toBe(true);
  });
});

describe('cutoffForNow', () => {
  it('is this instant, to the millisecond', () => {
    const now = Date.parse('2026-10-07T12:00:00.750Z');

    expect(cutoffForNow(now).toISOString()).toBe('2026-10-07T12:00:00.750Z');
  });

  it('tells a session from just before the change from the one issued just after it, in the same second', () => {
    const cutoff = cutoffForNow(Date.parse('2026-10-07T12:00:00.750Z'));

    // 12:00:00.700 - before the password change: revoked.
    expect(
      isIssuedBeforeCutoff(
        tokenIssuedAtMs({ iat: 1791374400, iatMs: 1791374400700 }),
        cutoff
      )
    ).toBe(Date.parse('2026-10-07T12:00:00.700Z') < cutoff.getTime());
    // 12:00:00.760 - the replacement session: kept.
    expect(isIssuedBeforeCutoff(cutoff.getTime() + 10, cutoff)).toBe(false);
    expect(isIssuedBeforeCutoff(cutoff.getTime() - 50, cutoff)).toBe(true);
  });
});

describe('tokenIssuedAtMs', () => {
  it('prefers the millisecond claim', () => {
    expect(tokenIssuedAtMs({ iat: 100, iatMs: 100_750 })).toBe(100_750);
  });

  it('falls back to the START of the second for a token without it - never later than the truth', () => {
    // A legacy token minted at 12:00:00.900, after a change at 12:00:00.750,
    // reads as 12:00:00.000 and is revoked. Too eager, by design: the other
    // direction would keep a token that should have died.
    const cutoff = new Date(100_750);
    expect(tokenIssuedAtMs({ iat: 100 })).toBe(100_000);
    expect(isIssuedBeforeCutoff(tokenIssuedAtMs({ iat: 100 }), cutoff)).toBe(
      true
    );
  });

  it('is undefined when the token carries no issue time at all', () => {
    expect(tokenIssuedAtMs({})).toBeUndefined();
  });
});
