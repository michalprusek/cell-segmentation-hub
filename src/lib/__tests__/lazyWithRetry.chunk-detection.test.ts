import { describe, it, expect } from 'vitest';

// Mirror of the chunk-failure detection in lazyWithRetry.tsx — keeps the
// test isolated from React. Kept in sync with the implementation.
function isChunkLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to import')
  );
}

describe('lazyWithRetry chunk-load detection', () => {
  // Each browser surfaces the same underlying "chunk not on CDN anymore"
  // case with its own error string. If detection misses ANY of them, the
  // user is stuck on a blank screen forever after a deploy.
  it('matches Chrome wording', () => {
    expect(
      isChunkLoadFailure(
        new Error(
          'Failed to fetch dynamically imported module: https://x/assets/SignIn-X.js'
        )
      )
    ).toBe(true);
  });

  it('matches Firefox wording (this PR adds it)', () => {
    expect(
      isChunkLoadFailure(
        new Error(
          'error loading dynamically imported module: https://x/assets/SignIn-X.js'
        )
      )
    ).toBe(true);
  });

  it('matches Safari wording (this PR adds it)', () => {
    expect(
      isChunkLoadFailure(new Error('Importing a module script failed.'))
    ).toBe(true);
  });

  it('matches Webpack-style ChunkLoadError', () => {
    expect(isChunkLoadFailure(new Error('ChunkLoadError'))).toBe(true);
  });

  it('matches "Loading chunk N failed"', () => {
    expect(isChunkLoadFailure(new Error('Loading chunk 42 failed'))).toBe(true);
  });

  it('does NOT match unrelated errors', () => {
    expect(
      isChunkLoadFailure(new Error('TypeError: x is not a function'))
    ).toBe(false);
    expect(isChunkLoadFailure(new Error('NetworkError'))).toBe(false);
    expect(isChunkLoadFailure(null)).toBe(false);
    expect(isChunkLoadFailure(undefined)).toBe(false);
    expect(isChunkLoadFailure('a string, not an Error')).toBe(false);
  });
});
