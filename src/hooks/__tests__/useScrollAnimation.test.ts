/**
 * Behavioral tests for useScrollAnimation
 *
 * The hook:
 *  1. Creates an IntersectionObserver with the given (or default) options
 *  2. Observes all elements matching `selector` in the DOM
 *  3. Adds the 'active' class to each element when it intersects
 *  4. Cleans up (unobserves all elements) on unmount
 *  5. Falls back to adding 'active' immediately when IntersectionObserver is unavailable
 *  6. Falls back to adding 'active' immediately when IntersectionObserver constructor throws
 *
 * The global setup already mocks IntersectionObserver as a vi.fn() that returns
 * { observe, unobserve, disconnect }. We override it per-test group to control
 * when entries intersect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollAnimation } from '../useScrollAnimation';

// ---------------------------------------------------------------------------
// Helper: create a DOM element with the animate-on-scroll class and attach to body
// ---------------------------------------------------------------------------

function addAnimatableElements(count: number, selector = 'animate-on-scroll') {
  const elements: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = selector;
    document.body.appendChild(el);
    elements.push(el);
  }
  return elements;
}

function removeElements(elements: HTMLElement[]) {
  elements.forEach(el => el.parentNode?.removeChild(el));
}

describe('useScrollAnimation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Remove any leftover elements from previous test
    document
      .querySelectorAll('.animate-on-scroll, .custom-class')
      .forEach(el => el.parentNode?.removeChild(el));
  });

  afterEach(() => {
    document
      .querySelectorAll('.animate-on-scroll, .custom-class')
      .forEach(el => el.parentNode?.removeChild(el));
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Observer is set up
  // -----------------------------------------------------------------------

  it('creates an IntersectionObserver when rendered', () => {
    const ObserverMock = vi.fn().mockReturnValue({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    renderHook(() => useScrollAnimation());

    expect(ObserverMock).toHaveBeenCalledTimes(1);
  });

  it('observes each matching element', () => {
    const observeMock = vi.fn();
    const ObserverMock = vi.fn().mockReturnValue({
      observe: observeMock,
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const elements = addAnimatableElements(3);

    renderHook(() => useScrollAnimation('.animate-on-scroll'));

    expect(observeMock).toHaveBeenCalledTimes(3);
    elements.forEach(el => {
      expect(observeMock).toHaveBeenCalledWith(el);
    });

    removeElements(elements);
  });

  // -----------------------------------------------------------------------
  // 'active' class is added on intersection
  // -----------------------------------------------------------------------

  it('adds "active" class to an element when it intersects', () => {
    let capturedCallback: IntersectionObserverCallback = () => undefined;

    const ObserverMock = vi
      .fn()
      .mockImplementation((cb: IntersectionObserverCallback) => {
        capturedCallback = cb;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const [el] = addAnimatableElements(1);

    renderHook(() => useScrollAnimation('.animate-on-scroll'));

    // Simulate the observer firing with isIntersecting = true
    capturedCallback(
      [{ target: el, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(el.classList.contains('active')).toBe(true);

    removeElements([el]);
  });

  it('does NOT add "active" class when isIntersecting is false', () => {
    let capturedCallback: IntersectionObserverCallback = () => undefined;

    const ObserverMock = vi
      .fn()
      .mockImplementation((cb: IntersectionObserverCallback) => {
        capturedCallback = cb;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const [el] = addAnimatableElements(1);

    renderHook(() => useScrollAnimation('.animate-on-scroll'));

    capturedCallback(
      [{ target: el, isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(el.classList.contains('active')).toBe(false);

    removeElements([el]);
  });

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------

  it('unobserves all elements on unmount', () => {
    const unobserveMock = vi.fn();
    const ObserverMock = vi.fn().mockReturnValue({
      observe: vi.fn(),
      unobserve: unobserveMock,
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const elements = addAnimatableElements(2);

    const { unmount } = renderHook(() =>
      useScrollAnimation('.animate-on-scroll')
    );

    unmount();

    expect(unobserveMock).toHaveBeenCalledTimes(2);
    elements.forEach(el => {
      expect(unobserveMock).toHaveBeenCalledWith(el);
    });

    removeElements(elements);
  });

  // -----------------------------------------------------------------------
  // Default vs custom options
  // -----------------------------------------------------------------------

  it('passes default options { threshold:0.1, rootMargin:"0px 0px -100px 0px" } to IntersectionObserver', () => {
    const ObserverMock = vi.fn().mockReturnValue({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    renderHook(() => useScrollAnimation());

    expect(ObserverMock).toHaveBeenCalledWith(expect.any(Function), {
      threshold: 0.1,
      rootMargin: '0px 0px -100px 0px',
    });
  });

  it('passes custom options when provided', () => {
    const ObserverMock = vi.fn().mockReturnValue({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const customOptions = { threshold: 0.5, rootMargin: '10px' };
    renderHook(() => useScrollAnimation('.animate-on-scroll', customOptions));

    expect(ObserverMock).toHaveBeenCalledWith(
      expect.any(Function),
      customOptions
    );
  });

  // -----------------------------------------------------------------------
  // Fallback when IntersectionObserver is unavailable
  // -----------------------------------------------------------------------

  it('immediately adds "active" to all matching elements when IntersectionObserver is undefined', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const elements = addAnimatableElements(2);

    renderHook(() => useScrollAnimation('.animate-on-scroll'));

    elements.forEach(el => {
      expect(el.classList.contains('active')).toBe(true);
    });

    removeElements(elements);
  });

  // -----------------------------------------------------------------------
  // Error fallback
  // -----------------------------------------------------------------------

  it('immediately adds "active" to all matching elements when IntersectionObserver constructor throws', () => {
    const ObserverMock = vi.fn().mockImplementation(() => {
      throw new Error('Not supported');
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const elements = addAnimatableElements(2);

    renderHook(() => useScrollAnimation('.animate-on-scroll'));

    elements.forEach(el => {
      expect(el.classList.contains('active')).toBe(true);
    });

    removeElements(elements);
  });

  // -----------------------------------------------------------------------
  // Custom selector
  // -----------------------------------------------------------------------

  it('observes only elements matching the custom selector', () => {
    const observeMock = vi.fn();
    const ObserverMock = vi.fn().mockReturnValue({
      observe: observeMock,
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal('IntersectionObserver', ObserverMock);

    const matching = addAnimatableElements(1, 'custom-class');
    const nonMatching = addAnimatableElements(2, 'animate-on-scroll');

    renderHook(() => useScrollAnimation('.custom-class'));

    // Only the one matching element should be observed
    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(observeMock).toHaveBeenCalledWith(matching[0]);

    removeElements([...matching, ...nonMatching]);
  });
});
