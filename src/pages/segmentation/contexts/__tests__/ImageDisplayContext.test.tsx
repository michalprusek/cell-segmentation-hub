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
 *   machine, including reportDataRange's ImageJ-style auto-scale.
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
      expect(result.current.dataMin).toBe(0);
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

  // ---- reportDataRange (ImageJ-style 16-bit auto-scale) --------------------

  describe('reportDataRange', () => {
    it('rescales the slider bound and auto-fits the window to the data', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(640, 23480, 'irm|tirf');
      });

      expect(result.current.windowRangeMax).toBe(23480);
      expect(result.current.dataMin).toBe(640);
      expect(result.current.windowMin).toBe(640);
      expect(result.current.windowMax).toBe(23480);
    });

    it('lets the window reach 16-bit values after a range report', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(0, 23480, 'tirf');
      });
      act(() => {
        // Would clamp to 255 under the old 8-bit cap; must survive now.
        result.current.setWindowMax(12000);
      });

      expect(result.current.windowMax).toBe(12000);
    });

    it('keeps the window on a same-key frame scrub but widens the clamp ceiling/floor', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(640, 23480, 'tirf');
      });
      act(() => {
        result.current.setWindow(1000, 5000); // user narrows the window
      });
      act(() => {
        // Next frame, same set, but brighter (max 24000) and dimmer floor (600).
        result.current.reportDataRange(600, 24000, 'tirf');
      });

      // Window position preserved (not re-auto-fitted)...
      expect(result.current.windowMin).toBe(1000);
      expect(result.current.windowMax).toBe(5000);
      // ...but the clamp ceiling/floor widen so the brighter/dimmer frame
      // stays reachable and isn't clipped to white by a stale LUT.
      expect(result.current.windowRangeMax).toBe(24000);
      expect(result.current.dataMin).toBe(600);
    });

    it('does not shrink the clamp ceiling/floor when a same-key frame is dimmer', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(640, 23480, 'tirf');
      });
      act(() => {
        result.current.reportDataRange(700, 10000, 'tirf'); // dimmer frame, same set
      });

      // Ceiling/floor are monotonic within a key — a dimmer frame must not
      // narrow the reachable range the user already had.
      expect(result.current.windowRangeMax).toBe(23480);
      expect(result.current.dataMin).toBe(640);
    });

    it('re-auto-scales when the channel set changes', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(640, 23480, 'tirf');
      });
      act(() => {
        result.current.reportDataRange(1826, 6017, 'irm');
      });

      expect(result.current.windowRangeMax).toBe(6017);
      expect(result.current.windowMin).toBe(1826);
      expect(result.current.windowMax).toBe(6017);
    });

    it('resetWindow returns to the auto-scaled data range', () => {
      const { result } = renderHook(() => useImageDisplay(), {
        wrapper: makeWrapper(),
      });

      act(() => {
        result.current.reportDataRange(640, 23480, 'tirf');
      });
      act(() => {
        result.current.setWindow(2000, 9000);
      });
      act(() => {
        result.current.resetWindow();
      });

      expect(result.current.windowMin).toBe(640);
      expect(result.current.windowMax).toBe(23480);
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
