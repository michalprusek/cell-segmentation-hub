import { describe, it, expect, vi } from 'vitest';
import {
  WHEEL_NOTCH_PX,
  createWheelZoomAccumulator,
  normalizedWheelDelta,
  wheelZoomFactor,
} from '../wheelZoom';

const px = (deltaY: number, ctrlKey = false) => ({
  deltaY,
  deltaMode: 0,
  ctrlKey,
});

describe('wheelZoomFactor', () => {
  it('is exactly the documented 1.2x for one mouse notch', () => {
    expect(wheelZoomFactor(px(-WHEEL_NOTCH_PX), 1.2)).toBeCloseTo(1.2, 12);
    expect(wheelZoomFactor(px(WHEEL_NOTCH_PX), 1.2)).toBeCloseTo(1 / 1.2, 12);
  });

  it('is exponential in the delta: half a notch twice is one notch', () => {
    const half = wheelZoomFactor(px(-50), 1.2);
    expect(half).toBeCloseTo(Math.sqrt(1.2), 12);
    expect(half * half).toBeCloseTo(1.2, 12);
  });

  it('gives a trackpad delta a proportionally small step, not a full notch', () => {
    // The old handler used only the sign: this was 1.2.
    expect(wheelZoomFactor(px(-4), 1.2)).toBeCloseTo(1.2 ** 0.04, 12);
    expect(wheelZoomFactor(px(-4), 1.2)).toBeLessThan(1.01);
  });

  it('clamps one event to one notch either way', () => {
    expect(wheelZoomFactor(px(-120), 1.2)).toBeCloseTo(1.2, 12);
    expect(wheelZoomFactor(px(-5000), 1.2)).toBeCloseTo(1.2, 12);
    expect(wheelZoomFactor(px(5000), 1.2)).toBeCloseTo(1 / 1.2, 12);
  });

  it('reads a Firefox line-mode notch (3 lines) as one notch', () => {
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 }, 1.2)).toBeCloseTo(
      1.2,
      12
    );
    expect(normalizedWheelDelta({ deltaY: 1, deltaMode: 1 })).toBeCloseTo(
      WHEEL_NOTCH_PX / 3,
      12
    );
  });

  it('reads a page-mode event (deltaMode 2) as 800 px a page', () => {
    // A whole page either way is far past the clamp: one notch.
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2 }, 1.2)).toBeCloseTo(
      1.2,
      12
    );
    expect(normalizedWheelDelta({ deltaY: 1, deltaMode: 2 })).toBe(
      WHEEL_NOTCH_PX
    );
    // Below the clamp the unit itself shows: a twentieth of a page is 40 px.
    expect(normalizedWheelDelta({ deltaY: 0.05, deltaMode: 2 })).toBeCloseTo(
      40,
      12
    );
  });

  it('amplifies a pinch (ctrlKey) tenfold, still clamped', () => {
    expect(normalizedWheelDelta(px(-2, true))).toBe(-20);
    expect(normalizedWheelDelta(px(-50, true))).toBe(-WHEEL_NOTCH_PX);
  });

  it('does nothing for a zero or non-finite delta', () => {
    expect(wheelZoomFactor(px(0), 1.2)).toBe(1);
    expect(wheelZoomFactor(px(NaN), 1.2)).toBe(1);
  });
});

/** A hand-cranked frame scheduler: nothing runs until `frame()`. */
function manualFrames() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    schedule: (cb: () => void) => {
      pending.set(next, cb);
      return next++;
    },
    unschedule: (id: number) => {
      pending.delete(id);
    },
    frame: () => {
      const run = [...pending.values()];
      pending.clear();
      run.forEach(cb => cb());
    },
    get size() {
      return pending.size;
    },
  };
}

describe('createWheelZoomAccumulator', () => {
  it('applies the PRODUCT of every event of one frame, at the newest anchor', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<{ x: number }>(
      apply,
      frames.schedule,
      frames.unschedule
    );

    acc.push(1.2, { x: 1 });
    acc.push(1.2, { x: 2 });
    expect(apply).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    frames.frame();
    expect(apply).toHaveBeenCalledTimes(1);
    // rafThrottle kept only the last event: this was 1.2.
    expect(apply.mock.calls[0][0]).toBeCloseTo(1.44, 12);
    expect(apply.mock.calls[0][1]).toEqual({ x: 2 });
  });

  it('delivers the trailing event of a burst whatever the frame spacing', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<number>(
      apply,
      frames.schedule,
      frames.unschedule
    );

    // Three events, one per (arbitrarily short) frame — a 120 Hz display.
    for (const anchor of [1, 2, 3]) {
      acc.push(1.2, anchor);
      frames.frame();
    }
    expect(apply.mock.calls.map(c => c[1])).toEqual([1, 2, 3]);
    expect(frames.size).toBe(0);
  });

  it('starts each frame from 1, not from the previous frame', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<number>(
      apply,
      frames.schedule,
      frames.unschedule
    );
    acc.push(1.2, 0);
    frames.frame();
    acc.push(1.2, 0);
    frames.frame();
    expect(apply.mock.calls.map(c => c[0])).toEqual([1.2, 1.2]);
  });

  it('skips the apply when a frame nets out to no zoom', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<number>(
      apply,
      frames.schedule,
      frames.unschedule
    );
    acc.push(2, 0);
    acc.push(0.5, 0);
    frames.frame();
    expect(apply).not.toHaveBeenCalled();
  });

  it('ignores a factor that would corrupt the product', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<number>(
      apply,
      frames.schedule,
      frames.unschedule
    );
    acc.push(NaN, 0);
    acc.push(0, 0);
    acc.push(-1, 0);
    expect(frames.size).toBe(0);
    acc.push(1.2, 7);
    frames.frame();
    expect(apply).toHaveBeenCalledWith(1.2, 7);
  });

  it('cancel drops the pending frame and what it had accumulated', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const acc = createWheelZoomAccumulator<number>(
      apply,
      frames.schedule,
      frames.unschedule
    );
    acc.push(1.2, 0);
    acc.cancel();
    expect(frames.size).toBe(0);
    acc.push(1.5, 1);
    frames.frame();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(1.5, 1);
  });
});
