/**
 * Behavioral unit tests for ImageDisplayProvider + useImageDisplay hook.
 *
 * Strategy:
 * - Render the provider directly with a thin wrapper; consume the hook.
 * - The provider is self-contained (no external context deps).
 * - localStorage is already mocked by src/test/setup.ts. We wire the mock
 *   to an in-memory store so persistence tests work reliably.
 * - applyWindowLevel is a pure pixel-manipulation function operating on a
 *   canvas element; it is skipped here because jsdom has no real 2-D
 *   rendering pipeline (getImageData returns zeros).
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
