/**
 * Behavioral tests for useActiveSection
 *
 * The hook:
 *  1. Initialises activeSection to sectionIds[0] (or '' when array is empty)
 *  2. Adds a scroll event listener on mount; removes it on unmount
 *  3. handleScroll selects the LAST section whose offsetTop <= window.scrollY + 100
 *  4. scrollToSection calls window.scrollTo targeting offsetTop - 120
 *  5. scrollToSection is a no-op for an unknown sectionId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveSection } from '../useActiveSection';

// ---------------------------------------------------------------------------
// Helpers: build fake DOM sections with controlled offsetTop values
// ---------------------------------------------------------------------------

function addSection(id: string, offsetTop: number): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  Object.defineProperty(el, 'offsetTop', {
    value: offsetTop,
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
}

function removeSection(id: string) {
  document.getElementById(id)?.remove();
}

describe('useActiveSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset scroll position
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    ['sec-a', 'sec-b', 'sec-c', 'sec-d', 'sec-x'].forEach(removeSection);
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('initialises activeSection to the first sectionId', () => {
    addSection('sec-a', 0);
    addSection('sec-b', 500);

    const { result } = renderHook(() => useActiveSection(['sec-a', 'sec-b']));

    expect(result.current.activeSection).toBe('sec-a');
  });

  it('initialises activeSection to "" when sectionIds is empty', () => {
    const { result } = renderHook(() => useActiveSection([]));
    expect(result.current.activeSection).toBe('');
  });

  // -----------------------------------------------------------------------
  // Scroll listener registration / cleanup
  // -----------------------------------------------------------------------

  it('adds a scroll listener on mount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useActiveSection(['sec-a']));

    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), {
      passive: true,
    });
  });

  it('removes the scroll listener on unmount', () => {
    addSection('sec-a', 0);
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useActiveSection(['sec-a']));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  // -----------------------------------------------------------------------
  // handleScroll — section selection logic
  // -----------------------------------------------------------------------

  it('selects sec-a when scrollY is 0 (both sections above 0+100)', () => {
    addSection('sec-a', 0); // offsetTop 0 ≤ 100 ✓
    addSection('sec-b', 500); // offsetTop 500 > 100 ✗

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    const { result } = renderHook(() => useActiveSection(['sec-a', 'sec-b']));

    // handleScroll runs on mount via the effect; sec-a is the last one ≤ scrollY+100=100
    expect(result.current.activeSection).toBe('sec-a');
  });

  it('changes activeSection when scroll passes a section boundary', () => {
    addSection('sec-a', 0);
    addSection('sec-b', 400);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    const { result } = renderHook(() => useActiveSection(['sec-a', 'sec-b']));

    // Simulate scrolling past sec-b: scrollY=350, scrollY+100=450 > sec-b.offsetTop=400
    act(() => {
      Object.defineProperty(window, 'scrollY', {
        value: 350,
        configurable: true,
      });
      window.dispatchEvent(new Event('scroll'));
    });

    expect(result.current.activeSection).toBe('sec-b');
  });

  it('stays on the last section when scrolled past all sections', () => {
    addSection('sec-a', 0);
    addSection('sec-b', 200);
    addSection('sec-c', 400);

    Object.defineProperty(window, 'scrollY', {
      value: 1000,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useActiveSection(['sec-a', 'sec-b', 'sec-c'])
    );

    // All three sections are ≤ 1100; the last one wins
    expect(result.current.activeSection).toBe('sec-c');
  });

  it('stays on the first section when scroll is before all sections', () => {
    addSection('sec-a', 500);
    addSection('sec-b', 800);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    const { result } = renderHook(() => useActiveSection(['sec-a', 'sec-b']));

    // scrollY+100=100; sec-a.offsetTop=500 > 100 → no section passes the check
    // Loop never updates currentSection beyond initial 'sec-a'
    expect(result.current.activeSection).toBe('sec-a');
  });

  it('handles sections whose DOM element does not exist (returns to first)', () => {
    // Only sec-a exists in the DOM; sec-ghost does not
    addSection('sec-a', 0);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    const { result } = renderHook(() =>
      useActiveSection(['sec-a', 'sec-ghost'])
    );

    // null elements are filtered out; sec-a is still found
    expect(result.current.activeSection).toBe('sec-a');
  });

  // -----------------------------------------------------------------------
  // scrollToSection
  // -----------------------------------------------------------------------

  it('scrollToSection calls window.scrollTo with offsetTop - 120', () => {
    addSection('sec-d', 600);

    const { result } = renderHook(() => useActiveSection(['sec-d']));

    act(() => {
      result.current.scrollToSection('sec-d');
    });

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 600 - 120,
      behavior: 'smooth',
    });
  });

  it('scrollToSection is a no-op for an unknown sectionId', () => {
    const { result } = renderHook(() => useActiveSection(['sec-a']));

    act(() => {
      result.current.scrollToSection('does-not-exist');
    });

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
