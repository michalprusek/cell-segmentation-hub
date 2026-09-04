/**
 * Behavioral unit tests for ImageDisplayProvider + useImageDisplay hook.
 *
 * Strategy:
 * - Render the provider directly with a thin wrapper; consume the hook.
 * - The provider is self-contained (no external context deps).
 * - localStorage is already mocked by src/test/setup.ts. We wire the mock
 *   to an in-memory store so persistence tests work reliably.
 * - Pixel-level window/level remapping lives in MultiChannelCanvas (which
 *   needs a real 2-D pipeline jsdom lacks); here we only cover the state
 *   machine, including reportChannelRanges's ImageJ-style per-channel
 *   auto-scale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import { ImageDisplayProvider, useImageDisplay } from '../ImageDisplayContext';

// ---------------------------------------------------------------------------
// localStorage in-memory store (the global mock is already installed by
// src/test/setup.ts; we just wire it to a real store object here).
// ---------------------------------------------------------------------------

let store: Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  vi.mocked(localStorage.getItem).mockImplementation(k => store[k] ?? null);
  vi.mocked(localStorage.setItem).mockImplementation(
    (k, v) => void (store[k] = String(v))
  );
  vi.mocked(localStorage.removeItem).mockImplementation(k => {
    delete store[k];
  });
});

// ---------------------------------------------------------------------------
// Wrapper helpers
// ---------------------------------------------------------------------------

function makeWrapper(
  opts: { initialChannel?: string | null; userId?: string } = {}
): React.FC<{ children: React.ReactNode }> {
  return ({ children }) =>
    React.createElement(
      ImageDisplayProvider,
      {
        initialChannel: opts.initialChannel ?? null,
        userId: opts.userId,
      },
      children
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageDisplayProvider + useImageDisplay', () => {
  // ---- default state -------------------------------------------------------

  describe('default state', () => {
    it('provides the default values on first render', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      expect(result.current.frameIndex).toBeUndefined();
      expect(result.current.channel).toBeNull();
      expect(result.current.visibleChannels).toEqual([]);
      expect(result.current.channelColors).toEqual({});
      expect(result.current.channelOpacities).toEqual({});
      expect(result.current.windowMin).toBe(0);
      expect(result.current.windowMax).toBe(255);
      expect(result.current.windowRangeMax).toBe(255);
      expect(result.current.channelWindows['']?.dataMin).toBe(0);
      expect(result.current.brightness).toBe(100);
      expect(result.current.contrast).toBe(100);
    });

    it('accepts initialChannel prop and surfaces it as channel', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ initialChannel: 'DAPI' }),
      });

      expect(result.current.channel).toBe('DAPI');
    });
  });

  // ---- throws without provider --------------------------------------------

  describe('usage without provider', () => {
    it('throws when used outside ImageDisplayProvider', () => {
      // Suppress the expected error from React's error boundary
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useImageDisplay())).toThrow(
        'useImageDisplay must be used inside <ImageDisplayProvider>'
      );
      spy.mockRestore();
    });
  });

  // ---- frameIndex ----------------------------------------------------------

  describe('setFrameIndex', () => {
    it('updates frameIndex', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setFrameIndex(5);
      });

      expect(result.current.frameIndex).toBe(5);
    });

    it('does NOT reset window/brightness when frame changes', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(50, 200);
        result.current.setBrightness(130);
        result.current.setContrast(80);
      });

      act(() => {
        result.current.setFrameIndex(3);
      });

      expect(result.current.windowMin).toBe(50);
      expect(result.current.windowMax).toBe(200);
      expect(result.current.brightness).toBe(130);
      expect(result.current.contrast).toBe(80);
    });
  });

  // ---- channel -------------------------------------------------------------

  describe('setChannel', () => {
    it('updates channel', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannel('GFP');
      });

      expect(result.current.channel).toBe('GFP');
    });

    it('accepts null to clear channel', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ initialChannel: 'DAPI' }),
      });

      act(() => {
        result.current.setChannel(null);
      });

      expect(result.current.channel).toBeNull();
    });
  });

  // ---- channel visibility toggling ----------------------------------------

  describe('toggleChannelVisibility', () => {
    it('adds a channel when not visible', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.toggleChannelVisibility('ch0');
      });

      expect(result.current.visibleChannels).toContain('ch0');
    });

    it('removes a channel that is already visible', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setVisibleChannels(['ch0', 'ch1']);
      });

      act(() => {
        result.current.toggleChannelVisibility('ch0');
      });

      expect(result.current.visibleChannels).not.toContain('ch0');
      expect(result.current.visibleChannels).toContain('ch1');
    });

    it('toggles a channel on and off correctly', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.toggleChannelVisibility('ch0');
      });
      expect(result.current.visibleChannels).toContain('ch0');

      act(() => {
        result.current.toggleChannelVisibility('ch0');
      });
      expect(result.current.visibleChannels).not.toContain('ch0');
    });
  });

  // ---- setVisibleChannels -------------------------------------------------

  describe('setVisibleChannels', () => {
    it('replaces the entire visible-channel list', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setVisibleChannels(['a', 'b', 'c']);
      });

      expect(result.current.visibleChannels).toEqual(['a', 'b', 'c']);
    });
  });

  // ---- channel colors ------------------------------------------------------

  describe('setChannelColor', () => {
    it('stores the hex color for the given channel', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelColor('ch0', '#FF0000');
      });

      expect(result.current.channelColors['ch0']).toBe('#FF0000');
    });

    it('can set colors for multiple channels independently', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelColor('ch0', '#FF0000');
        result.current.setChannelColor('ch1', '#00FF00');
      });

      expect(result.current.channelColors['ch0']).toBe('#FF0000');
      expect(result.current.channelColors['ch1']).toBe('#00FF00');
    });
  });

  // ---- seedChannelColors + re-hydrate precedence (colour-reset race fix) ---

  describe('seedChannelColors', () => {
    it('fills only empty colour slots and never overwrites an existing colour', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelColor('ch0', '#FF0000'); // user picks red
        result.current.seedChannelColors({ ch0: '#111111', ch1: '#00FF00' });
      });

      // ch0 already set → seed leaves it; ch1 empty → seed fills it.
      expect(result.current.channelColors['ch0']).toBe('#FF0000');
      expect(result.current.channelColors['ch1']).toBe('#00FF00');
    });

    it('a persisted colour beats a metadata seed that raced ahead of auth', () => {
      // User's saved pref for ch0 from a prior session.
      store['spheroseg.channelColors.race-user'] = JSON.stringify({
        ch0: '#AA0000',
      });

      let raceUserId: string | undefined;
      const RaceWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          ImageDisplayProvider,
          { userId: raceUserId },
          children
        );

      const { result, rerender } = renderHook(() => useImageDisplay(), {
        wrapper: RaceWrapper,
      });

      // Race: channel metadata seeds a default BEFORE auth resolves userId.
      act(() => {
        result.current.seedChannelColors({ ch0: '#00FF00' });
      });
      expect(result.current.channelColors['ch0']).toBe('#00FF00');

      // Auth lands → re-hydrate merge runs. The persisted red must win over
      // the seeded green (the bug was the seed clobbering the saved colour).
      act(() => {
        raceUserId = 'race-user';
        rerender();
      });
      expect(result.current.channelColors['ch0']).toBe('#AA0000');
    });

    it('a genuine session edit still beats the persisted colour on re-hydrate', () => {
      store['spheroseg.channelColors.race-user'] = JSON.stringify({
        ch0: '#AA0000',
      });

      let raceUserId: string | undefined;
      const RaceWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          ImageDisplayProvider,
          { userId: raceUserId },
          children
        );

      const { result, rerender } = renderHook(() => useImageDisplay(), {
        wrapper: RaceWrapper,
      });

      // User explicitly picks blue before auth resolves.
      act(() => {
        result.current.setChannelColor('ch0', '#0000FF');
      });

      act(() => {
        raceUserId = 'race-user';
        rerender();
      });
      // The session edit wins over the persisted red.
      expect(result.current.channelColors['ch0']).toBe('#0000FF');
    });

    it('a session edit after a seed still beats the persisted colour on re-hydrate', () => {
      store['spheroseg.channelColors.race-user'] = JSON.stringify({
        ch0: '#AA0000',
      });

      let raceUserId: string | undefined;
      const RaceWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          ImageDisplayProvider,
          { userId: raceUserId },
          children
        );

      const { result, rerender } = renderHook(() => useImageDisplay(), {
        wrapper: RaceWrapper,
      });

      // Seed a default first, THEN the user recolours the same channel.
      act(() => {
        result.current.seedChannelColors({ ch0: '#00FF00' });
        result.current.setChannelColor('ch0', '#0000FF');
      });

      act(() => {
        raceUserId = 'race-user';
        rerender();
      });
      // A genuine edit (even after a prior seed) still outranks persisted.
      expect(result.current.channelColors['ch0']).toBe('#0000FF');
    });

    it('a seeded colour survives re-hydrate when the user has no saved pref', () => {
      // No persisted pref for ch0 — the closest analogue to the original
      // "colours reset" bug; a naive reset-to-persisted would blank it.
      let raceUserId: string | undefined;
      const RaceWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          ImageDisplayProvider,
          { userId: raceUserId },
          children
        );

      const { result, rerender } = renderHook(() => useImageDisplay(), {
        wrapper: RaceWrapper,
      });

      act(() => {
        result.current.seedChannelColors({ ch0: '#00FF00' });
      });

      act(() => {
        raceUserId = 'race-user';
        rerender();
      });
      expect(result.current.channelColors['ch0']).toBe('#00FF00');
    });
  });

  // ---- channel opacities --------------------------------------------------

  describe('setChannelOpacity', () => {
    it('stores opacity for a channel', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelOpacity('ch0', 75);
      });

      expect(result.current.channelOpacities['ch0']).toBe(75);
    });

    it('clamps opacity to 0', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelOpacity('ch0', -10);
      });

      expect(result.current.channelOpacities['ch0']).toBe(0);
    });

    it('clamps opacity to 100', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelOpacity('ch0', 150);
      });

      expect(result.current.channelOpacities['ch0']).toBe(100);
    });

    it('rounds fractional opacity values', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setChannelOpacity('ch0', 50.7);
      });

      expect(Number.isInteger(result.current.channelOpacities['ch0'])).toBe(
        true
      );
    });
  });

  // ---- window level --------------------------------------------------------

  describe('setWindow / setWindowMin / setWindowMax', () => {
    it('setWindow updates both min and max', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(30, 220);
      });

      expect(result.current.windowMin).toBe(30);
      expect(result.current.windowMax).toBe(220);
    });

    it('setWindow clamps values to [0, 255]', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(-10, 300);
      });

      expect(result.current.windowMin).toBe(0);
      expect(result.current.windowMax).toBe(255);
    });

    it('setWindowMin does not exceed current max', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(0, 100);
        result.current.setWindowMin(150); // above max
      });

      // Implementation clamps min to Math.min(150, max) = 100 → clamped to 100
      expect(result.current.windowMin).toBeLessThanOrEqual(
        result.current.windowMax
      );
    });

    it('setWindowMax does not go below current min', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(100, 200);
        result.current.setWindowMax(50); // below min
      });

      expect(result.current.windowMax).toBeGreaterThanOrEqual(
        result.current.windowMin
      );
    });
  });

  // ---- brightness / contrast -----------------------------------------------

  describe('setBrightness / setContrast', () => {
    it('setBrightness updates brightness value', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setBrightness(150);
      });

      expect(result.current.brightness).toBe(150);
    });

    it('setBrightness clamps to [0, 200]', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setBrightness(300);
      });
      expect(result.current.brightness).toBe(200);

      act(() => {
        result.current.setBrightness(-5);
      });
      expect(result.current.brightness).toBe(0);
    });

    it('setContrast updates contrast value', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setContrast(50);
      });

      expect(result.current.contrast).toBe(50);
    });

    it('setContrast clamps to [0, 200]', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setContrast(999);
      });
      expect(result.current.contrast).toBe(200);
    });
  });

  // ---- reset helpers -------------------------------------------------------

  describe('reset helpers', () => {
    it('resetWindow restores windowMin=0 and windowMax=255', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(50, 200);
      });
      act(() => {
        result.current.resetWindow();
      });

      expect(result.current.windowMin).toBe(0);
      expect(result.current.windowMax).toBe(255);
    });

    it('resetBrightnessContrast restores brightness=100 and contrast=100', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setBrightness(50);
        result.current.setContrast(180);
      });
      act(() => {
        result.current.resetBrightnessContrast();
      });

      expect(result.current.brightness).toBe(100);
      expect(result.current.contrast).toBe(100);
    });

    it('resetDisplay resets window AND brightness/contrast together', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.setWindow(10, 240);
        result.current.setBrightness(50);
        result.current.setContrast(170);
      });
      act(() => {
        result.current.resetDisplay();
      });

      expect(result.current.windowMin).toBe(0);
      expect(result.current.windowMax).toBe(255);
      expect(result.current.brightness).toBe(100);
      expect(result.current.contrast).toBe(100);
    });

    it('resetDisplay does NOT reset channel or visibleChannels', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ initialChannel: 'DAPI' }),
      });

      act(() => {
        result.current.setVisibleChannels(['DAPI', 'GFP']);
      });
      act(() => {
        result.current.resetDisplay();
      });

      expect(result.current.channel).toBe('DAPI');
      expect(result.current.visibleChannels).toEqual(['DAPI', 'GFP']);
    });
  });

  // ---- localStorage persistence -------------------------------------------

  describe('localStorage persistence', () => {
    it('writes channelColors to localStorage when userId is provided', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ userId: 'u1' }),
      });

      act(() => {
        result.current.setChannelColor('ch0', '#AABBCC');
      });

      const key = 'spheroseg.channelColors.u1';
      expect(localStorage.setItem).toHaveBeenCalledWith(
        key,
        expect.stringContaining('#AABBCC')
      );
    });

    it('writes channelOpacities to localStorage when userId is provided', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ userId: 'u1' }),
      });

      act(() => {
        result.current.setChannelOpacity('ch0', 42);
      });

      const key = 'spheroseg.channelOpacities.u1';
      expect(localStorage.setItem).toHaveBeenCalledWith(
        key,
        expect.stringContaining('42')
      );
    });

    it('hydrates channelColors from localStorage on mount when userId provided', () => {
      store['spheroseg.channelColors.u2'] = JSON.stringify({ ch0: '#112233' });

      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ userId: 'u2' }),
      });

      expect(result.current.channelColors['ch0']).toBe('#112233');
    });

    it('hydrates channelOpacities from localStorage on mount when userId provided', () => {
      store['spheroseg.channelOpacities.u2'] = JSON.stringify({ ch1: 60 });

      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper({ userId: 'u2' }),
      });

      expect(result.current.channelOpacities['ch1']).toBe(60);
    });

    it('does NOT write to localStorage when no userId is provided', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(), // no userId
      });

      act(() => {
        result.current.setChannelColor('ch0', '#FF0000');
      });

      expect(localStorage.setItem).not.toHaveBeenCalledWith(
        expect.stringContaining('spheroseg.channelColors'),
        expect.anything()
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Per-channel window/level (ImageJ composite semantics)
//
// Marika, 2026-08-24: "Model segments MTs where there is nothing". The model was
// right; the DISPLAY was wrong. One window fitted to the UNION of every visible
// channel's range meant an IRM channel spanning 2941..4145 was shown through a
// 489..53927 window opened by the TIRF channels — 2 % of the range — so the
// microtubules under the polylines were invisible. Each channel must be windowed
// by its OWN data.
// ---------------------------------------------------------------------------

describe('per-channel window/level', () => {
  const ranges = {
    WD_LED_IRM: { min: 2941, max: 4145 },
    TIRF_491: { min: 489, max: 53927 },
  };

  it('auto-fits every channel to its own range, not to the union', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.reportChannelRanges(ranges, 'container-1');
    });

    expect(result.current.channelWindows.WD_LED_IRM).toEqual({
      min: 2941,
      max: 4145,
      rangeMax: 4145,
      dataMin: 2941,
      // Set by a report: these windows came from decoded frames, not from
      // the 8-bit placeholder. The sidebar shows Min/Max only when it is true.
      measured: true,
    });
    expect(result.current.channelWindows.TIRF_491).toEqual({
      min: 489,
      max: 53927,
      rangeMax: 53927,
      dataMin: 489,
      // Set by a report: these windows came from decoded frames, not from
      // the 8-bit placeholder. The sidebar shows Min/Max only when it is true.
      measured: true,
    });
  });

  it('exposes the ACTIVE channel through the scalar window fields', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
    });
    act(() => {
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });

    expect(result.current.windowMin).toBe(2941);
    expect(result.current.windowMax).toBe(4145);
    expect(result.current.windowRangeMax).toBe(4145);

    act(() => {
      result.current.setActiveWindowChannel('TIRF_491');
    });

    expect(result.current.windowMin).toBe(489);
    expect(result.current.windowMax).toBe(53927);
    expect(result.current.windowRangeMax).toBe(53927);
  });

  it('edits only the active channel; the others keep their own window', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindow(3000, 3800);
    });

    expect(result.current.channelWindows.WD_LED_IRM?.min).toBe(3000);
    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(3800);
    // Untouched — this is the whole point.
    expect(result.current.channelWindows.TIRF_491?.min).toBe(489);
    expect(result.current.channelWindows.TIRF_491?.max).toBe(53927);
  });

  it('clamps an edit to the ACTIVE channel bound, not to some global one', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindowMax(99999); // far past IRM's own ceiling
    });

    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(4145);
  });

  it('keeps a user window on a same-container scrub but widens that channel bound', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindow(3000, 3800);
    });
    act(() => {
      // Next frame of the same video: IRM a touch brighter and dimmer.
      result.current.reportChannelRanges(
        { WD_LED_IRM: { min: 2900, max: 4400 }, TIRF_491: ranges.TIRF_491 },
        'container-1'
      );
    });

    expect(result.current.channelWindows.WD_LED_IRM?.min).toBe(3000);
    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(3800);
    expect(result.current.channelWindows.WD_LED_IRM?.rangeMax).toBe(4400);
    expect(result.current.channelWindows.WD_LED_IRM?.dataMin).toBe(2900);
  });

  it('auto-fits a channel switched on mid-session without disturbing the others', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(
        { WD_LED_IRM: ranges.WD_LED_IRM },
        'container-1'
      );
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindow(3000, 3800);
    });
    act(() => {
      // User ticks TIRF_491 on. It is new, so it auto-fits; IRM must not move.
      result.current.reportChannelRanges(ranges, 'container-1');
    });

    expect(result.current.channelWindows.TIRF_491?.min).toBe(489);
    expect(result.current.channelWindows.TIRF_491?.max).toBe(53927);
    expect(result.current.channelWindows.WD_LED_IRM?.min).toBe(3000);
    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(3800);
  });

  it('re-fits everything when the container changes', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindow(3000, 3800);
    });
    act(() => {
      result.current.reportChannelRanges(
        { WD_LED_IRM: { min: 100, max: 900 } },
        'container-2'
      );
    });

    expect(result.current.channelWindows.WD_LED_IRM).toEqual({
      min: 100,
      max: 900,
      rangeMax: 900,
      dataMin: 100,
      // Set by a report: these windows came from decoded frames, not from
      // the 8-bit placeholder. The sidebar shows Min/Max only when it is true.
      measured: true,
    });
    // The old container's other channel is gone, not stale.
    expect(result.current.channelWindows.TIRF_491).toBeUndefined();
  });

  it('resetWindow re-fits EVERY channel to its own data range', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('WD_LED_IRM');
    });
    act(() => {
      result.current.setWindow(3000, 3800);
      result.current.setActiveWindowChannel('TIRF_491');
    });
    act(() => {
      result.current.setWindow(1000, 2000);
    });
    act(() => {
      result.current.resetWindow();
    });

    expect(result.current.channelWindows.WD_LED_IRM?.min).toBe(2941);
    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(4145);
    expect(result.current.channelWindows.TIRF_491?.min).toBe(489);
    expect(result.current.channelWindows.TIRF_491?.max).toBe(53927);
  });

  it('falls back to the pseudo-channel window when there are no channels', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    // A standalone (non-multi-channel) image reports nothing and shows no
    // channels, so the scalar fields describe the 8-bit fallback window.
    expect(result.current.activeWindowChannel).toBeNull();
    expect(result.current.windowChannel).toBe('');
    expect(result.current.windowMin).toBe(0);
    expect(result.current.windowMax).toBe(255);
    // ...and that window is a placeholder, not a measurement. The distinction
    // is not recoverable from the numbers: a 16-bit image topping out at 255
    // would look identical, which is why it is carried as its own bit.
    expect(result.current.windowIsMeasured).toBe(false);
  });

  it('marks the fallback window measured once a frame reports its range', () => {
    // A standalone 16-bit image reports through the same no-channel key, and
    // that is what makes the sidebar's Min/Max rows appear.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.reportChannelRanges(
        { '': { min: 13137, max: 26602 } },
        'image-1'
      );
    });

    expect(result.current.windowChannel).toBe('');
    expect(result.current.windowIsMeasured).toBe(true);
    expect(result.current.windowMin).toBe(13137);
    expect(result.current.windowMax).toBe(26602);
  });
});

describe('which channel the sliders act on', () => {
  it('defaults to the segmentation source, not to the first channel', () => {
    // Marika's container lists IRM first, but the rule has to hold when it does
    // not: the segmentation source is the channel the model ran on, so it is the
    // one whose window decides whether the user can see what was segmented.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['TIRF_491', 'WD_LED_IRM']);
      result.current.setChannel('WD_LED_IRM'); // isSegmentationSource
      result.current.reportChannelRanges(
        {
          TIRF_491: { min: 489, max: 53927 },
          WD_LED_IRM: { min: 2941, max: 4145 },
        },
        'container-1'
      );
    });

    expect(result.current.windowChannel).toBe('WD_LED_IRM');
    expect(result.current.windowMax).toBe(4145);
  });

  it('an explicit pick overrides the default', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['TIRF_491', 'WD_LED_IRM']);
      result.current.setChannel('WD_LED_IRM');
      result.current.reportChannelRanges(
        {
          TIRF_491: { min: 489, max: 53927 },
          WD_LED_IRM: { min: 2941, max: 4145 },
        },
        'container-1'
      );
    });
    act(() => {
      result.current.setActiveWindowChannel('TIRF_491');
    });

    expect(result.current.windowChannel).toBe('TIRF_491');
    expect(result.current.windowMax).toBe(53927);
  });

  it('falls back to the first visible channel with no segmentation source', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['TIRF_491', 'WD_LED_IRM']);
      result.current.reportChannelRanges(
        {
          TIRF_491: { min: 489, max: 53927 },
          WD_LED_IRM: { min: 2941, max: 4145 },
        },
        'container-1'
      );
    });

    expect(result.current.windowChannel).toBe('TIRF_491');
  });

  it('drops a pick that the new container has no window for', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['TIRF_491', 'WD_LED_IRM']);
      result.current.reportChannelRanges(
        {
          TIRF_491: { min: 489, max: 53927 },
          WD_LED_IRM: { min: 2941, max: 4145 },
        },
        'container-1'
      );
      result.current.setActiveWindowChannel('TIRF_491');
    });
    act(() => {
      result.current.setVisibleChannels(['DIC']);
      result.current.reportChannelRanges({ DIC: { min: 10, max: 900 } }, 'c2');
    });

    expect(result.current.windowChannel).toBe('DIC');
    expect(result.current.windowMax).toBe(900);
  });
});

describe('a pick that stops being visible', () => {
  const ranges = {
    WD_LED_IRM: { min: 2941, max: 4145 },
    TIRF_491: { min: 489, max: 53927 },
  };

  it('stops editing a channel the user has hidden', () => {
    // Reported by review: the explicit-pick branch checked only that the
    // channel still had a window, so hiding it left the Min/Max sliders bound
    // to a channel nothing draws — with no tab highlighted, and with the tab
    // row gone entirely once only one channel was left.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.setChannel('WD_LED_IRM');
      result.current.reportChannelRanges(ranges, 'container-1');
    });
    act(() => {
      result.current.setActiveWindowChannel('TIRF_491');
    });
    expect(result.current.windowChannel).toBe('TIRF_491');

    act(() => {
      result.current.toggleChannelVisibility('TIRF_491');
    });

    // Falls back to the segmentation source, which IS visible.
    expect(result.current.windowChannel).toBe('WD_LED_IRM');
    expect(result.current.windowMax).toBe(4145);
  });

  it('writes to the visible channel after the pick is dropped', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.setChannel('WD_LED_IRM');
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('TIRF_491');
    });
    act(() => {
      result.current.toggleChannelVisibility('TIRF_491');
    });
    act(() => {
      result.current.setWindowMax(3500);
    });

    expect(result.current.channelWindows.WD_LED_IRM?.max).toBe(3500);
    // The hidden channel must not absorb the edit.
    expect(result.current.channelWindows.TIRF_491?.max).toBe(53927);
  });

  it('restores the pick when the channel comes back', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['WD_LED_IRM', 'TIRF_491']);
      result.current.setChannel('WD_LED_IRM');
      result.current.reportChannelRanges(ranges, 'container-1');
      result.current.setActiveWindowChannel('TIRF_491');
    });
    act(() => {
      result.current.toggleChannelVisibility('TIRF_491');
    });
    act(() => {
      result.current.toggleChannelVisibility('TIRF_491');
    });

    expect(result.current.windowChannel).toBe('TIRF_491');
  });
});

describe('a container that reports no id', () => {
  it('never treats two id-less containers as the same one', () => {
    // `containerId` is optional on the canvas, and keying an absent id as ''
    // made two different videos share one key — so the second inherited the
    // first's window over data it does not describe, which is the very failure
    // this per-channel work exists to remove.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['ch1']);
      result.current.reportChannelRanges({ ch1: { min: 200, max: 400 } }, null);
    });
    act(() => {
      result.current.setWindow(250, 300);
    });
    act(() => {
      // A different video, also without an id.
      result.current.reportChannelRanges(
        { ch1: { min: 5000, max: 60000 } },
        null
      );
    });

    expect(result.current.channelWindows.ch1).toEqual({
      min: 5000,
      max: 60000,
      rangeMax: 60000,
      dataMin: 5000,
      // Set by a report: these windows came from decoded frames, not from
      // the 8-bit placeholder. The sidebar shows Min/Max only when it is true.
      measured: true,
    });
  });
});

describe('bounds only ever widen', () => {
  it('does not shrink a channel ceiling or floor on a dimmer later frame', () => {
    // Lost when the reportDataRange block was deleted; the behaviour survived
    // in the code with nothing pinning it. Without this, scrubbing a long video
    // to a dim frame collapses that channel's slider ceiling to the dim frame's
    // max, so the next Max drag clamps against the collapsed value and Reset
    // refits the composite to the dimmest frame ever seen.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['irm']);
      result.current.reportChannelRanges(
        { irm: { min: 2900, max: 4400 } },
        'c'
      );
    });
    act(() => {
      result.current.setWindow(3000, 3800); // user takes control
    });
    act(() => {
      // A dimmer, narrower frame of the same video.
      result.current.reportChannelRanges(
        { irm: { min: 3200, max: 3900 } },
        'c'
      );
    });

    expect(result.current.channelWindows.irm?.rangeMax).toBe(4400);
    expect(result.current.channelWindows.irm?.dataMin).toBe(2900);
  });
});

describe('a channel whose first frame decodes flat', () => {
  it('re-fits it once a frame with real range arrives', () => {
    // An unilluminated channel of a multi-channel stack reports min === max on
    // its first frame. The widening branch moves only the bounds, so that
    // zero-width window would stand for the whole container and clamp every
    // later frame to white.
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['dark']);
      result.current.reportChannelRanges({ dark: { min: 0, max: 0 } }, 'c');
    });
    expect(result.current.channelWindows.dark?.max).toBe(1);

    act(() => {
      result.current.reportChannelRanges({ dark: { min: 40, max: 9000 } }, 'c');
    });

    expect(result.current.channelWindows.dark).toEqual({
      min: 40,
      max: 9000,
      rangeMax: 9000,
      dataMin: 0,
      // Set by a report: these windows came from decoded frames, not from
      // the 8-bit placeholder. The sidebar shows Min/Max only when it is true.
      measured: true,
    });
  });

  it('leaves a window the user deliberately collapsed alone', () => {
    const { result } = renderHook(() => useImageDisplay(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setVisibleChannels(['irm']);
      result.current.reportChannelRanges({ irm: { min: 0, max: 9000 } }, 'c');
    });
    act(() => {
      result.current.setWindow(500, 500); // deliberate, and non-degenerate data
    });
    act(() => {
      result.current.reportChannelRanges({ irm: { min: 0, max: 9500 } }, 'c');
    });

    // Re-fitting is only for a channel that never had a usable window; a user
    // who collapsed one on real data keeps it.
    expect(result.current.channelWindows.irm?.min).toBe(500);
    expect(result.current.channelWindows.irm?.max).toBe(500);
    expect(result.current.channelWindows.irm?.rangeMax).toBe(9500);
  });
});
