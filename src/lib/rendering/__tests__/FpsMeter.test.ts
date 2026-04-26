import { afterEach, describe, expect, it, vi } from 'vitest';
import { FpsSampler, isFpsOverlayEnabled } from '../FpsMeter';

describe('FpsSampler', () => {
  it('reports 0 fps before any frames are recorded', () => {
    const s = new FpsSampler();
    expect(s.fps).toBe(0);
    expect(s.frameCount).toBe(0);
  });

  it('reports 0 fps after a single frame (needs at least two samples)', () => {
    const s = new FpsSampler();
    s.record(100);
    expect(s.fps).toBe(0);
  });

  it('computes fps across the trailing window', () => {
    const s = new FpsSampler(1000);
    // 61 frames spaced 16.67ms apart (≈60fps over 1 second)
    let t = 0;
    for (let i = 0; i < 61; i++) {
      s.record(t);
      t += 1000 / 60;
    }
    expect(s.fps).toBeGreaterThan(55);
    expect(s.fps).toBeLessThan(65);
  });

  it('drops samples older than the window', () => {
    const s = new FpsSampler(1000);
    // 10 frames early
    for (let i = 0; i < 10; i++) s.record(i * 10);
    // 2 frames much later (outside the 1s window)
    s.record(5000);
    s.record(5016);
    expect(s.frameCount).toBe(2);
  });

  it('reset clears all samples', () => {
    const s = new FpsSampler();
    s.record(10);
    s.record(20);
    s.reset();
    expect(s.frameCount).toBe(0);
    expect(s.fps).toBe(0);
  });
});

describe('isFpsOverlayEnabled', () => {
  // The global test setup (src/test/setup.ts) mocks localStorage with
  // hardcoded return values for 'theme' and 'language' only — setItem
  // does not persist. Tests mock getItem directly per scenario.

  const stubLocation = (search: string) => {
    vi.spyOn(window, 'location', 'get').mockImplementation(
      () => ({ search }) as Location
    );
  };

  const stubLocalStorageReturn = (value: string | null) => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(key =>
      key === 'segPerfOverlay' ? value : null
    );
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false with no flag set and empty search', () => {
    stubLocation('');
    stubLocalStorageReturn(null);
    expect(isFpsOverlayEnabled()).toBe(false);
  });

  it('returns true when ?perf=1 is present', () => {
    stubLocation('?perf=1');
    stubLocalStorageReturn(null);
    expect(isFpsOverlayEnabled()).toBe(true);
  });

  it('returns false when ?perf=0', () => {
    stubLocation('?perf=0');
    stubLocalStorageReturn(null);
    expect(isFpsOverlayEnabled()).toBe(false);
  });

  it('returns true when localStorage.segPerfOverlay = 1 (and no ?perf flag)', () => {
    stubLocation('');
    stubLocalStorageReturn('1');
    expect(isFpsOverlayEnabled()).toBe(true);
  });

  it('swallows thrown storage errors and returns false', () => {
    stubLocation('');
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(isFpsOverlayEnabled()).toBe(false);
  });
});
