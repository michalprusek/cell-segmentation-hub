import { describe, it, expect, vi, afterEach } from 'vitest';
import { mintTrackId } from '../mintTrackId';

// The id must be indistinguishable from one the server mints
// (`mt_<8 hex>` in `propagateTracksGeometryForward`).
const SERVER_SHAPE = /^mt_[0-9a-f]{8}$/;

describe('mintTrackId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes the first 8 hex digits of a UUID, dashes removed', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b',
    });
    expect(mintTrackId()).toBe('mt_1a2b3c4d');
  });

  it('keeps the same shape without crypto.randomUUID, and does not repeat', () => {
    vi.stubGlobal('crypto', {});
    const ids = Array.from({ length: 200 }, mintTrackId);
    for (const id of ids) {
      expect(id).toMatch(SERVER_SHAPE);
    }
    expect(new Set(ids).size).toBeGreaterThan(190);
  });
});
