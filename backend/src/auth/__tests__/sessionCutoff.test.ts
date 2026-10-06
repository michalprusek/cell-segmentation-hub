import { describe, it, expect } from 'vitest';
import { cutoffForNow, isIssuedBeforeCutoff } from '../sessionCutoff';

describe('isIssuedBeforeCutoff', () => {
  const cutoff = new Date('2026-10-07T12:00:00.000Z');

  it('never revokes when the user has no cut-off', () => {
    expect(isIssuedBeforeCutoff(0, null)).toBe(false);
    expect(isIssuedBeforeCutoff(undefined, null)).toBe(false);
    expect(isIssuedBeforeCutoff(undefined, undefined)).toBe(false);
  });

  it('revokes what was issued before the cut-off and keeps what was issued at or after it', () => {
    expect(isIssuedBeforeCutoff(cutoff.getTime() - 1, cutoff)).toBe(true);
    // AT the cut-off is valid: the replacement session is minted in the same
    // second, and a JWT's iat cannot say which half of it.
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
  it('floors to the second, so a token minted later in that second survives its own cut-off', () => {
    const now = Date.parse('2026-10-07T12:00:00.750Z');
    const cutoff = cutoffForNow(now);

    expect(cutoff.toISOString()).toBe('2026-10-07T12:00:00.000Z');

    // What jsonwebtoken would stamp on a token signed at `now`.
    const iatMs = Math.floor(now / 1000) * 1000;
    expect(isIssuedBeforeCutoff(iatMs, cutoff)).toBe(false);

    // A millisecond cut-off - the obvious implementation - would have
    // revoked that very token.
    expect(isIssuedBeforeCutoff(iatMs, new Date(now))).toBe(true);
  });

  it('still revokes a token from the previous second', () => {
    const now = Date.parse('2026-10-07T12:00:00.750Z');
    expect(
      isIssuedBeforeCutoff(
        Date.parse('2026-10-07T11:59:59.000Z'),
        cutoffForNow(now)
      )
    ).toBe(true);
  });
});
